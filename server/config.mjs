import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function integer(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig() {
  const config = {
    projectRoot,
    publicRoot: resolve(projectRoot, "web-build"),
    registryPath: resolve(projectRoot, "tests-registry.json"),
    legacySeedPath: resolve(projectRoot, "server", "legacy", "licenses.seed.json"),
    dataDir: resolve(process.env.DATA_DIR || resolve(projectRoot, "data")),
    port: integer("PORT", 8787),
    adminUsername: String(process.env.ADMIN_USERNAME || "").trim(),
    adminPassword: String(process.env.ADMIN_PASSWORD || ""),
    adminPasswordHash: String(process.env.ADMIN_PASSWORD_HASH || ""),
    sessionSecret: String(process.env.SESSION_SECRET || ""),
    licenseTokenSecret: String(process.env.LICENSE_TOKEN_SECRET || ""),
    legacyLicenseTokenSecret: String(process.env.LEGACY_LICENSE_TOKEN_SECRET || process.env.MOONLIT_TOKEN_SECRET || ""),
    codeEncryptionKey: String(process.env.CODE_ENCRYPTION_KEY || ""),
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    sessionHours: integer("ADMIN_SESSION_HOURS", 12),
    backupRetention: integer("BACKUP_RETENTION_DAYS", 14),
  };

  const missing = [];
  if (!config.adminUsername) missing.push("ADMIN_USERNAME");
  if (!config.adminPassword && !config.adminPasswordHash) missing.push("ADMIN_PASSWORD or ADMIN_PASSWORD_HASH");
  if (config.sessionSecret.length < 32) missing.push("SESSION_SECRET (at least 32 characters)");
  if (config.licenseTokenSecret.length < 32) missing.push("LICENSE_TOKEN_SECRET (at least 32 characters)");
  if (config.codeEncryptionKey.length < 32) missing.push("CODE_ENCRYPTION_KEY (at least 32 characters)");
  if (missing.length) throw new Error(`Missing or unsafe configuration: ${missing.join(", ")}`);
  if (!config.legacyLicenseTokenSecret) config.legacyLicenseTokenSecret = config.licenseTokenSecret;
  return config;
}
