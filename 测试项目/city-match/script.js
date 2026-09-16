(function () {
  "use strict";

  const { dimensions, questions, cities } = window.CityMatchData;
  const dimensionKeys = Object.keys(dimensions);
  const storageKey = "test-platform:city-match:last-result";
  const draftKey = "test-platform:city-match:draft";
  const optionMarks = ["一", "二", "三", "四"];
  const $ = (id) => document.getElementById(id);

  let state = readDraft() || { index: 0, answers: {} };
  let transitionLocked = false;
  let toastTimer = 0;

  function readJson(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function readDraft() {
    const draft = readJson(sessionStorage, draftKey);
    if (!draft || !draft.answers || !Number.isInteger(draft.index)) return null;
    if (draft.index < 0 || draft.index >= questions.length) return null;
    return draft;
  }

  function readLastResult() {
    const value = readJson(localStorage, storageKey);
    if (!value || !value.answers || !value.cityName) return null;
    return value;
  }

  function saveDraft() {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(state));
    } catch {}
  }

  function updateLastResultButton() {
    const hasResult = Boolean(readLastResult());
    $("lastResultButton").disabled = !hasResult;
    $("lastResultButton").title = hasResult ? "查看保存在本机的上一次结果" : "完成测试后可在这里查看结果";
  }

  function toast(message) {
    window.clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("toast-visible");
    toastTimer = window.setTimeout(() => $("toast").classList.remove("toast-visible"), 2300);
  }

  function showScreen(name, smooth = true) {
    const screens = {
      intro: $("introScreen"),
      quiz: $("quizScreen"),
      result: $("resultScreen")
    };
    Object.entries(screens).forEach(([key, element]) => {
      const active = key === name;
      element.hidden = !active;
      element.classList.toggle("screen-active", active);
    });
    document.body.dataset.screen = name;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }

  function startTest() {
    state = { index: 0, answers: {} };
    saveDraft();
    showScreen("quiz");
    renderQuestion();
  }

  function continueDraft() {
    showScreen("quiz");
    renderQuestion();
    toast(`已回到第 ${state.index + 1} 题`);
  }

  function renderIntroState() {
    const answeredCount = Object.keys(state.answers || {}).length;
    const startButton = $("startButton");
    if (answeredCount > 0 && answeredCount < questions.length) {
      startButton.firstChild.textContent = "继续上次答题 ";
      startButton.onclick = continueDraft;
    } else {
      startButton.firstChild.textContent = "开始测试 ";
      startButton.onclick = startTest;
    }
  }

  function renderQuestion() {
    const current = questions[state.index];
    const currentAnswer = state.answers[state.index];
    const progress = ((state.index + 1) / questions.length) * 100;

    $("categoryLabel").textContent = current.category;
    $("questionCounter").textContent = `${String(state.index + 1).padStart(2, "0")} / ${questions.length}`;
    $("questionIndex").textContent = String(state.index + 1).padStart(2, "0");
    $("questionContext").textContent = current.context;
    $("questionText").textContent = current.text;
    $("progressBar").style.width = `${progress}%`;
    $("progressBar").parentElement.setAttribute("aria-valuenow", String(state.index + 1));
    $("previousButton").disabled = state.index === 0;

    $("options").replaceChildren(...current.options.map((option, index) => {
      const button = document.createElement("button");
      const selected = currentAnswer === index;
      button.type = "button";
      button.className = `option-button${selected ? " option-selected" : ""}`;
      button.setAttribute("aria-pressed", selected ? "true" : "false");

      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.textContent = optionMarks[index];
      const copy = document.createElement("span");
      copy.textContent = option.text;
      const arrow = document.createElement("i");
      arrow.textContent = "→";
      button.append(mark, copy, arrow);
      button.addEventListener("click", () => selectOption(index, button));
      return button;
    }));
  }

  function selectOption(optionIndex, button) {
    if (transitionLocked) return;
    transitionLocked = true;
    state.answers[state.index] = optionIndex;
    saveDraft();
    $("options").querySelectorAll("button").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("option-selected", selected);
      item.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    window.setTimeout(() => {
      if (state.index === questions.length - 1) {
        transitionLocked = false;
        completeTest();
        return;
      }
      state.index += 1;
      saveDraft();
      transitionLocked = false;
      renderQuestion();
      const top = $("quizScreen").getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > top + 80) window.scrollTo({ top, behavior: "smooth" });
    }, 280);
  }

  function previousQuestion() {
    if (transitionLocked || state.index === 0) return;
    state.index -= 1;
    saveDraft();
    renderQuestion();
  }

  function calculateProfile(answers) {
    const totals = Object.fromEntries(dimensionKeys.map((key) => [key, 0]));
    const weights = Object.fromEntries(dimensionKeys.map((key) => [key, 0]));
    questions.forEach((question, index) => {
      const answerIndex = Number(answers[index]);
      const option = question.options[answerIndex];
      if (!option) return;
      Object.entries(option.values).forEach(([key, value]) => {
        totals[key] += Number(value);
        weights[key] += 1;
      });
    });
    return Object.fromEntries(dimensionKeys.map((key) => [
      key,
      weights[key] ? Math.round((totals[key] / weights[key]) * 10) / 10 : 5
    ]));
  }

  function cityDistance(profile, city, focus = []) {
    let weightedDistance = 0;
    let totalWeight = 0;
    dimensionKeys.forEach((key) => {
      const conviction = 1 + Math.abs(profile[key] - 5) * 0.1;
      const focusBoost = focus.includes(key) ? 1.85 : 1;
      const weight = conviction * focusBoost;
      weightedDistance += Math.abs(profile[key] - city.vector[key]) * weight;
      totalWeight += weight;
    });
    return weightedDistance / totalWeight;
  }

  function matchScore(distance) {
    return Math.round(Math.max(68, Math.min(96, 97 - distance * 4.5)));
  }

  function rankedCities(profile, focus = []) {
    return cities
      .map((city) => ({ city, distance: cityDistance(profile, city, focus) }))
      .sort((a, b) => a.distance - b.distance);
  }

  function pickAlternatives(profile, primary) {
    const focuses = [
      { label: "职业发展优先", keys: ["career", "innovation", "scale", "pace"] },
      { label: "生活平衡优先", keys: ["budget", "family", "pace", "nature"] },
      { label: "气候环境优先", keys: ["warmth", "dryness", "coast", "nature"] },
      { label: "文化氛围优先", keys: ["culture", "social", "innovation"] }
    ];
    const used = new Set([primary.name]);
    return focuses.map((focus) => {
      const match = rankedCities(profile, focus.keys).find((item) => !used.has(item.city.name));
      used.add(match.city.name);
      return { ...match, label: focus.label, keys: focus.keys };
    });
  }

  function completeTest() {
    if (Object.keys(state.answers).length !== questions.length) {
      const firstMissing = questions.findIndex((_, index) => !Number.isInteger(state.answers[index]));
      state.index = Math.max(0, firstMissing);
      saveDraft();
      renderQuestion();
      toast("还有题目没有作答，请继续完成");
      return;
    }
    const profile = calculateProfile(state.answers);
    const top = rankedCities(profile)[0];
    const alternatives = pickAlternatives(profile, top.city);
    const result = {
      version: 1,
      answers: state.answers,
      profile,
      cityName: top.city.name,
      match: matchScore(top.distance),
      alternatives: alternatives.map((item) => ({ name: item.city.name, label: item.label })),
      completedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(result));
      sessionStorage.removeItem(draftKey);
    } catch {}
    renderResult(result);
    updateLastResultButton();
  }

  function describePreference(key, value) {
    const dimension = dimensions[key];
    if (value >= 7) return dimension.high;
    if (value <= 3.5) return dimension.low;
    return `在“${dimension.label}”上更希望保持平衡`;
  }

  function strongestKeys(profile, count = 3) {
    return dimensionKeys
      .slice()
      .sort((a, b) => Math.abs(profile[b] - 5) - Math.abs(profile[a] - 5))
      .slice(0, count);
  }

  function bestAlignmentKeys(profile, city, count = 3) {
    return dimensionKeys
      .slice()
      .sort((a, b) => Math.abs(profile[a] - city.vector[a]) - Math.abs(profile[b] - city.vector[b]))
      .slice(0, count);
  }

  function biggestGapKeys(profile, city, count = 2) {
    return dimensionKeys
      .slice()
      .sort((a, b) => Math.abs(profile[b] - city.vector[b]) - Math.abs(profile[a] - city.vector[a]))
      .slice(0, count);
  }

  function dimensionSentence(profile, city, keys) {
    return keys.map((key) => {
      const value = profile[key];
      const cityValue = city.vector[key];
      const label = dimensions[key].label;
      if (value >= 7 && cityValue >= 7) return `${city.name}在${label}上的强度，正好接住了你的明确需求`;
      if (value <= 3.5 && cityValue <= 4) return `你在${label}上不追求“越多越好”，${city.name}的克制反而更合拍`;
      return `你与这座城对${label}的期待比较接近`;
    }).join("；") + "。";
  }

  function groupCopy(profile, city, keys, opening) {
    const matches = keys
      .slice()
      .sort((a, b) => Math.abs(profile[a] - city.vector[a]) - Math.abs(profile[b] - city.vector[b]));
    const close = matches.slice(0, 2).map((key) => dimensions[key].label).join("、");
    const tension = matches[matches.length - 1];
    const gap = Math.abs(profile[tension] - city.vector[tension]);
    const ending = gap >= 3
      ? `不过，你和城市在“${dimensions[tension].label}”上的距离更大，真正迁居前值得用一次长住体验来验证。`
      : `这一组需求没有明显冲突，日常磨合成本相对可控。`;
    return `${opening}${city.name}与你在${close}上的取向最接近。${ending}`;
  }

  function alternativeReason(profile, item) {
    const city = item.city;
    const aligned = item.keys
      .slice()
      .sort((a, b) => Math.abs(profile[a] - city.vector[a]) - Math.abs(profile[b] - city.vector[b]))
      .slice(0, 2)
      .map((key) => dimensions[key].label);
    return `当你把“${item.label.replace("优先", "")}”放到第一位，${city.name}在${aligned.join("与")}上的组合更突出。${city.character}`;
  }

  function renderResult(saved) {
    const profile = saved.profile || calculateProfile(saved.answers);
    const primaryRank = rankedCities(profile).find((item) => item.city.name === saved.cityName) || rankedCities(profile)[0];
    const city = primaryRank.city;
    const score = saved.match || matchScore(primaryRank.distance);
    const alternatives = pickAlternatives(profile, city);
    const aligned = bestAlignmentKeys(profile, city, 3);
    const strongest = strongestKeys(profile, 3);
    const gaps = biggestGapKeys(profile, city, 2);

    $("resultTier").textContent = city.tier;
    $("resultRegion").textContent = city.region;
    $("resultCity").textContent = city.name;
    $("resultCityMark").textContent = city.name.slice(0, 1);
    $("resultTagline").textContent = city.tags.join(" · ");
    $("matchScore").textContent = score;
    $("analysisCity").textContent = city.name;

    $("profileGrid").replaceChildren(...dimensionKeys.map((key) => {
      const value = profile[key];
      const card = document.createElement("article");
      card.className = "profile-item";
      const top = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = dimensions[key].label;
      const number = document.createElement("b");
      number.textContent = `${Math.round(value * 10)}%`;
      top.append(label, number);
      const track = document.createElement("div");
      const bar = document.createElement("i");
      bar.style.width = `${value * 10}%`;
      track.append(bar);
      const copy = document.createElement("p");
      copy.textContent = describePreference(key, value);
      card.append(top, track, copy);
      return card;
    }));

    $("profileSummary").textContent = `你的城市选择中，最清晰的三条线索是：${strongest.map((key) => describePreference(key, profile[key])).join("；")}。这说明你真正需要的不是一座“全能城市”，而是能优先满足这些核心取舍的生活系统。`;
    $("analysisLede").innerHTML = `<p>${city.character}</p><p>${dimensionSentence(profile, city, aligned)}</p>`;

    const cards = [
      ["职业与成长", groupCopy(profile, city, ["career", "innovation", "scale"], "从发展维度看，")],
      ["生活与成本", groupCopy(profile, city, ["pace", "budget", "family"], "回到每天的生活，")],
      ["气候与自然", groupCopy(profile, city, ["warmth", "dryness", "coast", "nature"], "在身体感受上，")],
      ["文化与关系", groupCopy(profile, city, ["culture", "social"], "在人文和关系层面，")]
    ];
    $("analysisGrid").replaceChildren(...cards.map(([title, copy], index) => {
      const article = document.createElement("article");
      article.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><h3>${title}</h3><p>${copy}</p>`;
      return article;
    }));

    $("attentionText").textContent = `${city.watch} 从你的画像看，尤其要留意“${dimensions[gaps[0]].label}”和“${dimensions[gaps[1]].label}”这两项差异。匹配度高不代表没有代价，建议把工作区域、住房预算和最难适应的季节放进一次真实试住。`;

    $("alternativeGrid").replaceChildren(...alternatives.map((item) => {
      const article = document.createElement("article");
      const altScore = matchScore(cityDistance(profile, item.city, item.keys));
      article.innerHTML = `<div><span>${item.label}</span><b>${altScore}%</b></div><h3>${item.city.name}<small>${item.city.tier} · ${item.city.region}</small></h3><p>${alternativeReason(profile, item)}</p><footer>${item.city.tags.map((tag) => `<i>${tag}</i>`).join("")}</footer>`;
      return article;
    }));

    showScreen("result", false);
  }

  function showLastResult() {
    const saved = readLastResult();
    if (!saved) {
      toast("还没有保存过测试结果");
      return;
    }
    renderResult(saved);
  }

  function goHome() {
    renderIntroState();
    showScreen("intro");
  }

  $("previousButton").addEventListener("click", previousQuestion);
  $("lastResultButton").addEventListener("click", showLastResult);
  $("homeButton").addEventListener("click", goHome);
  $("restartButton").addEventListener("click", startTest);
  $("restartTopButton").addEventListener("click", startTest);

  renderIntroState();
  updateLastResultButton();
})();
