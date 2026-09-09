import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCHEMA_VERSION = 1;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadManifests(registryPath) {
  const registry = readJson(registryPath);
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.tests)) {
    throw new Error("Invalid tests-registry.json");
  }
  const root = resolve(dirname(registryPath));
  return registry.tests.map((relativePath) => {
    const manifest = readJson(resolve(root, relativePath));
    if (
      manifest.schemaVersion !== 1 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.slug || "") ||
      !manifest.name ||
      !manifest.version ||
      !manifest.entry
    ) throw new Error(`Invalid test manifest: ${relativePath}`);
    return manifest;
  });
}

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','archived')),
      entry_path TEXT NOT NULL,
      code_prefix TEXT NOT NULL,
      active_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS test_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      artifact_digest TEXT,
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','retired')),
      created_at TEXT NOT NULL,
      published_at TEXT,
      UNIQUE(test_id, version)
    );
    CREATE TABLE IF NOT EXISTS code_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE RESTRICT,
      batch_id INTEGER REFERENCES code_batches(id) ON DELETE SET NULL,
      code_hash TEXT NOT NULL UNIQUE,
      code_ciphertext TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','allocated','redeemed','disabled')),
      order_ref TEXT,
      device_hash TEXT,
      created_at TEXT NOT NULL,
      allocated_at TEXT,
      redeemed_at TEXT,
      disabled_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_test_order
      ON licenses(test_id, order_ref) WHERE order_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_licenses_available
      ON licenses(test_id, status, id);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      object_type TEXT,
      object_id TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
  db.prepare("INSERT INTO schema_meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(SCHEMA_VERSION));
}

function registerTests(db, manifests) {
  const now = new Date().toISOString();
  const upsertTest = db.prepare(`
    INSERT INTO tests(slug,name,description,mode,status,entry_path,code_prefix,active_version,created_at,updated_at)
    VALUES(@slug,@name,@description,@mode,'active',@entryPath,@codePrefix,@version,@now,@now)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, description=excluded.description, mode=excluded.mode,
      entry_path=excluded.entry_path, code_prefix=excluded.code_prefix,
      active_version=excluded.active_version, updated_at=excluded.updated_at
  `);
  const upsertVersion = db.prepare(`
    INSERT INTO test_versions(test_id,version,manifest_json,status,created_at,published_at)
    VALUES(@testId,@version,@manifest,'published',@now,@now)
    ON CONFLICT(test_id,version) DO UPDATE SET manifest_json=excluded.manifest_json
  `);
  const transaction = db.transaction(() => {
    for (const manifest of manifests) {
      upsertTest.run({
        slug: manifest.slug,
        name: manifest.name,
        description: manifest.description || "",
        mode: manifest.mode,
        entryPath: `/tests/${manifest.slug}/${manifest.entry}`,
        codePrefix: manifest.codePrefix || manifest.slug.slice(0, 6).toUpperCase(),
        version: manifest.version,
        now,
      });
      const test = db.prepare("SELECT id FROM tests WHERE slug=?").get(manifest.slug);
      upsertVersion.run({ testId: test.id, version: manifest.version, manifest: JSON.stringify(manifest), now });
    }
  });
  transaction();
}

function ensureLegacyBatch(db, testId, name, createdAt, count) {
  let batch = db.prepare("SELECT id FROM code_batches WHERE test_id=? AND name=? ORDER BY id LIMIT 1").get(testId, name);
  if (!batch) {
    const result = db.prepare("INSERT INTO code_batches(test_id,name,prefix,total_count,created_at) VALUES(?,?,?,?,?)")
      .run(testId, name, "DL13", count, createdAt);
    batch = { id: Number(result.lastInsertRowid) };
  }
  return batch.id;
}

function migrateLegacy(db, config) {
  const test = db.prepare("SELECT id FROM tests WHERE slug='moonlit-fate'").get();
  if (!test) return;
  const insert = db.prepare(`
    INSERT INTO licenses(test_id,batch_id,code_hash,status,device_hash,created_at,redeemed_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(code_hash) DO UPDATE SET
      device_hash=COALESCE(licenses.device_hash,excluded.device_hash),
      redeemed_at=COALESCE(licenses.redeemed_at,excluded.redeemed_at),
      status=CASE WHEN licenses.status='disabled' THEN 'disabled' WHEN excluded.device_hash IS NOT NULL THEN 'redeemed' ELSE licenses.status END
  `);

  if (existsSync(config.legacySeedPath)) {
    const seed = readJson(config.legacySeedPath);
    const hashes = [...new Set(seed.hashes || [])].filter((value) => /^[a-f0-9]{64}$/.test(value));
    const createdAt = seed.createdAt || new Date().toISOString();
    const batchId = ensureLegacyBatch(db, test.id, seed.batch || "legacy-seed", createdAt, hashes.length);
    db.transaction(() => {
      for (const codeHash of hashes) insert.run(test.id, batchId, codeHash, "available", null, createdAt, null);
    })();
  }

  const legacyJsonPath = resolve(config.dataDir, "licenses.json");
  if (existsSync(legacyJsonPath)) {
    const legacy = readJson(legacyJsonPath);
    const records = Object.entries(legacy.licenses || {});
    const createdAt = new Date().toISOString();
    db.transaction(() => {
      for (const [codeHash, record] of records) {
        if (!/^[a-f0-9]{64}$/.test(codeHash)) continue;
        const batchId = ensureLegacyBatch(db, test.id, record.batch || "legacy-json", record.createdAt || createdAt, 0);
        insert.run(
          test.id,
          batchId,
          codeHash,
          record.deviceHash ? "redeemed" : "available",
          record.deviceHash || null,
          record.createdAt || createdAt,
          record.redeemedAt || null,
        );
      }
    })();
  }
}

export function openDatabase(config) {
  mkdirSync(config.dataDir, { recursive: true });
  const databasePath = resolve(config.dataDir, "platform.sqlite");
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  applySchema(db);
  registerTests(db, loadManifests(config.registryPath));
  migrateLegacy(db, config);
  return { db, databasePath };
}
