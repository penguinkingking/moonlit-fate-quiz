import { createServer } from "node:http";
import { createAuditService } from "./audit.mjs";
import { createAuthService } from "./auth.mjs";
import { createBackupService } from "./backup.mjs";
import { loadConfig } from "./config.mjs";
import { openDatabase } from "./database.mjs";
import { clientIp, readJson, sameOrigin, sendJson, serveStatic } from "./http.mjs";
import { createLicenseService } from "./licenses.mjs";

const config = loadConfig();
const { db, databasePath } = openDatabase(config);
const audit = createAuditService(db);
const auth = createAuthService(db, config, audit);
const licenses = createLicenseService(db, config, audit);
const backups = createBackupService(db, config, audit);

function testRows() {
  return db.prepare(`
    SELECT t.id,t.slug,t.name,t.description,t.mode,t.status,t.entry_path AS entryPath,
           t.active_version AS activeVersion,t.updated_at AS updatedAt,
           COUNT(l.id) AS codeCount,
           SUM(CASE WHEN l.status='available' AND l.code_ciphertext IS NOT NULL THEN 1 ELSE 0 END) AS availableCount,
           SUM(CASE WHEN l.status='available' AND l.code_ciphertext IS NULL THEN 1 ELSE 0 END) AS pendingImportCount,
           SUM(CASE WHEN l.status='allocated' THEN 1 ELSE 0 END) AS allocatedCount,
           SUM(CASE WHEN l.status='redeemed' THEN 1 ELSE 0 END) AS redeemedCount,
           SUM(CASE WHEN l.status='disabled' THEN 1 ELSE 0 END) AS disabledCount
    FROM tests t LEFT JOIN licenses l ON l.test_id=t.id
    GROUP BY t.id ORDER BY t.id
  `).all().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? 0])));
}

function batchRows() {
  return db.prepare(`
    SELECT b.id,b.name,b.prefix,b.total_count AS totalCount,b.created_at AS createdAt,
           t.slug AS testSlug,t.name AS testName,
           COUNT(l.id) AS importedCount,
           SUM(CASE WHEN l.status='available' AND l.code_ciphertext IS NOT NULL THEN 1 ELSE 0 END) AS availableCount,
           SUM(CASE WHEN l.status='allocated' THEN 1 ELSE 0 END) AS allocatedCount,
           SUM(CASE WHEN l.status='redeemed' THEN 1 ELSE 0 END) AS redeemedCount
    FROM code_batches b JOIN tests t ON t.id=b.test_id LEFT JOIN licenses l ON l.batch_id=b.id
    GROUP BY b.id ORDER BY b.id DESC LIMIT 200
  `).all().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? 0])));
}

function dashboard() {
  const tests = testRows();
  return {
    tests: tests.length,
    codes: tests.reduce((sum, item) => sum + item.codeCount, 0),
    available: tests.reduce((sum, item) => sum + item.availableCount, 0),
    pendingImport: tests.reduce((sum, item) => sum + item.pendingImportCount, 0),
    allocated: tests.reduce((sum, item) => sum + item.allocatedCount, 0),
    redeemed: tests.reduce((sum, item) => sum + item.redeemedCount, 0),
    disabled: tests.reduce((sum, item) => sum + item.disabledCount, 0),
    databasePath,
  };
}

function pathOf(req) {
  try { return new URL(req.url, "http://localhost").pathname; }
  catch { return ""; }
}

async function publicApi(req, res, path) {
  if (req.method === "GET" && (path === "/health/live" || path === "/api/license/status")) {
    return sendJson(res, 200, { ok: true, service: "test-platform" });
  }
  if (req.method === "GET" && path === "/health/ready") {
    try {
      db.prepare("SELECT 1").get();
      const version = db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get();
      return sendJson(res, 200, { ok: true, database: true, schemaVersion: Number(version?.value || 0), tests: testRows().length });
    } catch {
      return sendJson(res, 503, { ok: false, error: "数据库未就绪" });
    }
  }
  if (req.method === "POST" && (path === "/api/public/licenses/redeem" || path === "/api/license/redeem")) {
    const input = await readJson(req);
    const result = licenses.redeem({ ...input, testSlug: input.testSlug || "moonlit-fate" });
    return sendJson(res, result.status, result.body);
  }
  if (req.method === "POST" && path === "/api/public/licenses/verify") {
    const result = licenses.verify(await readJson(req));
    return sendJson(res, result.status, result.body);
  }
  return false;
}

async function adminApi(req, res, path) {
  if (!path.startsWith("/api/admin/")) return false;
  if (!sameOrigin(req)) return sendJson(res, 403, { error: "请求来源无效" });

  if (req.method === "POST" && path === "/api/admin/login") {
    const input = await readJson(req, 20_000);
    const result = auth.login(req, String(input.username || ""), String(input.password || ""));
    if (!result.ok) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { authenticated: true, username: result.username }, { "set-cookie": result.cookie });
  }

  const session = auth.authenticate(req);
  if (!session) return sendJson(res, 401, { error: "登录已失效，请重新登录" });

  if (req.method === "POST" && path === "/api/admin/logout") {
    return sendJson(res, 200, { ok: true }, { "set-cookie": auth.logout(req, session) });
  }
  if (req.method === "GET" && path === "/api/admin/session") return sendJson(res, 200, { authenticated: true, username: session.username });
  if (req.method === "GET" && path === "/api/admin/dashboard") return sendJson(res, 200, dashboard());
  if (req.method === "GET" && path === "/api/admin/tests") return sendJson(res, 200, { tests: testRows() });
  if (req.method === "GET" && path === "/api/admin/batches") return sendJson(res, 200, { batches: batchRows() });
  if (req.method === "GET" && path === "/api/admin/audit") return sendJson(res, 200, { logs: audit.list(new URL(req.url, "http://localhost").searchParams.get("limit")) });
  if (req.method === "GET" && path === "/api/admin/backups") return sendJson(res, 200, { backups: await backups.list() });
  if (req.method === "GET" && path === "/api/admin/licenses") {
    const params = new URL(req.url, "http://localhost").searchParams;
    return sendJson(res, 200, { licenses: licenses.list({ testSlug: params.get("testSlug"), query: params.get("query"), status: params.get("status"), limit: params.get("limit") }) });
  }
  const exportMatch = path.match(/^\/api\/admin\/batches\/(\d+)\/export$/);
  if (req.method === "GET" && exportMatch) {
    const result = licenses.exportBatch(exportMatch[1], session.username, clientIp(req));
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${result.filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(result.text);
    return;
  }

  if (req.method === "POST" && path === "/api/admin/licenses/generate") {
    const result = licenses.generate({ ...(await readJson(req)), username: session.username, ipAddress: clientIp(req) });
    return sendJson(res, 201, result);
  }
  if (req.method === "POST" && path === "/api/admin/licenses/import") {
    await backups.create({ username: session.username, reason: "before-import", ipAddress: clientIp(req) });
    const result = licenses.importCodes({ ...(await readJson(req)), username: session.username, ipAddress: clientIp(req) });
    return sendJson(res, 201, result);
  }
  if (req.method === "POST" && path === "/api/admin/licenses/allocate") {
    const result = licenses.allocate({ ...(await readJson(req)), username: session.username, ipAddress: clientIp(req) });
    return sendJson(res, 201, result);
  }
  if (req.method === "POST" && path === "/api/admin/licenses/action") {
    const result = licenses.action({ ...(await readJson(req)), username: session.username, ipAddress: clientIp(req) });
    return sendJson(res, 200, result);
  }
  if (req.method === "POST" && path === "/api/admin/backups") {
    const result = await backups.create({ username: session.username, reason: "manual", ipAddress: clientIp(req) });
    return sendJson(res, 201, { name: result.name });
  }
  return sendJson(res, 404, { error: "管理接口不存在" });
}

let shuttingDown = false;
const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const path = pathOf(req);
  res.once("finish", () => {
    if (res.statusCode >= 400) console.warn(`[http] ${req.method} ${path || "invalid"} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  try {
    if (shuttingDown && path !== "/health/live") return sendJson(res, 503, { error: "服务正在重启" });
    const publicHandled = await publicApi(req, res, path);
    if (publicHandled !== false) return;
    const adminHandled = await adminApi(req, res, path);
    if (adminHandled !== false) return;
    if (await serveStatic(req, res, config.publicRoot)) return;
    sendJson(res, 404, { error: "页面不存在" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : "服务器暂时不可用" });
    else res.destroy();
  }
});

const backupTimer = backups.schedule();
const cleanupTimer = setInterval(() => auth.cleanup(), 60 * 60_000);
cleanupTimer.unref();
server.listen(config.port, "0.0.0.0", () => console.log(`Test platform listening on ${config.port}; database=${databasePath}`));

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}`);
  clearInterval(backupTimer);
  clearInterval(cleanupTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
