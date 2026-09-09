import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const registry = JSON.parse(await readFile(resolve(root, "tests-registry.json"), "utf8"));
if (registry.schemaVersion !== 1 || !Array.isArray(registry.tests) || !registry.tests.length) throw new Error("测试注册表无效");

const slugs = new Set();
const prefixes = new Set();
for (const path of registry.tests) {
  const manifestPath = resolve(root, path);
  const directory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error(`${path}: schemaVersion 必须为 1`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.slug || "")) throw new Error(`${path}: slug 无效`);
  if (slugs.has(manifest.slug)) throw new Error(`${path}: slug 重复`);
  slugs.add(manifest.slug);
  if (!/^[A-Z0-9]{2,10}$/.test(manifest.codePrefix || "")) throw new Error(`${path}: codePrefix 无效`);
  if (prefixes.has(manifest.codePrefix)) throw new Error(`${path}: codePrefix 重复`);
  prefixes.add(manifest.codePrefix);
  if (!manifest.name || !manifest.version || !manifest.mode || !manifest.entry) throw new Error(`${path}: 缺少必填字段`);
  await access(resolve(directory, manifest.entry));
  await access(resolve(directory, "项目说明.md"));

  const sourceFiles = [manifestPath, resolve(directory, manifest.entry)];
  if (manifest.mode === "standard") {
    const configPath = resolve(directory, "test.config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (!Array.isArray(config.questions) || !config.questions.length) throw new Error(`${manifest.slug}: 缺少题目`);
    if (!config.results || !Object.keys(config.results).length) throw new Error(`${manifest.slug}: 缺少结果`);
    for (const [questionIndex, question] of config.questions.entries()) {
      if (!question.text || !Array.isArray(question.options) || question.options.length < 2) throw new Error(`${manifest.slug}: 第 ${questionIndex + 1} 题无效`);
      for (const option of question.options) {
        if (!option.text || !option.scores || Object.keys(option.scores).some((key) => !config.results[key])) throw new Error(`${manifest.slug}: 第 ${questionIndex + 1} 题存在无效选项或结果引用`);
      }
    }
    sourceFiles.push(configPath);
  }
  for (const file of sourceFiles) {
    const text = await readFile(file, "utf8");
    if (/\b(?:ADMIN_PASSWORD|SESSION_SECRET|CODE_ENCRYPTION_KEY)\s*[=:]\s*["'][^"']+/i.test(text)) throw new Error(`${file}: 疑似包含生产密钥`);
  }
  console.log(`OK ${manifest.slug} ${manifest.version} (${manifest.mode})`);
}
console.log(`Validated ${slugs.size} test packages`);
