export type LicenseStatus = { authorized: boolean; deviceId?: string };

const DEVICE_KEY = "moonlit-device-id";
const TOKEN_KEY = "moonlit-license-token";

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId() {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = makeId();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getLicenseToken() {
  return typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_KEY) || "";
}

export function isLocallyAuthorized() {
  return Boolean(getLicenseToken());
}

export async function redeemLicense(code: string) {
  const response = await fetch("/api/license/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceId: getDeviceId() }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; token?: string };
  if (!response.ok) throw new Error(data.error || "兑换失败，请稍后重试");
  if (data.token) window.localStorage.setItem(TOKEN_KEY, data.token);
  return data as { authorized: true; token: string };
}
