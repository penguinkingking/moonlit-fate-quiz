import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createAuditService } from "../server/audit.mjs";
import { sha256 } from "../server/crypto.mjs";
import { openDatabase } from "../server/database.mjs";
import { createLicenseService } from "../server/licenses.mjs";

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url, process, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode != null) throw new Error(`Server exited early:\n${output.join("")}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Server did not become ready:\n${output.join("")}`);
}

test("platform supports isolated tests, admin fulfillment, and backups", { timeout: 40_000 }, async (context) => {
  const dataDir = await mkdtemp(resolve(tmpdir(), "test-platform-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_USERNAME: "test-admin",
      ADMIN_PASSWORD: "test-password",
      SESSION_SECRET: "session-secret-for-automated-tests-123456",
      LICENSE_TOKEN_SECRET: "license-secret-for-automated-tests-123456",
      CODE_ENCRYPTION_KEY: "encryption-key-for-automated-tests-123456",
      PUBLIC_BASE_URL: baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));
  context.after(async () => {
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait));
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitFor(`${baseUrl}/health/ready`, server, output);

  const rootPage = await fetch(`${baseUrl}/`);
  assert.equal(rootPage.status, 200);
  assert.match(await rootPage.text(), /月下心笺/);
  const innerPage = await fetch(`${baseUrl}/tests/inner-voices/`);
  assert.equal(innerPage.status, 200);
  assert.match(await innerPage.text(), /TestPlatformLicense/);
  const adminPage = await fetch(`${baseUrl}/admin/`);
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /测试产品管理后台/);

  assert.equal((await fetch(`${baseUrl}/api/admin/dashboard`)).status, 401);
  const badLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "wrong" }),
  });
  assert.equal(badLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "test-password" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const adminFetch = (path, options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { cookie, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  });
  const adminPost = (path, body) => adminFetch(path, { method: "POST", body: JSON.stringify(body) });

  const tests = await (await adminFetch("/api/admin/tests")).json();
  assert.deepEqual(tests.tests.map((item) => item.slug), ["moonlit-fate", "inner-voices"]);

  const generatedResponse = await adminPost("/api/admin/licenses/generate", { testSlug: "inner-voices", count: 12, batchName: "integration" });
  assert.equal(generatedResponse.status, 201);
  const generated = await generatedResponse.json();
  assert.equal(generated.codes.length, 12);

  const deviceId = "integration-device-0001";
  const redemption = await fetch(`${baseUrl}/api/public/licenses/redeem`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ testSlug: "inner-voices", code: generated.codes[0], deviceId }),
  });
  assert.equal(redemption.status, 200);
  const token = (await redemption.json()).token;
  const verification = await fetch(`${baseUrl}/api/public/licenses/verify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ testSlug: "inner-voices", deviceId, token }),
  });
  assert.equal(verification.status, 200);

  const crossTest = await fetch(`${baseUrl}/api/public/licenses/redeem`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ testSlug: "moonlit-fate", code: generated.codes[1], deviceId: "integration-device-0002" }),
  });
  assert.equal(crossTest.status, 404);

  const allocations = await Promise.all(Array.from({ length: 8 }, (_, index) => adminPost("/api/admin/licenses/allocate", {
    testSlug: "inner-voices", orderRef: `order-${index}`,
  }).then((response) => response.json())));
  assert.equal(new Set(allocations.map((item) => item.code)).size, 8);
  const repeated = await (await adminPost("/api/admin/licenses/allocate", { testSlug: "inner-voices", orderRef: "order-2" })).json();
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.code, allocations[2].code);

  const search = await (await adminFetch("/api/admin/licenses?query=order-2")).json();
  assert.equal(search.licenses.length, 1);
  const licenseId = search.licenses[0].id;
  assert.equal((await adminPost("/api/admin/licenses/action", { id: licenseId, action: "disable" })).status, 200);
  assert.equal((await adminPost("/api/admin/licenses/action", { id: licenseId, action: "enable" })).status, 200);

  const importResponse = await adminPost("/api/admin/licenses/import", {
    testSlug: "moonlit-fate", batchName: "import-test", codes: "CUSTOM-ABCD-EFGH-JKLM\nCUSTOM-ABCD-EFGH-JKLM\n",
  });
  assert.equal(importResponse.status, 201);
  const imported = await importResponse.json();
  assert.equal(imported.added, 1);
  assert.equal(imported.total, 1);

  const backupResponse = await adminPost("/api/admin/backups", {});
  assert.equal(backupResponse.status, 201);
  const backups = await (await adminFetch("/api/admin/backups")).json();
  assert.ok(backups.backups.length >= 1);
  assert.ok(backups.backups[0].size > 0);
});

test("legacy hashes can be completed and legacy browser tokens are upgraded", async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), "test-platform-legacy-"));
  const seedPath = resolve(dataDir, "legacy-seed.json");
  const code = "DL13-AAAA-BBBB-CCCC";
  const codeHash = sha256(code);
  await writeFile(seedPath, JSON.stringify({ batch: "legacy-test", createdAt: "2026-09-01T00:00:00.000Z", hashes: [codeHash] }));
  const config = {
    dataDir,
    registryPath: resolve(process.cwd(), "tests-registry.json"),
    legacySeedPath: seedPath,
    codeEncryptionKey: "legacy-encryption-key-for-tests-123456",
    licenseTokenSecret: "new-license-token-key-for-tests-123456",
    legacyLicenseTokenSecret: "old-license-token-key-for-tests-123456",
  };
  const { db } = openDatabase(config);
  try {
    const audit = createAuditService(db);
    const licenses = createLicenseService(db, config, audit);
    const imported = licenses.importCodes({ testSlug: "moonlit-fate", codes: [code], batchName: "plaintext", username: "test" });
    assert.equal(imported.added, 0);
    assert.equal(imported.completed, 1);
    const allocation = licenses.allocate({ testSlug: "moonlit-fate", orderRef: "legacy-order", username: "test" });
    assert.equal(allocation.code, code);
    const deviceId = "legacy-browser-device-001";
    assert.equal(licenses.redeem({ testSlug: "moonlit-fate", code, deviceId }).status, 200);
    const legacyToken = sha256(`${codeHash}:${sha256(deviceId)}:${config.legacyLicenseTokenSecret}`);
    const upgraded = licenses.verify({ testSlug: "moonlit-fate", deviceId, token: legacyToken });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.body.upgraded, true);
    assert.ok(upgraded.body.token.includes("."));
  } finally {
    db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
