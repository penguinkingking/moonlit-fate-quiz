import { lchown, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || '/app/data');
const nodeUid = 1000;
const nodeGid = 1000;

async function chownTree(target) {
  const stat = await lstat(target);

  if (stat.isDirectory()) {
    for (const entry of await readdir(target)) {
      await chownTree(path.join(target, entry));
    }
  }

  await lchown(target, nodeUid, nodeGid);
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  await mkdir(dataDir, { recursive: true });
  await chownTree(dataDir);
  process.setgid(nodeGid);
  process.setuid(nodeUid);
}

await import('./index.mjs');
