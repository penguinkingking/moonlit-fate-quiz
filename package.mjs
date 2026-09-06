import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

const root = process.cwd();
const built = resolve(root, 'offline-build');
const jsName = (await readdir(built)).find(name => name.endsWith('.iife.js'));
if (!jsName) throw new Error('Missing IIFE build. Run npm run build:offline.');
const artRoot = resolve(root, 'public/art');
const art = {};
async function collectArt(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectArt(path));
    else if (entry.isFile() && /\.(?:png|jpe?g)$/i.test(entry.name)) files.push(path);
  }
  return files;
}
for (const path of (await collectArt(artRoot)).sort()) {
  const extension = /\.jpe?g$/i.test(path) ? 'jpg' : 'png';
  const name = relative(artRoot, path).replaceAll('\\', '/').replace(/\.(?:png|jpe?g)$/i, '');
  art[name] = `data:image/${extension === 'jpg' ? 'jpeg' : 'png'};base64,${(await readFile(path)).toString('base64')}`;
}
let css = await readFile(resolve(built, 'app.css'), 'utf8');
for (const [name, data] of Object.entries(art)) {
  css = css.replaceAll(`/art/${name}.png`, data);
  css = css.replaceAll(`/art/${name}.jpg`, data);
}
const js = (await readFile(resolve(built, jsName), 'utf8')).replace(/<\/script/gi, '<\\/script');
const favicon = `data:image/svg+xml;base64,${(await readFile(resolve(root, 'public/favicon.svg'))).toString('base64')}`;
const page = `<!doctype html>
<html lang="zh-CN" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="月下心笺：离线中日对照乙女角色娱乐测试。"><title>月下心笺 · 中日对照离线版</title><link rel="icon" href="${favicon}"><style>${css}</style></head><body><div id="root"></div><noscript>请在浏览器中启用 JavaScript 以运行测试。テストを始めるには JavaScript を有効にしてください。</noscript><script>window.__MOONLIT_ART__=${JSON.stringify(art)};</script><script>${js}</script></body></html>`;
const output = resolve(process.argv[2] || resolve(built, 'index.html'));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, page, 'utf8');
if (/url\(["']?\/art\//i.test(css)) throw new Error('An image was not embedded into CSS');
if (js.includes('process.env.NODE_ENV')) throw new Error('Unresolved browser environment variable');
console.log(`Offline standalone HTML: ${output} (${Buffer.byteLength(page)} bytes)`);

