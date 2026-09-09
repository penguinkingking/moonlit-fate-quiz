import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function makeCode(prefix) {
  const bytes = randomBytes(12);
  const raw = [...bytes].map((byte) => CODE_ALPHABET[byte & 31]).join("");
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function encryptionKey(secret) {
  return createHash("sha256").update(secret).digest();
}

export function encryptCode(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptCode(value, secret) {
  const [version, iv, tag, encrypted] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Unsupported encrypted code format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyPayload(token, secret) {
  const [encoded, suppliedSignature] = String(token || "").split(".");
  if (!encoded || !suppliedSignature) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  let supplied;
  try { supplied = Buffer.from(suppliedSignature, "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return null; }
}

export function verifyPassword(input, plainPassword, encodedHash) {
  if (encodedHash) {
    const [kind, salt, expectedHex] = encodedHash.split("$");
    if (kind !== "scrypt" || !salt || !/^[a-f0-9]{128}$/i.test(expectedHex || "")) return false;
    const actual = scryptSync(String(input), Buffer.from(salt, "base64url"), 64);
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  const actual = createHash("sha256").update(String(input)).digest();
  const expected = createHash("sha256").update(String(plainPassword)).digest();
  return timingSafeEqual(actual, expected);
}

export function createPasswordHash(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("hex")}`;
}
