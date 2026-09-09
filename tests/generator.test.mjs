import assert from "node:assert/strict";
import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("new test generator creates the complete local project structure", async (context) => {
  const projectRoot = process.cwd();
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "yuanbao-generator-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await copyFile(resolve(projectRoot, "tests-registry.json"), resolve(temporaryRoot, "tests-registry.json"));

  const result = spawnSync(process.execPath, [
    resolve(projectRoot, "scripts", "new-test.mjs"),
    "--slug",
    "generator-check",
    "--name",
    "脚手架验证",
    "--mode",
    "standard",
  ], { cwd: temporaryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const generated = resolve(temporaryRoot, "测试项目", "generator-check");
  const required = [
    "test.manifest.json",
    "test.config.json",
    "index.html",
    "项目说明.md",
    "本地资料/说明.md",
    "本地资料/原始素材",
    "本地资料/生成记录",
    "本地资料/兑换码",
  ];
  await Promise.all(required.map((path) => access(resolve(generated, path))));

  const registry = JSON.parse(await readFile(resolve(temporaryRoot, "tests-registry.json"), "utf8"));
  assert.ok(registry.tests.includes("测试项目/generator-check/test.manifest.json"));
});
