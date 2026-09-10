import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const baseUrl = String(process.env.PRODUCTION_BASE_URL || "").replace(/\/$/, "");
const username = process.env.PRODUCTION_ADMIN_USERNAME;
const password = process.env.PRODUCTION_ADMIN_PASSWORD;
const smokeTestSlug = process.env.PRODUCTION_SMOKE_TEST_SLUG;
const smokeCode = process.env.PRODUCTION_SMOKE_CODE;
const expectedTests = Number(process.env.EXPECTED_TESTS || 1);

function requireEnvironment(names) {
  for (const name of names) if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(15_000) });
  return response;
}

async function login() {
  const response = await request("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Production admin login returned ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Production admin login did not return a session cookie");
  return cookie;
}

function adminRequest(cookie, path, options = {}) {
  return request(path, {
    ...options,
    headers: {
      cookie,
      origin: baseUrl,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function adminJson(cookie, path, options = {}) {
  const response = await adminRequest(cookie, path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${payload.error || "request failed"}`);
  return payload;
}

async function waitUntilReady() {
  const deadline = Date.now() + 2 * 60_000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await request("/health/ready");
      const payload = await response.json();
      last = `${response.status} ${JSON.stringify(payload)}`;
      if (response.ok && payload.ok && payload.database && payload.tests === expectedTests) return payload;
    } catch (error) { last = error.message; }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Production did not become ready: ${last}`);
}

async function verifyPageAndAssets(path) {
  const response = await request(path);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const html = await response.text();
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css))"/g)]
    .map((match) => new URL(match[1], `${baseUrl}${path}`).pathname);
  for (const assetPath of new Set(assetPaths)) {
    const asset = await request(assetPath);
    if (!asset.ok) throw new Error(`${assetPath} returned ${asset.status}`);
  }
  return { path, assets: new Set(assetPaths).size };
}

async function createBackup() {
  requireEnvironment(["PRODUCTION_BASE_URL", "PRODUCTION_ADMIN_USERNAME", "PRODUCTION_ADMIN_PASSWORD"]);
  const cookie = await login();
  try {
    const created = await adminJson(cookie, "/api/admin/backups", { method: "POST", body: "{}" });
    const listed = await adminJson(cookie, "/api/admin/backups");
    const backup = listed.backups?.find((item) => item.name === created.name);
    if (!backup || backup.size <= 0) throw new Error("Created backup is missing or empty");
    console.log(JSON.stringify({ ok: true, backup: { name: backup.name, size: backup.size } }));
  } finally {
    await adminRequest(cookie, "/api/admin/logout", { method: "POST", body: "{}" }).catch(() => {});
  }
}

function questionLabel(index) {
  return `事故 ${String(index).padStart(2, "0")} / 16`;
}

async function runBrowserJourney(entryPath) {
  const launchOptions = process.env.PLAYWRIGHT_CHROME_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH, headless: true }
    : { channel: "chrome", headless: true };
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  let collectErrors = true;

  page.on("pageerror", (error) => {
    if (collectErrors) browserErrors.push(`page error: ${error.message}`);
  });
  page.on("console", (message) => {
    if (collectErrors && message.type() === "error") browserErrors.push(`console error: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (collectErrors && response.status() >= 400) browserErrors.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  try {
    await page.goto(new URL(entryPath, `${baseUrl}/`).href, { waitUntil: "networkidle", timeout: 30_000 });
    const gate = page.locator(".platform-license-gate");
    await gate.waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('.platform-license-form input[name="code"]').fill(smokeCode);
    await page.locator('.platform-license-form button[type="submit"]').click();
    await gate.waitFor({ state: "detached", timeout: 15_000 });

    const authorized = await page.locator("html").evaluate((element) => element.classList.contains("platform-authorized"));
    if (!authorized) throw new Error("Browser did not enter the authorized state");
    const browserLicense = await page.evaluate((slug) => ({
      deviceId: localStorage.getItem("test-platform:device-id"),
      token: localStorage.getItem(`test-platform:${slug}:license-token`),
    }), smokeTestSlug);
    if (!browserLicense.deviceId || !browserLicense.token) throw new Error("Browser authorization was not persisted");

    await page.locator("#startButton").click();
    await page.locator("#questionNumber").waitFor({ state: "visible" });
    await page.waitForFunction((label) => document.querySelector("#questionNumber")?.textContent === label, questionLabel(1));

    await page.locator('.option-button[data-option-index="0"]').click();
    await page.waitForFunction((label) => document.querySelector("#questionNumber")?.textContent === label, questionLabel(2));
    await page.locator("#backButton").click();
    await page.waitForFunction((label) => document.querySelector("#questionNumber")?.textContent === label, questionLabel(1));
    const restored = page.locator('.option-button[data-option-index="0"]');
    if (await restored.getAttribute("aria-pressed") !== "true" || !(await restored.evaluate((button) => button.classList.contains("selected")))) {
      throw new Error("Previous-question selection was not restored");
    }

    await page.locator('.option-button[data-option-index="1"]').click();
    await page.waitForFunction((label) => document.querySelector("#questionNumber")?.textContent === label, questionLabel(2));
    for (let question = 2; question <= 15; question += 1) {
      await page.locator('.option-button[data-option-index="0"]').click();
      await page.waitForFunction((label) => document.querySelector("#questionNumber")?.textContent === label, questionLabel(question + 1));
    }
    await page.locator('.option-button[data-option-index="0"]').click();
    await page.locator("#resultScreen").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction(() => {
      const title = document.querySelector("#resultTitle")?.textContent?.trim();
      return Boolean(title && title !== "加载中");
    });

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      resultTitle: document.querySelector("#resultTitle")?.textContent?.trim() || "",
    }));
    if (layout.scrollWidth > layout.clientWidth + 1) {
      throw new Error(`Mobile page overflows horizontally (${layout.scrollWidth}px > ${layout.clientWidth}px)`);
    }
    if (browserErrors.length) throw new Error(`Browser journey reported errors: ${browserErrors.join(" | ")}`);
    collectErrors = false;

    return {
      browser,
      page,
      deviceId: browserLicense.deviceId,
      token: browserLicense.token,
      summary: { viewport: "390x844", questions: 16, previousAnswerRestored: true, resultTitle: layout.resultTitle },
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function runSmoke() {
  requireEnvironment([
    "PRODUCTION_BASE_URL", "PRODUCTION_ADMIN_USERNAME", "PRODUCTION_ADMIN_PASSWORD",
    "PRODUCTION_SMOKE_TEST_SLUG", "PRODUCTION_SMOKE_CODE",
  ]);
  const ready = await waitUntilReady();
  const cookie = await login();
  let deviceId = `release-smoke-${randomUUID()}`;
  let licenseId = null;
  let returnStatus = null;
  let token = null;
  let browserJourney = null;
  let primaryError = null;
  try {
    const tests = await adminJson(cookie, "/api/admin/tests");
    if (tests.tests?.length !== expectedTests) throw new Error(`Expected ${expectedTests} tests, found ${tests.tests?.length || 0}`);
    const target = tests.tests.find((item) => item.slug === smokeTestSlug);
    if (!target) throw new Error(`Smoke test ${smokeTestSlug} is not registered`);

    const pages = [];
    pages.push(await verifyPageAndAssets("/"));
    pages.push(await verifyPageAndAssets("/admin/"));
    for (const test of tests.tests) pages.push(await verifyPageAndAssets(test.entryPath));

    const reserved = await adminJson(cookie, `/api/admin/licenses?testSlug=${encodeURIComponent(smokeTestSlug)}&query=${encodeURIComponent(smokeCode)}&limit=1`);
    const reservedLicense = reserved.licenses?.[0];
    if (!reservedLicense || reservedLicense.status !== "allocated" || !reservedLicense.orderRef) {
      throw new Error("The production smoke code is not reserved as an allocated license");
    }
    licenseId = reservedLicense.id;
    returnStatus = reservedLicense.status;

    for (const test of tests.tests.filter((item) => item.slug !== smokeTestSlug)) {
      const cross = await request("/api/public/licenses/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ testSlug: test.slug, code: smokeCode, deviceId }),
      });
      if (cross.status !== 404) throw new Error(`Cross-test redemption for ${test.slug} returned ${cross.status}`);
    }

    browserJourney = await runBrowserJourney(target.entryPath);
    deviceId = browserJourney.deviceId;
    token = browserJourney.token;
    const verified = await request("/api/public/licenses/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ testSlug: smokeTestSlug, deviceId, token }),
    });
    if (!verified.ok) throw new Error(`Smoke-code verification returned ${verified.status}`);

    const found = await adminJson(cookie, `/api/admin/licenses?testSlug=${encodeURIComponent(smokeTestSlug)}&query=${encodeURIComponent(smokeCode)}&limit=1`);
    const license = found.licenses?.[0];
    if (!license || license.status !== "redeemed" || !license.deviceBound) throw new Error("Smoke code did not enter the expected redeemed state");
    licenseId = license.id;
    console.log(JSON.stringify({
      ok: true,
      ready,
      tests: tests.tests.length,
      pages,
      browser: browserJourney.summary,
      redemption: "verified",
    }));
  } catch (error) {
    primaryError = error;
  }
  try {
      if (token && !licenseId) {
        const found = await adminJson(cookie, `/api/admin/licenses?testSlug=${encodeURIComponent(smokeTestSlug)}&query=${encodeURIComponent(smokeCode)}&limit=1`);
        licenseId = found.licenses?.[0]?.id || null;
        returnStatus = found.licenses?.[0]?.orderRef ? "allocated" : "available";
      }
    if (licenseId) {
      await adminJson(cookie, "/api/admin/licenses/action", { method: "POST", body: JSON.stringify({ id: licenseId, action: "unbind" }) });
      const after = await adminJson(cookie, `/api/admin/licenses?testSlug=${encodeURIComponent(smokeTestSlug)}&query=${encodeURIComponent(smokeCode)}&limit=1`);
      if (after.licenses?.[0]?.status !== returnStatus || after.licenses?.[0]?.deviceBound) throw new Error(`Smoke code did not return to ${returnStatus} state`);
      if (token) {
        const stale = await request("/api/public/licenses/verify", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ testSlug: smokeTestSlug, deviceId, token }),
        });
        if (stale.status !== 401) throw new Error(`Unbound smoke token returned ${stale.status} instead of 401`);
      }
      if (browserJourney?.page) {
        await browserJourney.page.reload({ waitUntil: "networkidle", timeout: 30_000 });
        await browserJourney.page.locator(".platform-license-gate").waitFor({ state: "visible", timeout: 15_000 });
        const cleanupState = await browserJourney.page.evaluate((slug) => ({
          authorized: document.documentElement.classList.contains("platform-authorized"),
          token: localStorage.getItem(`test-platform:${slug}:license-token`),
        }), smokeTestSlug);
        if (cleanupState.authorized || cleanupState.token) throw new Error("Browser retained authorization after smoke-code cleanup");
      }
    }
  } catch (cleanupError) {
    primaryError = primaryError ? new AggregateError([primaryError, cleanupError], "Smoke test and cleanup both failed") : cleanupError;
  }
  await browserJourney?.browser?.close().catch(() => {});
  await adminRequest(cookie, "/api/admin/logout", { method: "POST", body: "{}" }).catch(() => {});
  if (primaryError) throw primaryError;
}

const command = process.argv[2];
if (command === "backup") await createBackup();
else if (command === "smoke") await runSmoke();
else throw new Error("Usage: production-release-smoke.mjs <backup|smoke>");
