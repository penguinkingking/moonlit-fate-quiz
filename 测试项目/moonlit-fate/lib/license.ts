export type LicenseStatus = { authorized: boolean };

const TEST_SLUG = "moonlit-fate";
const DEVICE_KEY = "test-platform:device-id";
const LEGACY_DEVICE_KEY = "moonlit-device-id";
const TOKEN_KEY = `test-platform:${TEST_SLUG}:license-token`;
const LEGACY_TOKEN_KEY = "moonlit-license-token";

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId() {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) id = window.localStorage.getItem(LEGACY_DEVICE_KEY);
  if (!id) {
    id = makeId();
  }
  window.localStorage.setItem(DEVICE_KEY, id);
  return id;
}

export function getLicenseToken() {
  return typeof window === "undefined"
    ? ""
    : window.localStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(LEGACY_TOKEN_KEY) || "";
}

export async function verifyLicense() {
  const token = getLicenseToken();
  if (!token) return false;
  const response = await fetch("/api/public/licenses/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ testSlug: TEST_SLUG, deviceId: getDeviceId(), token }),
  });
  if (!response.ok) {
    window.localStorage.removeItem(TOKEN_KEY);
    return false;
  }
  const data = (await response.json().catch(() => ({}))) as LicenseStatus & { token?: string };
  if (data.token) {
    window.localStorage.setItem(TOKEN_KEY, data.token);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  return data.authorized === true;
}

export async function redeemLicense(code: string) {
  const response = await fetch("/api/public/licenses/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ testSlug: TEST_SLUG, code, deviceId: getDeviceId() }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; token?: string };
  if (!response.ok) throw new Error(data.error || "兑换失败，请稍后重试");
  if (data.token) window.localStorage.setItem(TOKEN_KEY, data.token);
  return data as { authorized: true; token: string };
}
