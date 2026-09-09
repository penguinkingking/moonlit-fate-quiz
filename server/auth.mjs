import { randomBytes } from "node:crypto";
import { sha256, verifyPassword } from "./crypto.mjs";

const COOKIE_NAME = "test_platform_admin";

function parseCookies(header) {
  return Object.fromEntries(String(header || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function secureRequest(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

export function createAuthService(db, config, audit) {
  const attempts = new Map();
  const insert = db.prepare("INSERT INTO admin_sessions(token_hash,username,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)");
  const find = db.prepare("SELECT id,username,expires_at AS expiresAt,revoked_at AS revokedAt FROM admin_sessions WHERE token_hash=?");
  const touch = db.prepare("UPDATE admin_sessions SET last_seen_at=? WHERE id=?");
  const revoke = db.prepare("UPDATE admin_sessions SET revoked_at=? WHERE token_hash=?");
  const sessionHash = (token) => sha256(`${token}:${config.sessionSecret}`);

  function rateKey(req) {
    return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  }

  function allowed(req) {
    const key = rateKey(req);
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((value) => now - value < 15 * 60_000);
    attempts.set(key, recent);
    return recent.length < 10;
  }

  function failed(req) {
    const key = rateKey(req);
    attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
  }

  return {
    cookieName: COOKIE_NAME,
    login(req, username, password) {
      if (!allowed(req)) return { ok: false, status: 429, error: "登录尝试过多，请稍后再试" };
      const usernameMatches = sha256(username) === sha256(config.adminUsername);
      const passwordMatches = verifyPassword(password, config.adminPassword, config.adminPasswordHash);
      if (!usernameMatches || !passwordMatches) {
        failed(req);
        audit.record({ username: username || "unknown", action: "admin.login_failed", ipAddress: rateKey(req) });
        return { ok: false, status: 401, error: "用户名或密码错误" };
      }
      const token = randomBytes(32).toString("base64url");
      const now = new Date();
      const expires = new Date(now.getTime() + config.sessionHours * 60 * 60_000);
      insert.run(sessionHash(token), config.adminUsername, now.toISOString(), expires.toISOString(), now.toISOString());
      attempts.delete(rateKey(req));
      audit.record({ username: config.adminUsername, action: "admin.login", ipAddress: rateKey(req) });
      const flags = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${config.sessionHours * 3600}`];
      if (secureRequest(req) || config.publicBaseUrl.startsWith("https://")) flags.push("Secure");
      return { ok: true, username: config.adminUsername, cookie: flags.join("; ") };
    },
    authenticate(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (!token) return null;
      const session = find.get(sessionHash(token));
      if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
      touch.run(new Date().toISOString(), session.id);
      return { id: session.id, username: session.username, token };
    },
    logout(req, session) {
      if (session) {
        revoke.run(new Date().toISOString(), sessionHash(session.token));
        audit.record({ username: session.username, action: "admin.logout", ipAddress: rateKey(req) });
      }
      const flags = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
      if (secureRequest(req) || config.publicBaseUrl.startsWith("https://")) flags.push("Secure");
      return flags.join("; ");
    },
    cleanup() {
      db.prepare("DELETE FROM admin_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").run(new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    },
  };
}
