(function () {
  "use strict";

  const state = { tests: [], dashboard: null, activeView: "overview" };
  const $ = (id) => document.getElementById(id);
  const viewTitles = {
    overview: ["PLATFORM OVERVIEW", "运营总览"],
    allocate: ["ORDER FULFILLMENT", "订单发码"],
    licenses: ["LICENSE INVENTORY", "兑换码管理"],
    batches: ["BATCH OPERATIONS", "批次与导入"],
    system: ["SYSTEM HEALTH", "系统与备份"],
  };
  const statusNames = { available: "未发放", allocated: "已分配", redeemed: "已兑换", disabled: "已停用" };
  const actionNames = {
    "admin.login": "管理员登录", "admin.logout": "管理员退出", "admin.login_failed": "登录失败",
    "licenses.generate": "生成兑换码", "licenses.import": "导入兑换码", "licenses.allocate": "分配兑换码",
    "licenses.allocate_repeat": "重复查询订单", "licenses.disable": "停用兑换码", "licenses.enable": "启用兑换码",
    "licenses.unbind": "解绑设备", "licenses.export": "导出批次", "backup.create": "创建备份",
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function formatTime(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value));
  }

  function formatBytes(value) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/admin/login") showLogin();
    if (!response.ok) throw new Error(payload.error || "操作失败，请稍后重试");
    return payload;
  }

  function post(path, body) { return api(path, { method: "POST", body: JSON.stringify(body) }); }

  let toastTimer;
  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2800);
  }

  function showLogin() {
    $("loginView").hidden = false;
    $("appView").hidden = true;
    $("password").value = "";
  }

  async function showApp(username) {
    $("loginView").hidden = true;
    $("appView").hidden = false;
    $("signedInUser").textContent = username;
    await refreshAll();
  }

  function optionList(includeAll) {
    return `${includeAll ? '<option value="">全部测试</option>' : ""}${state.tests.map((test) => `<option value="${escapeHtml(test.slug)}">${escapeHtml(test.name)}</option>`).join("")}`;
  }

  function populateTestSelects() {
    $("allocateTest").innerHTML = optionList(false);
    $("generateTest").innerHTML = optionList(false);
    $("importTest").innerHTML = optionList(false);
    const previous = $("searchTest").value;
    $("searchTest").innerHTML = optionList(true);
    $("searchTest").value = previous;
  }

  function renderDashboard() {
    const metrics = [
      ["测试项目", state.dashboard.tests], ["兑换码总数", state.dashboard.codes], ["可发放", state.dashboard.available],
      ["待补全旧码", state.dashboard.pendingImport], ["已分配", state.dashboard.allocated], ["已兑换", state.dashboard.redeemed],
    ];
    $("metrics").innerHTML = metrics.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${Number(value).toLocaleString("zh-CN")}</strong></article>`).join("");
    $("testsBody").innerHTML = state.tests.map((test) => `<tr><td><strong>${escapeHtml(test.name)}</strong><br><small>${escapeHtml(test.slug)}</small></td><td><a href="${escapeHtml(test.entryPath.replace(/index\.html$/, ""))}" target="_blank" rel="noopener">打开测试</a></td><td>${escapeHtml(test.activeVersion)}</td><td>${test.availableCount}</td><td>${test.pendingImportCount}</td><td>${test.allocatedCount}</td><td>${test.redeemedCount}</td></tr>`).join("");
  }

  function renderAudit(target, logs, compact) {
    if (compact) {
      $(target).innerHTML = logs.slice(0, 8).map((log) => `<div class="activity-item"><time>${formatTime(log.createdAt)}</time><span>${escapeHtml(actionNames[log.action] || log.action)}</span><small>${escapeHtml(log.objectId || "")}</small></div>`).join("") || '<p class="muted">暂无操作记录</p>';
      return;
    }
    $(target).innerHTML = logs.map((log) => `<tr><td>${formatTime(log.createdAt)}</td><td>${escapeHtml(log.username)}</td><td>${escapeHtml(actionNames[log.action] || log.action)}</td><td>${escapeHtml([log.objectType, log.objectId].filter(Boolean).join(" #"))}</td><td>${escapeHtml(JSON.stringify(log.detail || {}))}</td></tr>`).join("");
  }

  async function refreshAll() {
    const [dashboard, tests, audit] = await Promise.all([
      api("/api/admin/dashboard"), api("/api/admin/tests"), api("/api/admin/audit?limit=100"),
    ]);
    state.dashboard = dashboard;
    state.tests = tests.tests;
    populateTestSelects();
    renderDashboard();
    renderAudit("recentAudit", audit.logs, true);
    renderAudit("auditBody", audit.logs, false);
    await Promise.all([loadBatches(), loadLicenses(), loadBackups()]);
    $("systemStatus").innerHTML = `<dt>服务</dt><dd>运行正常</dd><dt>数据库</dt><dd>SQLite 持久化</dd><dt>测试项目</dt><dd>${state.dashboard.tests} 个</dd><dt>停用兑换码</dt><dd>${state.dashboard.disabled} 个</dd>`;
  }

  async function loadBatches() {
    const payload = await api("/api/admin/batches");
    $("batchesBody").innerHTML = payload.batches.map((batch) => `<tr><td>${escapeHtml(batch.name)}</td><td>${escapeHtml(batch.testName)}</td><td>${batch.importedCount}</td><td>${batch.availableCount}</td><td>${batch.allocatedCount}</td><td>${batch.redeemedCount}</td><td>${formatTime(batch.createdAt)}</td><td><a class="row-button" href="/api/admin/batches/${batch.id}/export">导出</a></td></tr>`).join("") || '<tr><td colspan="8">暂无批次</td></tr>';
  }

  async function loadLicenses() {
    const params = new URLSearchParams();
    if ($("searchTest").value) params.set("testSlug", $("searchTest").value);
    if ($("searchStatus").value) params.set("status", $("searchStatus").value);
    if ($("searchQuery").value.trim()) params.set("query", $("searchQuery").value.trim());
    const payload = await api(`/api/admin/licenses?${params}`);
    $("licensesBody").innerHTML = payload.licenses.map((item) => {
      const enableAction = item.status === "disabled" ? `<button class="row-button" data-license-action="enable" data-id="${item.id}">启用</button>` : `<button class="row-button" data-license-action="disable" data-id="${item.id}">停用</button>`;
      const unbind = item.deviceBound ? `<button class="row-button" data-license-action="unbind" data-id="${item.id}">解绑</button>` : "";
      return `<tr><td>${item.id}</td><td>${escapeHtml(item.testName)}</td><td>${escapeHtml(item.codeMasked)}</td><td><span class="status-badge status-${item.status}">${statusNames[item.status] || item.status}</span></td><td>${escapeHtml(item.orderRef || "-")}</td><td>${formatTime(item.redeemedAt || item.allocatedAt || item.createdAt)}</td><td><div class="row-actions">${enableAction}${unbind}</div></td></tr>`;
    }).join("") || '<tr><td colspan="7">没有匹配的兑换码</td></tr>';
  }

  async function loadBackups() {
    const payload = await api("/api/admin/backups");
    $("backupList").innerHTML = payload.backups.map((item) => `<div class="plain-item"><strong>${escapeHtml(item.name)}</strong><small>${formatTime(item.createdAt)}</small><span>${formatBytes(item.size)}</span></div>`).join("") || '<p class="muted">尚未生成备份</p>';
  }

  function switchView(name) {
    state.activeView = name;
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === name));
    $("pageKicker").textContent = viewTitles[name][0];
    $("pageTitle").textContent = viewTitles[name][1];
    document.querySelector(".sidebar").classList.remove("open");
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    $("loginError").hidden = true;
    try {
      const result = await post("/api/admin/login", { username: $("username").value, password: $("password").value });
      await showApp(result.username);
    } catch (error) {
      $("loginError").textContent = error.message;
      $("loginError").hidden = false;
    } finally { button.disabled = false; }
  });

  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("menuButton").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
  $("refreshButton").addEventListener("click", async () => { await refreshAll(); toast("数据已刷新"); });
  $("logoutButton").addEventListener("click", async () => { await post("/api/admin/logout", {}); showLogin(); });
  $("licenseSearchForm").addEventListener("submit", async (event) => { event.preventDefault(); await loadLicenses(); });

  $("allocateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const result = await post("/api/admin/licenses/allocate", { testSlug: $("allocateTest").value, orderRef: $("orderRef").value.trim() });
      $("allocatedCode").textContent = result.code;
      $("allocationRepeat").hidden = !result.repeated;
      $("buyerReply").value = `感谢购买。\n\n测试入口和使用方式请查看夸克网盘文件。\n你的兑换码：${result.code}\n\n此兑换码用于「${result.testName}」，首次使用后绑定当前浏览器，请勿公开转发。`;
      $("allocationResult").hidden = false;
      await refreshAll();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  $("copyCode").addEventListener("click", async () => { await navigator.clipboard.writeText($("allocatedCode").textContent); toast("兑换码已复制"); });
  $("copyReply").addEventListener("click", async () => { await navigator.clipboard.writeText($("buyerReply").value); toast("完整回复已复制"); });

  $("generateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const result = await post("/api/admin/licenses/generate", { testSlug: $("generateTest").value, batchName: $("batchName").value.trim(), count: Number($("generateCount").value) });
      $("generateResult").textContent = `已生成 ${result.codes.length} 个兑换码，批次 ID：${result.batchId}。请立即在下方批次表导出并妥善保存。`;
      $("generateResult").hidden = false;
      await refreshAll();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  $("importForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = $("importFile").files[0];
    if (!file) return;
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const result = await post("/api/admin/licenses/import", { testSlug: $("importTest").value, batchName: $("importBatchName").value.trim(), codes: await file.text() });
      $("importResult").textContent = `处理 ${result.total} 个：新增 ${result.added}，补全旧码 ${result.completed}，重复 ${result.duplicate}，无效 ${result.invalid}。`;
      $("importResult").hidden = false;
      await refreshAll();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });

  $("licensesBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-license-action]");
    if (!button) return;
    button.disabled = true;
    try {
      await post("/api/admin/licenses/action", { id: Number(button.dataset.id), action: button.dataset.licenseAction });
      await refreshAll();
      toast("兑换码状态已更新");
    } catch (error) { toast(error.message); }
  });

  $("backupButton").addEventListener("click", async () => {
    $("backupButton").disabled = true;
    try { const result = await post("/api/admin/backups", {}); await loadBackups(); toast(`备份已生成：${result.name}`); }
    catch (error) { toast(error.message); }
    finally { $("backupButton").disabled = false; }
  });

  api("/api/admin/session").then((result) => showApp(result.username)).catch(showLogin);
})();
