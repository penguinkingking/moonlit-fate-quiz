import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { characters, questions } from '../lib/quiz.ts';

const html = await readFile(process.argv[2] || 'offline-build/index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.equal(scripts.length, 2, 'Offline page must contain its asset map and application inline');
for (const script of scripts) new vm.Script(script);
const sandbox = { window: {} };
vm.runInNewContext(scripts[0], sandbox);
const assets = sandbox.window.__MOONLIT_ART__;
assert.deepEqual(Object.keys(assets).sort(), ['hero', ...characters.map(c=>`characters/${c.id}`)].sort());
for (const data of Object.values(assets)) {
  assert.ok(/^data:image\/(?:png|jpeg);base64,/.test(data));
  const bytes = Buffer.from(data.split(',')[1], 'base64');
  if (data.startsWith('data:image/png')) assert.equal(bytes.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  else assert.equal(bytes.subarray(0,2).toString('hex'), 'ffd8');
}
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
assert.ok(!/url\(["']?\/(?!\/)/.test(css), 'No root-relative CSS resources');
assert.ok(!css.includes('@import'), 'CSS must be compiled, with no remote imports');
assert.ok(!scripts[1].includes('process.env.NODE_ENV'));
assert.ok(!/import\s*\(/.test(scripts[1]), 'No runtime ES module loading');
const markupOnly = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
assert.ok(!/<(?:script|iframe)[^>]+src=/i.test(markupOnly));
assert.ok(!/<link[^>]+rel=["']stylesheet/i.test(markupOnly));
assert.equal(questions.length, 16);
assert.equal(characters.length,13);
characters.forEach(c=>{assert.ok(/[\u4e00-\u9fff]/.test(c.name), `${c.id} needs a Chinese display name`);assert.ok(c.jp);assert.notEqual(c.name,c.jp);assert.ok(scripts[1].includes(c.jp),`Missing Japanese name ${c.jp}`);});
console.log('PASS: classic inline scripts parse; hero plus 13 valid portraits embedded; no external runtime resources; all 13 characters have distinct Chinese/Japanese names.');


