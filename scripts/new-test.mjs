import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const slug = String(args.slug || "").trim();
const name = String(args.name || "").trim();
const mode = String(args.mode || "standard").trim();
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("--slug 必须是小写英文、数字和连字符");
if (!name) throw new Error("必须提供 --name");
if (!new Set(["standard", "custom-static"]).has(mode)) throw new Error("--mode 目前支持 standard 或 custom-static");

const root = process.cwd();
const testsDirectory = resolve(root, "测试项目");
const directory = resolve(testsDirectory, slug);
const manifest = {
  schemaVersion: 1,
  slug,
  name,
  description: `${name}测试`,
  version: "0.1.0",
  mode,
  entry: "index.html",
  legacyRoot: false,
  licenseRequired: true,
  codePrefix: slug.replace(/[^a-z0-9]/g, "").slice(0, 6).toUpperCase(),
  resultStorageKey: `test-platform:${slug}:last-result`,
};
await mkdir(testsDirectory, { recursive: true });
await mkdir(directory, { recursive: false });
await writeFile(resolve(directory, "test.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const modeLabel = mode === "standard" ? "标准配置测试" : "自定义静态测试";
await writeFile(resolve(directory, "项目说明.md"), `# ${name}\n\n## 项目概况\n\n- 英文标识：\`${slug}\`\n- 实现方式：${modeLabel}\n- 公网入口：\`/tests/${slug}/\`（本地验收通过后才发布）\n- 兑换码前缀：\`${manifest.codePrefix}\`\n- 当前状态：本地制作中\n\n## 内容与设计\n\n在这里持续记录测试目的、题目结构、结果算法、页面风格、素材来源和验收情况。\n\n## 发布规则\n\n本地验收完成前不上传。只有用户明确批准后，才随整个平台构建 Docker 镜像并更新 Sealos。\n`, "utf8");
const localMaterials = resolve(directory, "本地资料");
await mkdir(resolve(localMaterials, "原始素材"), { recursive: true });
await mkdir(resolve(localMaterials, "生成记录"), { recursive: true });
await mkdir(resolve(localMaterials, "兑换码"), { recursive: true });
await writeFile(resolve(localMaterials, "说明.md"), `# ${name}本地资料\n\n这里保存原始素材、生成过程文件和明文兑换码。这些子目录不会进入 GitHub 或 Docker 镜像。网站实际使用的成品资源应放在测试代码目录中。\n`, "utf8");

if (mode === "standard") {
  const config = {
    name,
    title: name,
    kicker: "A PERSONAL EXPLORATION",
    description: "请根据第一直觉作答，完成后查看属于你的结果。",
    questions: [
      { text: "面对一个全新的机会，你通常会？", options: [
        { text: "先行动，在过程中调整", scores: { explorer: 2 } },
        { text: "先观察，确认方向再开始", scores: { planner: 2 } },
      ] },
    ],
    results: {
      explorer: { title: "主动探索者", description: "你更愿意通过行动理解世界。" },
      planner: { title: "沉稳规划者", description: "你善于先建立方向，再稳步前进。" },
    },
  };
  await writeFile(resolve(directory, "test.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await writeFile(resolve(directory, "index.html"), `<!doctype html>\n<html lang="zh-CN" data-test-slug="${slug}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>${name}</title>\n  <link rel="stylesheet" href="/shared/license-gate.css">\n  <link rel="stylesheet" href="/shared/standard-runtime.css">\n</head>\n<body>\n  <div id="test-root"></div>\n  <script src="/shared/license-gate.js"></script>\n  <script src="/shared/standard-runtime.js"></script>\n</body>\n</html>\n`, "utf8");
} else {
  await writeFile(resolve(directory, "index.html"), `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="stylesheet" href="/shared/license-gate.css"></head><body><main><h1>${name}</h1></main><script src="/shared/license-gate.js"></script><script>TestPlatformLicense.start({ testSlug: ${JSON.stringify(slug)}, testName: ${JSON.stringify(name)} });</script></body></html>\n`, "utf8");
}

const registryPath = resolve(root, "tests-registry.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
registry.tests.push(`测试项目/${slug}/test.manifest.json`);
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
console.log(`Created ${name}: ${directory}`);
