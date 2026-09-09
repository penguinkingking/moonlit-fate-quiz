import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const output = resolve(root, "web-build");
const moonlitOutput = resolve(output, "tests", "moonlit-fate");
const registry = JSON.parse(await readFile(resolve(root, "tests-registry.json"), "utf8"));

await rm(output, { recursive: true, force: true });
await mkdir(moonlitOutput, { recursive: true });

execFileSync(process.execPath, [
  resolve(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  resolve(root, "vite.online.config.ts"),
], { stdio: "inherit" });

const builtNames = await readdir(moonlitOutput);
const jsName = builtNames.find((name) => name.endsWith(".iife.js"));
const cssName = builtNames.find((name) => name.endsWith(".css"));
if (!jsName || !cssName) throw new Error("Moonlit Fate build output is incomplete");

const moonlitPage = `<!doctype html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="月下心笺：寻找你的命定角色。">
  <title>月下心笺 · 寻找你的命定角色</title>
  <link rel="icon" href="/art/favicon.svg">
  <link rel="stylesheet" href="/tests/moonlit-fate/${cssName}">
</head>
<body>
  <div id="root"></div>
  <noscript>请在浏览器中启用 JavaScript 以运行测试。</noscript>
  <script defer src="/tests/moonlit-fate/${jsName}"></script>
</body>
</html>`;
await writeFile(resolve(moonlitOutput, "index.html"), moonlitPage, "utf8");

await cp(resolve(root, "apps", "tests", "moonlit-fate", "public", "art"), resolve(output, "art"), { recursive: true });
await cp(resolve(root, "apps", "tests", "moonlit-fate", "public", "favicon.svg"), resolve(output, "art", "favicon.svg"));
await mkdir(resolve(output, "shared"), { recursive: true });
await cp(resolve(root, "packages", "test-sdk", "license-gate.js"), resolve(output, "shared", "license-gate.js"));
await cp(resolve(root, "packages", "test-sdk", "license-gate.css"), resolve(output, "shared", "license-gate.css"));
await cp(resolve(root, "packages", "test-sdk", "standard-runtime.js"), resolve(output, "shared", "standard-runtime.js"));
await cp(resolve(root, "packages", "test-sdk", "standard-runtime.css"), resolve(output, "shared", "standard-runtime.css"));

for (const manifestPath of registry.tests) {
  const source = resolve(root, manifestPath, "..");
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
  if (manifest.slug === "moonlit-fate") continue;
  await cp(source, resolve(output, "tests", manifest.slug), {
    recursive: true,
    filter: (entry) => !entry.endsWith("test.manifest.json"),
  });
}

const innerPath = resolve(output, "tests", "inner-voices", "index.html");
let innerHtml = await readFile(innerPath, "utf8");
innerHtml = innerHtml
  .replace(/\s*<link rel="preconnect"[^>]+>\s*/g, "\n  ")
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]+>\s*/g, "\n  ")
  .replace("</head>", '  <link rel="stylesheet" href="/shared/license-gate.css">\n</head>')
  .replace("<script src=\"script.js\"></script>", '<script src="/shared/license-gate.js"></script>\n  <script>TestPlatformLicense.start({ testSlug: "inner-voices", testName: "内在三声部" });</script>\n  <script src="script.js"></script>');
await writeFile(innerPath, innerHtml, "utf8");

await cp(resolve(root, "apps", "admin"), resolve(output, "admin"), { recursive: true });
await writeFile(resolve(output, "index.html"), moonlitPage, "utf8");
console.log(`Platform web build created at ${output}`);
