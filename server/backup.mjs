import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function createBackupService(db, config, audit) {
  const backupDir = resolve(config.dataDir, "backups");
  let running = null;

  async function list() {
    await mkdir(backupDir, { recursive: true });
    const names = (await readdir(backupDir)).filter((name) => /^platform-.+\.sqlite$/.test(name));
    const items = await Promise.all(names.map(async (name) => {
      const info = await stat(resolve(backupDir, name));
      return { name, size: info.size, createdAt: info.mtime.toISOString() };
    }));
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function prune() {
    const cutoff = Date.now() - config.backupRetention * 24 * 60 * 60_000;
    for (const item of await list()) {
      if (Date.parse(item.createdAt) < cutoff) await rm(resolve(backupDir, item.name), { force: true });
    }
  }

  async function create({ username = "system", reason = "scheduled", ipAddress = null } = {}) {
    if (running) return running;
    running = (async () => {
      await mkdir(backupDir, { recursive: true });
      const name = `platform-${timestamp()}.sqlite`;
      const path = resolve(backupDir, name);
      await db.backup(path);
      const integrity = db.pragma("quick_check", { simple: true });
      if (integrity !== "ok") throw new Error(`Database integrity check failed: ${integrity}`);
      await prune();
      audit.record({ username, action: "backup.create", objectType: "backup", objectId: name, detail: { reason }, ipAddress });
      return { name, path };
    })().finally(() => { running = null; });
    return running;
  }

  async function ensureDaily() {
    const today = new Date().toISOString().slice(0, 10);
    if ((await list()).some((item) => item.createdAt.startsWith(today))) return;
    await create({ reason: "daily" });
  }

  function schedule() {
    const timer = setInterval(() => ensureDaily().catch((error) => console.error("[backup]", error)), 60 * 60_000);
    timer.unref();
    setTimeout(() => ensureDaily().catch((error) => console.error("[backup]", error)), 10_000).unref();
    return timer;
  }

  return { create, list, prune, ensureDaily, schedule };
}
