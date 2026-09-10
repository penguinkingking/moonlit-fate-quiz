import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const approvalIndex = process.argv.indexOf("--approval");
const approval = approvalIndex >= 0 ? process.argv[approvalIndex + 1] : "";

function git(arguments_, options = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: process.cwd(),
    encoding: options.encoding || "utf8",
    input: options.input,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git ${arguments_.join(" ")} failed: ${String(result.stderr).trim() || "unknown error"}`);
  return options.encoding === "buffer" ? result.stdout : result.stdout.trim();
}

function repositoryFromRemote(remote) {
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) throw new Error("The origin remote is not a supported GitHub repository");
  return `${match[1]}/${match[2]}`;
}

function githubCredential() {
  const filled = git(["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n" });
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
      "user-agent": "yuanbao-git-fallback",
      "x-github-api-version": "2022-11-28",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status}: ${payload?.message || "request failed"}`);
  return payload;
}

function commitRaw(commit, authorZone, committerZone, finalNewline) {
  const authorEpoch = Math.floor(new Date(commit.author.date).getTime() / 1000);
  const committerEpoch = Math.floor(new Date(commit.committer.date).getTime() / 1000);
  return [
    `tree ${commit.tree.sha}`,
    ...commit.parents.map((parent) => `parent ${parent.sha}`),
    `author ${commit.author.name} <${commit.author.email}> ${authorEpoch} ${authorZone}`,
    `committer ${commit.committer.name} <${commit.committer.email}> ${committerEpoch} ${committerZone}`,
    "",
    `${commit.message}${finalNewline ? "\n" : ""}`,
  ].join("\n");
}

function gitObjectSha(type, content) {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(`${type} ${body.length}\0`).update(body).digest("hex");
}

function timezoneOffsets() {
  const offsets = [];
  for (let minutes = -12 * 60; minutes <= 14 * 60; minutes += 15) {
    const sign = minutes < 0 ? "-" : "+";
    const absolute = Math.abs(minutes);
    offsets.push(`${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`);
  }
  return offsets;
}

function storeRemoteCommit(commit) {
  const offsets = timezoneOffsets();
  let matchingRaw = null;
  for (const authorZone of offsets) {
    for (const committerZone of offsets) {
      for (const finalNewline of [false, true]) {
        const raw = commitRaw(commit, authorZone, committerZone, finalNewline);
        if (gitObjectSha("commit", raw) === commit.sha) {
          matchingRaw = raw;
          break;
        }
      }
      if (matchingRaw) break;
    }
    if (matchingRaw) break;
  }
  if (!matchingRaw) throw new Error("Could not reconstruct the GitHub commit object before updating main");
  const stored = git(["hash-object", "-t", "commit", "-w", "--stdin"], { input: matchingRaw });
  if (stored !== commit.sha) throw new Error("Stored Git commit does not match the GitHub commit SHA");
}

if (approval !== "正式开放") throw new Error('GitHub API fallback requires --approval "正式开放"');
if (git(["status", "--porcelain"])) throw new Error("Working tree must be clean before the GitHub API fallback");

const branch = git(["symbolic-ref", "--short", "HEAD"]);
const localHead = git(["rev-parse", "HEAD"]);
const localParent = git(["rev-parse", "HEAD^"]);
const localTree = git(["rev-parse", "HEAD^{tree}"]);
const repository = repositoryFromRemote(git(["config", "--get", "remote.origin.url"]));
const token = githubCredential();
const reference = await github(token, repository, "/git/ref/heads/main");
const remoteHead = reference.object.sha;
if (remoteHead === localHead) {
  console.log("[git-fallback] origin/main already points to the local commit");
  process.exit(0);
}
if (remoteHead !== localParent) throw new Error("origin/main moved after the local commit; fetch and review before publishing");

const changedLines = git(["-c", "core.quotepath=false", "diff-tree", "--no-commit-id", "--name-status", "--no-renames", "-r", "HEAD^", "HEAD"])
  .split(/\r?\n/).filter(Boolean);
const treeEntries = [];
for (const line of changedLines) {
  const [status, path] = line.split("\t");
  if (!path || !/^[AMD]$/.test(status)) throw new Error(`Unsupported Git change entry: ${line}`);
  if (status === "D") {
    treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
    continue;
  }
  const listing = git(["-c", "core.quotepath=false", "ls-tree", "HEAD", "--", path]);
  const mode = listing.split(/\s+/)[0];
  const content = git(["show", `HEAD:${path}`], { encoding: "buffer" });
  const blob = await github(token, repository, "/git/blobs", {
    method: "POST",
    body: JSON.stringify({ content: Buffer.from(content).toString("base64"), encoding: "base64" }),
  });
  treeEntries.push({ path, mode, type: "blob", sha: blob.sha });
  console.log(`[git-fallback] uploaded ${path}`);
}

const remoteCommit = await github(token, repository, `/git/commits/${remoteHead}`);
const tree = await github(token, repository, "/git/trees", {
  method: "POST",
  body: JSON.stringify({ base_tree: remoteCommit.tree.sha, tree: treeEntries }),
});
if (tree.sha !== localTree) throw new Error(`Uploaded tree ${tree.sha} does not match local tree ${localTree}`);

const created = await github(token, repository, "/git/commits", {
  method: "POST",
  body: JSON.stringify({
    message: git(["log", "-1", "--format=%B"]),
    tree: tree.sha,
    parents: [remoteHead],
  }),
});
storeRemoteCommit(created);
await github(token, repository, "/git/refs/heads/main", {
  method: "PATCH",
  body: JSON.stringify({ sha: created.sha, force: false }),
});
const published = await github(token, repository, `/git/commits/${created.sha}`);
if (published.tree.sha !== localTree) throw new Error("Published GitHub commit tree does not match the approved local tree");

git(["update-ref", `refs/heads/${branch}`, created.sha, localHead]);
console.log(`[git-fallback] published matching tree as ${created.sha}`);
