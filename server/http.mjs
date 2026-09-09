import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, createGzip } from "node:zlib";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
};
const compressible = new Set([".css", ".html", ".js", ".json", ".svg", ".txt"]);

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

export async function readJson(req, maxBytes = 2_000_000) {
  let text = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    text += chunk;
  }
  try { return JSON.parse(text || "{}"); }
  catch { throw Object.assign(new Error("请求格式无效"), { status: 400 }); }
}

export function sameOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  try { return new URL(origin).host === forwardedHost; } catch { return false; }
}

export async function serveStatic(req, res, publicRoot) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { return sendJson(res, 400, { error: "请求地址无效" }); }

  if ((pathname === "/admin" || /^\/tests\/[^/]+$/.test(pathname))) {
    res.writeHead(308, { location: `${pathname}/`, "cache-control": "no-store" });
    res.end();
    return true;
  }

  let relative = normalize(pathname).replace(/^[/\\]+/, "");
  if (!relative || relative === ".") relative = "index.html";
  else if (pathname.endsWith("/")) relative = join(relative, "index.html");
  const file = resolve(publicRoot, relative);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) return sendJson(res, 403, { error: "禁止访问" });

  let info;
  try {
    info = await stat(file);
    if (!info.isFile()) return false;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  const extension = extname(file).toLowerCase();
  const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  const mutable = new Set([".html", ".css", ".js", ".json"]).has(extension) || pathname.startsWith("/admin/");
  const headers = {
    "content-type": contentTypes[extension] || "application/octet-stream",
    "cache-control": mutable ? "no-cache" : "public, max-age=604800, immutable",
    etag,
    "last-modified": info.mtime.toUTCString(),
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  const accepts = String(req.headers["accept-encoding"] || "");
  let transform;
  if (info.size > 1024 && compressible.has(extension) && /\bbr\b/.test(accepts)) {
    headers["content-encoding"] = "br";
    transform = createBrotliCompress();
  } else if (info.size > 1024 && compressible.has(extension) && /\bgzip\b/.test(accepts)) {
    headers["content-encoding"] = "gzip";
    transform = createGzip();
  } else headers["content-length"] = info.size;
  if (transform) headers.vary = "Accept-Encoding";

  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else if (transform) await pipeline(createReadStream(file), transform, res);
  else await pipeline(createReadStream(file), res);
  return true;
}
