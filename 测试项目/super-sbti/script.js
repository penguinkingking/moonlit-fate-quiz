const progressRemarks = [
  "人格尚未出现明显裂纹",
  "系统开始过度解读",
  "检测到一点可疑倾向",
  "你的选择正在互相告状",
  "算法已形成先入为主",
  "结果逐渐失去挽回余地",
  "人格正在打印，请勿拍打机器"
];

const loadingMessages = [
  "把你的选择塞进统计学微波炉...",
  "正在删除所有不支持结论的证据...",
  "邀请三位路人对你进行远程误判...",
  "给人格加盖一个看起来很正式的章...",
  "最后检查一下文案够不够冒犯现实..."
];

const storageKey = "test-platform:super-sbti:last-result";
const draftKey = "test-platform:super-sbti:draft";
const dimensionKeys = Object.keys(dimensions);
const optionLetters = "ABCDE";
const $ = (id) => document.getElementById(id);

function freshState() {
  return {
    index: 0,
    answers: {},
    answerTimes: {},
    questionEnteredAt: Date.now(),
    backtracks: 0,
    glitchTaps: {},
    revealedSecrets: [],
    dangerPresses: 0,
    brandPresses: 0,
    idleHints: 0,
    rootUnlocked: false
  };
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function readDraft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
    if (!saved || typeof saved !== "object" || !saved.answers) return null;
    return { ...freshState(), ...saved, questionEnteredAt: Date.now() };
  } catch {
    return null;
  }
}

let state = readDraft() || freshState();
let transitionLocked = false;
let idleTimer = 0;

function saveDraft() {
  sessionStorage.setItem(draftKey, JSON.stringify(state));
}

function toast(message, duration = 2600) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  $("toastRegion").appendChild(item);
  window.setTimeout(() => {
    item.classList.add("toast-out");
    window.setTimeout(() => item.remove(), 240);
  }, duration);
}

function showScreen(name) {
  const screens = {
    intro: $("introScreen"),
    quiz: $("quizScreen"),
    loading: $("loadingScreen"),
    result: $("resultScreen")
  };
  Object.entries(screens).forEach(([key, element]) => {
    const active = key === name;
    element.hidden = !active;
    element.classList.toggle("screen-active", active);
  });
  document.body.dataset.phase = name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function isSecretRevealed(question) {
  return Boolean(question.secret && state.revealedSecrets.includes(question.id));
}

function armIdleToast() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (document.body.dataset.phase !== "quiz") return;
    state.idleHints += 1;
    saveDraft();
    toast("检测到深度思考。请放心，本题不值得。", 3600);
  }, 18000);
}

function renderQuestion() {
  const question = questions[state.index];
  const progress = ((state.index + 1) / questions.length) * 100;
  const remarkIndex = Math.min(progressRemarks.length - 1, Math.floor(state.index / 2.5));
  const availableOptions = question.options.concat(isSecretRevealed(question) ? [question.secret] : []);

  $("questionNumber").textContent = `事故 ${String(state.index + 1).padStart(2, "0")} / ${questions.length}`;
  $("progressRemark").textContent = progressRemarks[remarkIndex];
  $("progressBar").style.width = `${progress}%`;
  $("progressBar").style.background = state.index > 10 ? "#ff3b30" : state.index > 5 ? "#ffd93d" : "#ff4fa1";
  $("progressBar").parentElement.setAttribute("aria-valuenow", String(state.index + 1));
  $("asideIndex").textContent = String(state.index + 1).padStart(2, "0");
  $("asideStamp").textContent = isSecretRevealed(question) ? "异常" : state.index > 11 ? "可疑" : "正常";
  $("questionScene").textContent = question.scene;
  $("questionText").textContent = question.text;
  $("questionNote").textContent = question.note;
  $("backButton").disabled = state.index === 0;

  $("options").replaceChildren(...availableOptions.map((option, index) => {
    const button = document.createElement("button");
    const selected = state.answers[question.id] === index;
    const secret = index >= question.options.length;
    button.type = "button";
    button.className = `option-button${selected ? " selected" : ""}${secret ? " secret-option" : ""}`;
    button.dataset.optionIndex = String(index);
    button.setAttribute("aria-pressed", selected ? "true" : "false");

    const key = document.createElement("span");
    key.className = "option-key";
    key.textContent = optionLetters[index];
    const copy = document.createElement("span");
    copy.className = "option-copy";
    const title = document.createElement("b");
    title.textContent = option[0];
    const detail = document.createElement("small");
    detail.textContent = option[1];
    copy.append(title, detail);
    const arrow = document.createElement("span");
    arrow.className = "option-arrow";
    arrow.textContent = secret ? "※" : "→";
    button.append(key, copy, arrow);
    button.addEventListener("click", () => chooseOption(index));
    return button;
  }));

  state.questionEnteredAt = Date.now();
  saveDraft();
  armIdleToast();
}

function chooseOption(index) {
  if (transitionLocked) return;
  transitionLocked = true;
  const question = questions[state.index];
  state.answers[question.id] = index;
  state.answerTimes[question.id] = Math.max(200, Date.now() - state.questionEnteredAt);
  saveDraft();

  document.querySelectorAll(".option-button").forEach((button) => {
    const selected = Number(button.dataset.optionIndex) === index;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });

  window.setTimeout(() => {
    if (state.index === questions.length - 1) {
      window.clearTimeout(idleTimer);
      transitionLocked = false;
      finishQuiz();
      return;
    }
    state.index += 1;
    transitionLocked = false;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 280);
}

function finishQuiz() {
  const { metrics, averageTime } = calculateMetrics();
  const profileKey = pickProfile(metrics);
  const result = {
    profileKey,
    metrics,
    averageTime,
    backtracks: state.backtracks,
    secretAnswers: secretAnswerCount(),
    resultNumber: resultHash(),
    completedAt: new Date().toISOString()
  };
  localStorage.setItem(storageKey, JSON.stringify(result));
  sessionStorage.removeItem(draftKey);
  updateLastResultButton();
  playLoading(() => renderResult(result));
}

function playLoading(done) {
  showScreen("loading");
  let progress = 0;
  let messageIndex = 0;
  $("loadingText").textContent = loadingMessages[0];
  $("loadingBar").style.width = "0%";
  $("loadingPercent").textContent = "0%";

  const timer = window.setInterval(() => {
    progress = Math.min(99, progress + 4 + Math.floor(Math.random() * 10));
    if (progress > (messageIndex + 1) * 20 && messageIndex < loadingMessages.length - 1) {
      messageIndex += 1;
      $("loadingText").textContent = loadingMessages[messageIndex];
    }
    $("loadingBar").style.width = `${progress}%`;
    $("loadingPercent").textContent = `${progress}%`;
    if (progress >= 99) {
      window.clearInterval(timer);
      window.setTimeout(() => {
        $("loadingBar").style.width = "100%";
        $("loadingPercent").textContent = "104%";
        window.setTimeout(() => done(), 450);
      }, 260);
    }
  }, 145);
}

function metricAside(key, value) {
  if (value >= 75) return `该指标已高到需要单独买票（${dimensions[key][1]}）`;
  if (value >= 45) return `处于人类常见但无法解释的区间`;
  return `目前较低，可能只是今天懒得表现`;
}

function renderResult(result) {
  const profile = profiles[result.profileKey];
  if (!profile) return;
  const color = profile.color === "#11110f" ? "#d8ff37" : profile.color;
  showScreen("result");
  $("resultScreen").style.setProperty("--result-color", profile.color);
  $("resultCode").style.color = profile.color === "#11110f" ? "#d8ff37" : "#11110f";
  $("resultTitle").style.color = profile.color === "#11110f" ? "#fffdf7" : "#11110f";
  $("resultSubtitle").style.color = profile.color === "#11110f" ? "#fffdf7" : "#11110f";
  $("resultCode").textContent = profile.code;
  $("resultRarity").textContent = profile.rarity;
  $("resultTitle").textContent = profile.title;
  $("resultSubtitle").textContent = profile.subtitle;
  $("resultSeal").querySelector("b").textContent = profile.code.slice(0, 1);
  $("resultNumber").textContent = result.resultNumber;
  $("resultHook").textContent = `截图时请保留故障编号 ${result.resultNumber}，方便未来拒绝承认。`;
  $("diagnosisLede").innerHTML = `<p>${profile.lede}</p>`;
  $("diagnosisList").innerHTML = profile.sections.map(([title, body], index) => `
    <article class="diagnosis-item">
      <h3><span>0${index + 1} / REPORT</span>${title}</h3>
      <p>${body}</p>
    </article>`).join("");
  $("manualTable").innerHTML = [profile.manual, profile.crash, profile.reboot]
    .map(([label, copy]) => `<div class="manual-row"><b>${label}</b><span>${copy}</span></div>`).join("");
  $("resultQuote").textContent = profile.quote;

  $("metricGrid").innerHTML = dimensionKeys.map((key) => {
    const [label, , metricColor] = dimensions[key];
    const value = result.metrics[key];
    return `<article class="metric-item" style="--metric-color:${metricColor}">
      <div class="metric-head"><span>${label}</span><b>${value}</b></div>
      <div class="metric-bar"><i data-value="${value}"></i></div>
      <small>${metricAside(key, value)}</small>
    </article>`;
  }).join("");

  const averageSeconds = Math.max(0.2, result.averageTime / 1000).toFixed(1);
  const secretCopy = result.secretAnswers ? `，并带走了 ${result.secretAnswers} 个不该出现的答案` : "，全程没有把地毯掀起来看";
  $("metricFootnote").textContent = `旁证：平均每题犹豫 ${averageSeconds} 秒，回头修改 ${result.backtracks} 次${secretCopy}。以上数字经过四舍五入与主观臆断。`;

  window.requestAnimationFrame(() => {
    document.querySelectorAll(".metric-bar i").forEach((bar) => {
      bar.style.width = `${bar.dataset.value}%`;
    });
  });

  if (profile.code === "ROOT") {
    document.querySelector(".result-kicker").textContent = "警告：用户权限发生异常";
    toast("隐藏人格已解锁：请不要真的修改生产数据库。", 4200);
  } else {
    document.querySelector(".result-kicker").textContent = "您的互联网行为故障为";
  }
  document.querySelector("meta[name='theme-color']").setAttribute("content", color);
}

function readLastResult() {
  const result = readJson(storageKey);
  if (!result || !profiles[result.profileKey] || !result.metrics) return null;
  return result;
}

function updateLastResultButton() {
  const hasResult = Boolean(readLastResult());
  $("lastResultButton").disabled = !hasResult;
}

function startQuiz({ restart = false } = {}) {
  if (restart) {
    const easterState = {
      dangerPresses: state.dangerPresses,
      brandPresses: state.brandPresses,
      rootUnlocked: state.rootUnlocked
    };
    state = { ...freshState(), ...easterState };
    sessionStorage.removeItem(draftKey);
  }
  showScreen("quiz");
  renderQuestion();
}

function goHome() {
  window.clearTimeout(idleTimer);
  showScreen("intro");
  document.querySelector("meta[name='theme-color']").setAttribute("content", "#f4f0e7");
}

async function shareResult() {
  const result = readLastResult();
  if (!result) return;
  const profile = profiles[result.profileKey];
  const text = `我的超级 SBTI 是 ${profile.code}「${profile.title}」：${profile.subtitle}\n故障编号 ${result.resultNumber}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `超级 SBTI｜${profile.title}`, text, url: window.location.href });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  await copyText(text);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("鉴定结果已复制，可以去群里制造新话题了。", 3200);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy"); // oxlint-disable-line typescript/no-deprecated -- legacy clipboard fallback
    area.remove();
    toast("鉴定结果已复制。", 2600);
  }
}

function revealSecret() {
  const question = questions[state.index];
  state.glitchTaps[question.id] = (state.glitchTaps[question.id] || 0) + 1;
  const taps = state.glitchTaps[question.id];
  if (question.secret && taps >= 3 && !state.revealedSecrets.includes(question.id)) {
    state.revealedSecrets.push(question.id);
    saveDraft();
    toast("信号异常：捕获到一个未登记选项。", 3200);
    renderQuestion();
    return;
  }
  const messages = ["线路轻微松动，但题目拒绝改变。", "你又戳了一下。系统开始记仇。", "没有隐藏选项。大概。", "请停止对问卷进行压力测试。"];
  toast(messages[(taps - 1) % messages.length], 1900);
}

function pressDangerButton() {
  state.dangerPresses += 1;
  const button = $("dangerButton");
  const messages = [
    ["都写了不要按", "人格机发出了一声叹息。"],
    ["真的别按", "某个无辜的进度条倒退了 1%。"],
    ["权限泄漏", "恭喜，你把测试按出了管理员味。"],
    ["还在按？", "机器已经没有新的威胁可以说了。"]
  ];
  const [label, message] = messages[Math.min(state.dangerPresses - 1, messages.length - 1)];
  button.textContent = label;
  toast(message);
  if (state.dangerPresses >= 3) {
    document.body.classList.add("printer-haunted");
    state.rootUnlocked = true;
  }
  saveDraft();
}

function openTerminal() {
  const dialog = $("terminalDialog");
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    window.setTimeout(() => $("terminalInput").focus(), 80);
  }
}

function runTerminalCommand() {
  const input = $("terminalInput");
  const command = input.value.trim().toLowerCase();
  const output = $("terminalOutput");
  if (["sudo", "sudo su", "root", "whoami"].includes(command)) {
    state.rootUnlocked = true;
    saveDraft();
    output.textContent = "ACCESS GRANTED\n身份：问卷临时管理员\n权限：可以继续做题，但会被题目记录。";
    toast("隐藏权限已写入本次人格档案。", 3300);
  } else if (command === "help") {
    output.textContent = "可用命令：没有。\n不可用命令：很多。";
  } else if (!command) {
    output.textContent = "请输入一些看起来像命令的东西。";
  } else {
    output.textContent = `command not found: ${command}\n建议假装自己刚才什么也没做。`;
  }
  input.value = "";
}

function installEasterEggs() {
  $("dangerButton").addEventListener("click", pressDangerButton);
  $("brandButton").addEventListener("click", () => {
    state.brandPresses += 1;
    saveDraft();
    if (state.brandPresses === 4) toast("Logo 不是按钮。虽然它确实是个按钮。", 2300);
    if (state.brandPresses >= 7) openTerminal();
  });
  $("terminalRunButton").addEventListener("click", runTerminalCommand);
  $("terminalInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runTerminalCommand();
    }
  });

  let versionClicks = 0;
  $("versionButton").addEventListener("click", () => {
    versionClicks += 1;
    const messages = ["BUILD 404.16：稳定性主要来自没人敢动。", "更新日志：修复了一个正常功能。", "许可证：随便用，但别用于招聘。", "你把页脚也点了。系统正在重新评价你。"];
    toast(messages[(versionClicks - 1) % messages.length]);
    if (versionClicks >= 4) state.rootUnlocked = true;
  });

  const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konamiIndex = 0;
  document.addEventListener("keydown", (event) => {
    if (document.body.dataset.phase === "quiz" && /^[a-eA-E]$/.test(event.key)) {
      const index = optionLetters.indexOf(event.key.toUpperCase());
      const button = document.querySelector(`.option-button[data-option-index="${index}"]`);
      if (button) button.click();
    }
    konamiIndex = event.key === konami[konamiIndex] ? konamiIndex + 1 : 0;
    if (konamiIndex === konami.length) {
      konamiIndex = 0;
      state.rootUnlocked = true;
      saveDraft();
      $("konamiConfetti").classList.add("active");
      toast("上古指令有效。你获得了一份没有工资的后台权限。", 4200);
      window.setTimeout(() => $("konamiConfetti").classList.remove("active"), 2800);
    }
  });
}

function bindEvents() {
  $("startButton").addEventListener("click", () => startQuiz());
  $("backButton").addEventListener("click", () => {
    if (transitionLocked || state.index === 0) return;
    state.backtracks += 1;
    state.index -= 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("glitchButton").addEventListener("click", revealSecret);
  $("restartButton").addEventListener("click", () => startQuiz({ restart: true }));
  $("restartTopButton").addEventListener("click", () => startQuiz({ restart: true }));
  $("backHomeButton").addEventListener("click", goHome);
  $("lastResultButton").addEventListener("click", () => {
    const result = readLastResult();
    if (result) renderResult(result);
  });
  $("shareButton").addEventListener("click", shareResult);
  $("copyButton").addEventListener("click", () => {
    const result = readLastResult();
    if (!result) return;
    const profile = profiles[result.profileKey];
    void copyText(`超级 SBTI 鉴定：${profile.code}「${profile.title}」\n${profile.subtitle}\n故障编号 ${result.resultNumber}`);
  });
  window.addEventListener("beforeunload", () => {
    if (document.body.dataset.phase === "quiz") saveDraft();
  });
}

function initialize() {
  document.body.dataset.phase = "intro";
  bindEvents();
  installEasterEggs();
  updateLastResultButton();
  const draftAnswers = Object.keys(state.answers).length;
  if (draftAnswers > 0 && draftAnswers < questions.length) {
    $("startButton").querySelector("span").textContent = `继续上次的荒唐（${draftAnswers}/16）`;
  }
}

initialize();
