import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(root, "offline-build");
const dataRoot = resolve(process.env.MOONLIT_DATA_DIR || join(root, "data"));
const dbPath = join(dataRoot, "licenses.json");
const port = Number(process.env.PORT || 8787);
const adminKey = process.env.MOONLIT_ADMIN_KEY || "";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalizeCode = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
let state;
async function load() {
  await mkdir(dataRoot, { recursive: true });
  try { state = JSON.parse(await readFile(dbPath, "utf8")); }
  catch { state = { licenses: {} }; }
  for (const code of String(process.env.MOONLIT_CODES || "").split(",").map(normalizeCode).filter(Boolean)) {
    const codeHash = hash(code);
    if (!state.licenses[codeHash]) state.licenses[codeHash] = { createdAt: new Date().toISOString(), batch: "env" };
  }
  await save();
}
async function save() { await writeFile(dbPath, JSON.stringify(state, null, 2), "utf8"); }
function send(res, status, body) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); }
async function body(req) { let text = ""; for await (const chunk of req) text += chunk; return JSON.parse(text || "{}"); }
function licenseToken(codeHash, deviceHash) { return hash(`${codeHash}:${deviceHash}:${process.env.MOONLIT_TOKEN_SECRET || "local-secret"}`); }

async function api(req, res) {
  if (req.method === "POST" && req.url === "/api/license/redeem") {
    const input = await body(req).catch(() => ({}));
    const code = normalizeCode(input.code);
    const deviceId = String(input.deviceId || "").trim();
    if (!/^[A-Z0-9-]{8,64}$/.test(code) || deviceId.length < 12) return send(res, 400, { error: "请输入有效兑换码" });
    const codeHash = hash(code); const deviceHash = hash(deviceId); const existing = state.licenses[codeHash];
    if (!existing) return send(res, 404, { error: "兑换码无效" });
    if (existing.deviceHash && existing.deviceHash !== deviceHash) return send(res, 409, { error: "兑换码已在其他设备使用" });
    if (!existing.deviceHash) { existing.deviceHash = deviceHash; existing.redeemedAt = new Date().toISOString(); await save(); }
    return send(res, 200, { authorized: true, token: licenseToken(codeHash, deviceHash) });
  }
  if (req.method === "GET" && req.url === "/api/license/status") return send(res, 200, { ok: true });
  if (req.method === "POST" && req.url === "/api/admin/licenses") {
    if (!adminKey || req.headers.authorization !== `Bearer ${adminKey}`) return send(res, 401, { error: "未授权" });
    const input = await body(req).catch(() => ({})); const count = Math.min(1000, Math.max(1, Number(input.count || 1))); const codes = [];
    for (let i = 0; i < count; i++) { const raw = randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16); const code = `DL13-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`; state.licenses[hash(code)] = { createdAt: new Date().toISOString(), batch: input.batch || "default" }; codes.push(code); }
    await save(); return send(res, 201, { codes });
  }
  return false;
}
function staticFile(req, res) {
  let path = normalize(new URL(req.url, "http://localhost").pathname).replace(/^[/\\]+/, "");
  if (!path || path.includes("..")) path = "index.html";
  const file = resolve(publicRoot, path); if (!file.startsWith(publicRoot)) return send(res, 403, { error: "forbidden" });
  createReadStream(file).on("error", () => createReadStream(join(publicRoot, "index.html")).pipe(res)).pipe(res);
}
await load();
createServer(async (req, res) => { try { const handled = await api(req, res); if (handled !== false) return; staticFile(req, res); } catch (error) { console.error(error); send(res, 500, { error: "服务器暂时不可用" }); } }).listen(port, "0.0.0.0", () => console.log(`Moonlit server listening on ${port}`));
