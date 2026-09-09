(function () {
  "use strict";

  function createDeviceId() {
    return globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  }

  function storageKeys(testSlug) {
    return {
      device: "test-platform:device-id",
      token: `test-platform:${testSlug}:license-token`,
    };
  }

  function deviceId(keys) {
    let value = localStorage.getItem(keys.device);
    if (!value) {
      value = createDeviceId();
      localStorage.setItem(keys.device, value);
    }
    return value;
  }

  async function request(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "授权服务暂时不可用");
    return payload;
  }

  function mountGate(options) {
    const testSlug = options.testSlug;
    const testName = options.testName || "测试";
    const keys = storageKeys(testSlug);
    const root = document.createElement("div");
    root.className = "platform-license-gate";
    root.innerHTML = [
      '<div class="platform-license-panel" role="dialog" aria-modal="true" aria-labelledby="platform-license-title">',
      '<span class="platform-license-icon" aria-hidden="true">KEY</span>',
      `<p class="platform-license-kicker">${escapeHtml(testName)}</p>`,
      '<h1 id="platform-license-title">输入兑换码开始测试</h1>',
      '<p class="platform-license-copy">兑换成功后，这个浏览器可以重复进入本测试。</p>',
      '<form class="platform-license-form">',
      '<input name="code" aria-label="兑换码" autocomplete="off" placeholder="请输入兑换码" required>',
      '<button type="submit">立即解锁</button>',
      '</form>',
      '<p class="platform-license-error" role="alert" hidden></p>',
      '</div>',
    ].join("");
    document.body.appendChild(root);

    const form = root.querySelector("form");
    const input = root.querySelector("input");
    const button = root.querySelector("button");
    const error = root.querySelector(".platform-license-error");
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      error.hidden = true;
      button.disabled = true;
      button.textContent = "验证中...";
      try {
        const payload = await request("/api/public/licenses/redeem", {
          testSlug: testSlug,
          code: input.value,
          deviceId: deviceId(keys),
        });
        localStorage.setItem(keys.token, payload.token);
        root.remove();
        document.documentElement.classList.add("platform-authorized");
        if (options.onAuthorized) options.onAuthorized();
      } catch (reason) {
        error.textContent = reason instanceof Error ? reason.message : "兑换失败，请稍后重试";
        error.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = "立即解锁";
      }
    });
    input.focus();
  }

  async function start(options) {
    const keys = storageKeys(options.testSlug);
    const token = localStorage.getItem(keys.token) || "";
    if (token) {
      try {
        const payload = await request("/api/public/licenses/verify", {
          testSlug: options.testSlug,
          deviceId: deviceId(keys),
          token: token,
        });
        if (payload.authorized) {
          document.documentElement.classList.add("platform-authorized");
          if (options.onAuthorized) options.onAuthorized();
          return;
        }
      } catch {
        localStorage.removeItem(keys.token);
      }
    }
    mountGate(options);
  }

  globalThis.TestPlatformLicense = { start: start };
})();
