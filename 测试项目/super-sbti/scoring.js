const prototypes = {
  boss: { chaos: 20, control: 94, social: 46, vanish: 14, care: 58, drive: 86 },
  late: { chaos: 78, control: 22, social: 44, vanish: 68, care: 40, drive: 52 },
  npc: { chaos: 20, control: 48, social: 10, vanish: 91, care: 67, drive: 43 },
  wifi: { chaos: 58, control: 34, social: 94, vanish: 8, care: 78, drive: 68 },
  pdf: { chaos: 96, control: 18, social: 67, vanish: 42, care: 38, drive: 42 },
  ppt: { chaos: 52, control: 74, social: 94, vanish: 10, care: 43, drive: 67 },
  iced: { chaos: 25, control: 78, social: 35, vanish: 25, care: 46, drive: 96 },
  nap: { chaos: 39, control: 17, social: 11, vanish: 96, care: 49, drive: 14 },
  bug: { chaos: 43, control: 52, social: 42, vanish: 27, care: 97, drive: 60 },
  flex: { chaos: 52, control: 57, social: 55, vanish: 34, care: 75, drive: 76 },
  main: { chaos: 80, control: 65, social: 98, vanish: 12, care: 37, drive: 63 },
  why: { chaos: 91, control: 39, social: 29, vanish: 56, care: 47, drive: 43 }
};

/* eslint-disable no-unused-vars -- functions are consumed by later classic scripts */
const dimensions = {
  chaos: ["抽象浓度", "越高越能把事故改编成节目", "#ff4fa1"],
  control: ["控场欲", "越高越想给混乱建立工单", "#3157ff"],
  social: ["显眼值", "越高越容易成为群聊供电系统", "#ffd93d"],
  vanish: ["隐身术", "越高越擅长从无效社交中撤回", "#8c73d8"],
  care: ["人情味", "越高越能听见别人没说完的话", "#ff7657"],
  drive: ["续航力", "越高越能把烂摊子拖到终点", "#44ba69"]
};

function optionFor(question, optionIndex) {
  if (optionIndex < question.options.length) return question.options[optionIndex];
  return question.secret || null;
}

function calculateMetrics() {
  const totals = Object.fromEntries(dimensionKeys.map((key) => [key, 0]));
  const maximums = Object.fromEntries(dimensionKeys.map((key) => [key, 0]));

  questions.forEach((question) => {
    const allOptions = question.options.concat(question.secret ? [question.secret] : []);
    dimensionKeys.forEach((key) => {
      maximums[key] += Math.max(...allOptions.map((option) => option[2][key] || 0));
    });
    const picked = optionFor(question, state.answers[question.id]);
    if (!picked) return;
    dimensionKeys.forEach((key) => {
      totals[key] += picked[2][key] || 0;
    });
  });

  const times = Object.values(state.answerTimes).filter(Number.isFinite);
  const averageTime = times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : 6000;
  if (averageTime < 2200) {
    totals.chaos += 3;
    totals.drive += 2;
  }
  totals.control += Math.min(4, state.backtracks);
  totals.vanish += Math.min(4, state.idleHints * 2);
  totals.chaos += Math.min(7, secretAnswerCount() * 2 + (state.dangerPresses >= 3 ? 2 : 0));

  const metrics = {};
  dimensionKeys.forEach((key) => {
    metrics[key] = Math.max(4, Math.min(99, Math.round((totals[key] / maximums[key]) * 100)));
  });
  return { metrics, averageTime };
}

function secretAnswerCount() {
  return questions.reduce((count, question) => {
    return count + (question.secret && state.answers[question.id] >= question.options.length ? 1 : 0);
  }, 0);
}

function pickProfile(metrics) {
  const secrets = secretAnswerCount();
  if ((state.rootUnlocked && secrets >= 1) || secrets >= 4) return "root";
  if (metrics.social >= 58 && metrics.chaos >= 48 && metrics.chaos < 90 && metrics.control < 70 && metrics.care < 44) return "main";

  return Object.entries(prototypes).reduce((best, [key, prototype]) => {
    const distance = dimensionKeys.reduce((sum, dimension) => {
      const weight = dimension === "care" || dimension === "chaos" ? 1.08 : 1;
      return sum + ((metrics[dimension] - prototype[dimension]) ** 2) * weight;
    }, 0);
    return distance < best.distance ? { key, distance } : best;
  }, { key: "flex", distance: Number.POSITIVE_INFINITY }).key;
}

function resultHash() {
  const source = questions.map((question) => state.answers[question.id] ?? 9).join("") + state.backtracks + state.dangerPresses;
  let hash = 17;
  for (const char of source) hash = (hash * 31 + char.charCodeAt(0)) % 10000;
  return `SB-${String(hash).padStart(4, "0")}`;
}
