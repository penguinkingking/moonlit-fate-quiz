import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";

const RELEASE_NAME = "yuanbao-release";

export function parseKubeConfig(source) {
  const text = String(source || "");
  try {
    const config = JSON.parse(text);
    const contextName = config["current-context"];
    const context = config.contexts?.find((item) => item.name === contextName)?.context;
    const cluster = config.clusters?.find((item) => item.name === context?.cluster)?.cluster;
    const user = config.users?.find((item) => item.name === context?.user)?.user;
    if (cluster?.server && cluster["certificate-authority-data"] && context?.namespace && user?.token) {
      return { server: cluster.server, namespace: context.namespace, caData: cluster["certificate-authority-data"], token: user.token };
    }
  } catch {}
  const value = (pattern, label) => {
    const match = text.match(pattern);
    if (!match?.[1]) throw new Error(`KubeConfig is missing ${label}`);
    return match[1].trim();
  };
  return {
    server: value(/^\s*server:\s*(\S+)\s*$/m, "cluster server"),
    namespace: value(/^\s*namespace:\s*(\S+)\s*$/m, "namespace"),
    caData: value(/^\s*certificate-authority-data:\s*(\S+)\s*$/m, "certificate authority"),
    token: value(/^\s*token:\s*(\S+)\s*$/m, "token"),
  };
}

export function releaseRoleRules(workloadKind, workloadName) {
  const resource = workloadKind === "statefulset" ? "statefulsets" : "deployments";
  return [
    {
      apiGroups: ["apps"],
      resources: [resource],
      resourceNames: [workloadName],
      verbs: ["get", "list", "watch", "patch", "update"],
    },
    {
      apiGroups: ["apps"],
      resources: ["replicasets"],
      verbs: ["get", "list", "watch"],
    },
    {
      apiGroups: [""],
      resources: ["pods", "pods/log", "events"],
      verbs: ["get", "list", "watch"],
    },
  ];
}

export function createKubeClient(config) {
  const ca = Buffer.from(config.caData, "base64").toString("utf8");
  return async function kubeRequest(path, { method = "GET", body, allow = [] } = {}) {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const url = new URL(path, `${config.server.replace(/\/$/, "")}/`);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(url, {
        method,
        ca,
        rejectUnauthorized: true,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${config.token}`,
          ...(payload ? {
            "content-type": method === "PATCH" ? "application/merge-patch+json" : "application/json",
            "content-length": payload.length,
          } : {}),
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch {}
          const status = response.statusCode || 0;
          if ((status >= 200 && status < 300) || allow.includes(status)) return resolve({ status, body: parsed, text });
          reject(new Error(`Kubernetes API ${method} ${url.pathname} returned ${status}: ${parsed?.message || "request failed"}`));
        });
      });
      req.setTimeout(15_000, () => req.destroy(new Error("Kubernetes API request timed out")));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

async function upsert(kube, collectionPath, name, object) {
  const itemPath = `${collectionPath}/${encodeURIComponent(name)}`;
  const current = await kube(itemPath, { allow: [404] });
  if (current.status === 404) return kube(collectionPath, { method: "POST", body: object });
  return kube(itemPath, { method: "PATCH", body: object });
}

async function installReleaseIdentity(config, workloadKind, workloadName) {
  if (!new Set(["deployment", "statefulset"]).has(workloadKind)) throw new Error(`Unsupported workload kind: ${workloadKind}`);
  const kube = createKubeClient(config);
  const namespace = encodeURIComponent(config.namespace);
  const resource = workloadKind === "statefulset" ? "statefulsets" : "deployments";
  const workloadPath = `/apis/apps/v1/namespaces/${namespace}/${resource}/${encodeURIComponent(workloadName)}`;
  const workload = await kube(workloadPath);
  const containers = workload.body?.spec?.template?.spec?.containers || [];
  if (!containers.length) throw new Error(`${workloadKind} ${workloadName} has no containers`);

  const metadata = { name: RELEASE_NAME, namespace: config.namespace, labels: { "app.kubernetes.io/managed-by": "yuanbao-release" } };
  await upsert(kube, `/api/v1/namespaces/${namespace}/serviceaccounts`, RELEASE_NAME, {
    apiVersion: "v1", kind: "ServiceAccount", metadata,
    automountServiceAccountToken: false,
  });
  await upsert(kube, `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/roles`, RELEASE_NAME, {
    apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", metadata,
    rules: releaseRoleRules(workloadKind, workloadName),
  });
  await upsert(kube, `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings`, RELEASE_NAME, {
    apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", metadata,
    subjects: [{ kind: "ServiceAccount", name: RELEASE_NAME, namespace: config.namespace }],
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: RELEASE_NAME },
  });

  const secretName = `${RELEASE_NAME}-token`;
  await upsert(kube, `/api/v1/namespaces/${namespace}/secrets`, secretName, {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName,
      namespace: config.namespace,
      labels: metadata.labels,
      annotations: { "kubernetes.io/service-account.name": RELEASE_NAME },
    },
    type: "kubernetes.io/service-account-token",
  });

  let tokenData;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const secret = await kube(`/api/v1/namespaces/${namespace}/secrets/${secretName}`);
    if (secret.body?.data?.token) {
      tokenData = secret.body.data;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!tokenData?.token) throw new Error("Timed out waiting for the restricted service-account token");

  const restricted = {
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name: "sealos", cluster: { server: config.server, "certificate-authority-data": tokenData["ca.crt"] || config.caData } }],
    contexts: [{ name: RELEASE_NAME, context: { cluster: "sealos", namespace: config.namespace, user: RELEASE_NAME } }],
    "current-context": RELEASE_NAME,
    preferences: {},
    users: [{ name: RELEASE_NAME, user: { token: Buffer.from(tokenData.token, "base64").toString("utf8") } }],
  };

  const restrictedConfig = parseKubeConfig(JSON.stringify(restricted));
  const restrictedKube = createKubeClient(restrictedConfig);
  const readable = await restrictedKube(workloadPath);
  const dryRun = await restrictedKube(`${workloadPath}?dryRun=All`, {
    method: "PATCH",
    body: { metadata: { annotations: { "yuanbao-release/permission-check": new Date().toISOString() } } },
  });
  const secretDenied = await restrictedKube(`/api/v1/namespaces/${namespace}/secrets`, { allow: [403] });
  if (readable.status !== 200 || dryRun.status !== 200 || secretDenied.status !== 403) {
    throw new Error("Restricted release identity did not pass the permission boundary checks");
  }

  return {
    restricted,
    summary: {
      namespace: config.namespace,
      workloadKind,
      workloadName,
      containers: containers.map((item) => ({ name: item.name, image: item.image })),
      canReadTarget: true,
      canDryRunPatchTarget: true,
      canReadSecrets: false,
    },
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const command = process.argv[2] || "discover";
  const config = parseKubeConfig(await readStdin());
  const kube = createKubeClient(config);
  const namespace = encodeURIComponent(config.namespace);
  if (command === "discover") {
    const [deploymentResult, statefulSetResult, podResult, apiGroups] = await Promise.all([
      kube(`/apis/apps/v1/namespaces/${namespace}/deployments`),
      kube(`/apis/apps/v1/namespaces/${namespace}/statefulsets`),
      kube(`/api/v1/namespaces/${namespace}/pods`),
      kube("/apis"),
    ]);
    const summarizeWorkload = (kind) => (item) => ({
      kind,
      name: item.metadata?.name,
      replicas: item.spec?.replicas || 0,
      ready: item.status?.readyReplicas || 0,
      containers: (item.spec?.template?.spec?.containers || []).map((container) => ({ name: container.name, image: container.image })),
    });
    const workloads = [
      ...(deploymentResult.body?.items || []).map(summarizeWorkload("Deployment")),
      ...(statefulSetResult.body?.items || []).map(summarizeWorkload("StatefulSet")),
    ];
    const pods = (podResult.body?.items || []).map((item) => ({
      name: item.metadata?.name,
      phase: item.status?.phase,
      owners: (item.metadata?.ownerReferences || []).map((owner) => ({ kind: owner.kind, name: owner.name })),
      containers: (item.spec?.containers || []).map((container) => ({ name: container.name, image: container.image })),
    }));
    const groups = (apiGroups.body?.groups || []).map((group) => group.name).filter((name) => /app|sealos|deploy/i.test(name));
    console.log(JSON.stringify({ namespace: config.namespace, workloads, pods, relatedApiGroups: groups }, null, 2));
    return;
  }
  if (command === "install") {
    const workloadKind = process.argv[3];
    const workloadName = process.argv[4];
    if (!workloadKind || !workloadName) throw new Error("Usage: sealos-kube-api.mjs install <deployment|statefulset> <name>");
    const result = await installReleaseIdentity(config, workloadKind, workloadName);
    console.error(`[sealos-bootstrap] ${JSON.stringify(result.summary)}`);
    process.stdout.write(Buffer.from(JSON.stringify(result.restricted)).toString("base64"));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[sealos-bootstrap] ${error.message}`);
    process.exitCode = 1;
  });
}
