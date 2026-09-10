import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseKubeConfig, releaseRoleRules } from "../scripts/sealos-kube-api.mjs";

test("Sealos bootstrap parses credentials without retaining unrelated data", () => {
  const parsed = parseKubeConfig(`
apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: Q0E=
    server: https://example.invalid:6443
contexts:
- context:
    namespace: project-space
users:
- user:
    token: private-token
kind: Config
`);
  assert.deepEqual(parsed, {
    server: "https://example.invalid:6443",
    namespace: "project-space",
    caData: "Q0E=",
    token: "private-token",
  });
});

test("release role is namespace scoped and cannot read secrets or delete resources", () => {
  const rules = releaseRoleRules("statefulset", "moonlit-fate-quiz");
  const workloadRule = rules.find((rule) => rule.resources.includes("statefulsets"));
  assert.deepEqual(workloadRule.resourceNames, ["moonlit-fate-quiz"]);
  assert.ok(workloadRule.verbs.includes("patch"));
  assert.ok(!rules.some((rule) => rule.resources.includes("secrets")));
  assert.ok(!rules.some((rule) => rule.verbs.includes("delete") || rule.verbs.includes("create")));
});

test("production release workflow has approval, backup, pinned image, rollback, and cleanup gates", async () => {
  const workflow = await readFile(".github/workflows/release-production.yml", "utf8");
  for (const required of [
    "workflow_dispatch", "approval", "production-release-smoke.mjs backup", "github.event.inputs.image_sha",
    "kubectl set image", "rollout status", "production-release-smoke.mjs smoke", "Rollback previous image",
    "SEALOS_KUBECONFIG_B64", "PRODUCTION_ADMIN_PASSWORD", "PRODUCTION_SMOKE_CODE", "PLAYWRIGHT_CHROME_PATH",
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workflow, /if:\s*failure\(\)/);
});

test("production smoke uses a real mobile browser and restores the authorization gate", async () => {
  const smoke = await readFile("scripts/production-release-smoke.mjs", "utf8");
  for (const required of [
    "playwright-core", "390", "#startButton", "#backButton", "#questionNumber", "#resultScreen",
    "previousAnswerRestored", ".platform-license-gate", "Browser retained authorization after smoke-code cleanup",
  ]) assert.match(smoke, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("documentation-only pushes do not publish a container image", async () => {
  const workflow = await readFile(".github/workflows/publish-image.yml", "utf8");
  assert.match(workflow, /paths-ignore:/);
  assert.match(workflow, /\*\*\/\*\.md/);
  assert.match(workflow, /docs\/\*\*/);
});

test("GitHub API push fallback refuses stale parents and verifies the complete tree", async () => {
  const fallback = await readFile("scripts/push-main-via-github-api.mjs", "utf8");
  for (const required of [
    'approval !== "正式开放"', "Working tree must be clean", "remoteHead !== localParent",
    "tree.sha !== localTree", "storeRemoteCommit(created)", "hash-object", "force: false", "update-ref",
  ]) assert.match(fallback, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("production trigger verifies origin/main without the unreliable Git transport", async () => {
  const trigger = await readFile("scripts/trigger-production-release.mjs", "utf8");
  assert.match(trigger, /\/git\/ref\/heads\/main/);
  assert.doesNotMatch(trigger, /ls-remote/);
});
