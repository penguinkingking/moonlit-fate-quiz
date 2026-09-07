import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const built = resolve(process.cwd(), 'web-build');
const jsName = (await readdir(built)).find((name) => name.endsWith('.iife.js'));
if (!jsName) throw new Error('Missing online IIFE build. Run npm run build:online.');

const page = `<!doctype html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="月下心笺：乙女角色娱乐测试。">
  <title>月下心笺 · 寻找你的命定角色</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <div id="root"></div>
  <noscript>请在浏览器中启用 JavaScript 以运行测试。テストを始めるには JavaScript を有効にしてください。</noscript>
  <script defer src="/${jsName}"></script>
</body>
</html>`;

await mkdir(built, { recursive: true });
await writeFile(resolve(built, 'index.html'), page, 'utf8');
console.log(`Online HTML: ${resolve(built, 'index.html')} (${Buffer.byteLength(page)} bytes)`);
