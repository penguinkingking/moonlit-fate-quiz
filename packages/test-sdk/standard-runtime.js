(function () {
  "use strict";
  const root = document.getElementById("test-root");
  const slug = document.documentElement.dataset.testSlug;
  let config;
  let index = 0;
  let scores = {};

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  function shell(content) {
    root.innerHTML = `<div class="standard-shell"><header class="standard-header"><strong>${escapeHtml(config.name)}</strong><span>${escapeHtml(config.headerNote || "PERSONAL TEST")}</span></header><main class="standard-main">${content}</main></div>`;
  }

  function intro() {
    shell(`<section class="standard-intro"><p class="standard-kicker">${escapeHtml(config.kicker || "A PERSONAL EXPLORATION")}</p><h1>${escapeHtml(config.title)}</h1><p class="standard-copy">${escapeHtml(config.description)}</p><button id="standardStart" class="standard-button" type="button">开始测试</button></section>`);
    document.getElementById("standardStart").addEventListener("click", start);
  }

  function start() {
    index = 0;
    scores = Object.fromEntries(Object.keys(config.results).map((key) => [key, 0]));
    question();
  }

  function question() {
    const current = config.questions[index];
    const progress = Math.round(((index + 1) / config.questions.length) * 100);
    shell(`<section class="standard-question"><p class="standard-kicker">第 ${index + 1} 题 / 共 ${config.questions.length} 题</p><div class="standard-progress"><i style="width:${progress}%"></i></div><h1>${escapeHtml(current.text)}</h1><div class="standard-options">${current.options.map((option, optionIndex) => `<button class="standard-option" type="button" data-option="${optionIndex}"><b>${String.fromCharCode(65 + optionIndex)}</b><span>${escapeHtml(option.text)}</span></button>`).join("")}</div></section>`);
    root.querySelectorAll("[data-option]").forEach((button) => button.addEventListener("click", () => answer(current.options[Number(button.dataset.option)])));
  }

  function answer(option) {
    for (const [key, value] of Object.entries(option.scores || {})) scores[key] = (scores[key] || 0) + Number(value || 0);
    index += 1;
    if (index < config.questions.length) question();
    else result();
  }

  function result() {
    const key = Object.keys(config.results).sort((a, b) => (scores[b] || 0) - (scores[a] || 0))[0];
    const value = config.results[key];
    try { localStorage.setItem(`test-platform:${slug}:last-result`, JSON.stringify({ key, scores, completedAt: new Date().toISOString() })); } catch {}
    shell(`<section class="standard-result"><p class="standard-kicker">YOUR RESULT</p><h1>${escapeHtml(value.title)}</h1><p class="standard-copy">${escapeHtml(value.description)}</p><div class="standard-actions"><button id="standardRestart" class="standard-button" type="button">重新测试</button></div></section>`);
    document.getElementById("standardRestart").addEventListener("click", start);
  }

  async function boot() {
    const response = await fetch("test.config.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("无法加载测试配置");
    config = await response.json();
    TestPlatformLicense.start({ testSlug: slug, testName: config.name, onAuthorized: intro });
  }

  boot().catch((error) => { root.innerHTML = `<main class="standard-main"><h1>测试暂时无法打开</h1><p>${escapeHtml(error.message)}</p></main>`; });
})();
