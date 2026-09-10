import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const approval = args.approval || "";
const timeoutMs = Math.max(60_000, Number(process.env.RELEASE_WORKFLOW_TIMEOUT_MS) || 20 * 60_000);

function git(arguments_, input) {
  const result = spawnSync("git", arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git ${arguments_.join(" ")} failed: ${result.stderr.trim() || "unknown error"}`);
  return result.stdout.trim();
}

function repositoryFromRemote(remote) {
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error("The origin remote is not a supported GitHub repository");
  return `${match[1]}/${match[2]}`;
}

function githubCredential() {
  const filled = git(["credential", "fill"], "protocol=https\nhost=github.com\n\n");
  const entries = Object.fromEntries(filled.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
  }));
  if (!entries.password) throw new Error("GitHub credentials are not available from Git Credential Manager");
  return entries.password;
}

async function github(token, repository, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "yuanbao-release-helper",
      "x-github-api-version": "2022-11-28",
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`GitHub API ${path} returned ${response.status}: ${payload.message || "request failed"}`);
  }
  return response.status === 204 ? null : response.json();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (approval !== "正式开放") throw new Error('Production release requires --approval "正式开放"');
const sha = (args.sha || git(["rev-parse", "HEAD"])).toLowerCase();
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Release SHA must be a full 40-character Git commit SHA");
const remote = git(["config", "--get", "remote.origin.url"]);
const repository = repositoryFromRemote(remote);
const token = githubCredential();
const remoteReference = await github(token, repository, "/git/ref/heads/main");
const remoteMain = remoteReference.object.sha.toLowerCase();
if (remoteMain !== sha) throw new Error("The release commit is not the current origin/main; push the approved commit first");

const registry = JSON.parse(await readFile("tests-registry.json", "utf8"));
const expectedTests = String(args["expected-tests"] || registry.tests?.length || registry.length || 0);
if (!/^\d+$/.test(expectedTests) || Number(expectedTests) < 1) throw new Error("Expected test count is invalid");

const workflowPath = "/actions/workflows/release-production.yml";
const before = await github(token, repository, `${workflowPath}/runs?event=workflow_dispatch&branch=main&per_page=20`);
const existingRunIds = new Set((before.workflow_runs || []).map((run) => run.id));
await github(token, repository, `${workflowPath}/dispatches`, {
  method: "POST",
  body: JSON.stringify({
    ref: "main",
    inputs: { image_sha: sha, approval, expected_tests: expectedTests },
  }),
});
console.log(`[release] requested ${sha.slice(0, 12)} with ${expectedTests} registered tests`);

const discoveryDeadline = Date.now() + 60_000;
let run = null;
while (Date.now() < discoveryDeadline && !run) {
  await delay(3000);
  const runs = await github(token, repository, `${workflowPath}/runs?event=workflow_dispatch&branch=main&per_page=20`);
  run = (runs.workflow_runs || []).find((candidate) => !existingRunIds.has(candidate.id) && candidate.head_sha === sha);
}
if (!run) throw new Error("GitHub accepted the release but no matching workflow run appeared within 60 seconds");
console.log(`[release] workflow ${run.id}: ${run.html_url}`);

const deadline = Date.now() + timeoutMs;
let lastStatus = "";
while (Date.now() < deadline) {
  run = await github(token, repository, `/actions/runs/${run.id}`);
  const status = run.status === "completed" ? `${run.status}/${run.conclusion}` : run.status;
  if (status !== lastStatus) {
    console.log(`[release] ${status}`);
    lastStatus = status;
  }
  if (run.status === "completed") {
    if (run.conclusion !== "success") throw new Error(`Production workflow ended with ${run.conclusion}; rollback is handled by the workflow`);
    console.log(`[release] production release passed: ${run.html_url}`);
    process.exit(0);
  }
  await delay(10_000);
}
throw new Error(`Production workflow exceeded ${Math.round(timeoutMs / 60_000)} minutes; inspect ${run.html_url}`);
