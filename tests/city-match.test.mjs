import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const project = resolve(process.cwd(), "测试项目", "city-match");

async function loadData() {
  const source = await readFile(resolve(project, "data.js"), "utf8");
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context, { filename: "city-match-data.js" });
  return context.window.CityMatchData;
}

function calculateProfile(data, answers) {
  const keys = Object.keys(data.dimensions);
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  const weights = Object.fromEntries(keys.map((key) => [key, 0]));
  data.questions.forEach((question, index) => {
    for (const [key, value] of Object.entries(question.options[answers[index]].values)) {
      totals[key] += value;
      weights[key] += 1;
    }
  });
  return Object.fromEntries(keys.map((key) => [key, weights[key] ? totals[key] / weights[key] : 5]));
}

function rank(data, profile, focus = []) {
  const keys = Object.keys(data.dimensions);
  return data.cities.map((city) => {
    let total = 0;
    let weightTotal = 0;
    for (const key of keys) {
      const weight = (1 + Math.abs(profile[key] - 5) * 0.1) * (focus.includes(key) ? 1.85 : 1);
      total += Math.abs(profile[key] - city.vector[key]) * weight;
      weightTotal += weight;
    }
    return { name: city.name, distance: total / weightTotal };
  }).sort((left, right) => left.distance - right.distance);
}

test("city match contains a complete 46-question Chinese model", async () => {
  const data = await loadData();
  const dimensionKeys = new Set(Object.keys(data.dimensions));
  assert.equal(data.questions.length, 46);
  assert.equal(dimensionKeys.size, 12);
  assert.deepEqual([...new Set(data.questions.map((question) => question.category))], ["个人性格", "生活偏好", "职业发展", "气候自然", "文化氛围", "现实取舍"]);

  for (const [questionIndex, question] of data.questions.entries()) {
    assert.ok(question.category && question.context && question.text, `question ${questionIndex + 1} has complete Chinese copy`);
    assert.equal(question.options.length, 4, `question ${questionIndex + 1} has four options`);
    for (const option of question.options) {
      assert.ok(option.text && Object.keys(option.values).length >= 2);
      assert.ok(Object.keys(option.values).every((key) => dimensionKeys.has(key)), `question ${questionIndex + 1} only uses known dimensions`);
      assert.ok(Object.values(option.values).every((value) => Number.isInteger(value) && value >= 0 && value <= 10));
    }
  }
});

test("city pool only uses the allowed current tiers and has complete profiles", async () => {
  const data = await loadData();
  const allowedTiers = new Set(["一线城市", "新一线城市", "二线城市", "三线城市"]);
  const cityNames = new Set(data.cities.map((city) => city.name));
  assert.equal(data.cities.length, 37);
  assert.equal(cityNames.size, data.cities.length);
  assert.deepEqual(new Set(data.cities.map((city) => city.tier)), allowedTiers);

  for (const city of data.cities) {
    assert.ok(city.name && city.region && city.character.length >= 25 && city.watch.length >= 20);
    assert.equal(city.tags.length, 3);
    assert.deepEqual(new Set(Object.keys(city.vector)), new Set(Object.keys(data.dimensions)));
    assert.ok(Object.values(city.vector).every((value) => Number.isInteger(value) && value >= 0 && value <= 10));
  }
});

test("representative answer paths produce bounded profiles and distinct alternatives", async () => {
  const data = await loadData();
  const paths = [
    data.questions.map(() => 0),
    data.questions.map(() => 1),
    data.questions.map(() => 2),
    data.questions.map(() => 3),
    data.questions.map((_, index) => index % 4),
  ];
  const focuses = [
    ["career", "innovation", "scale", "pace"],
    ["budget", "family", "pace", "nature"],
    ["warmth", "dryness", "coast", "nature"],
    ["culture", "social", "innovation"],
  ];

  for (const answers of paths) {
    const profile = calculateProfile(data, answers);
    assert.ok(Object.values(profile).every((value) => value >= 0 && value <= 10));
    const primary = rank(data, profile)[0].name;
    const used = new Set([primary]);
    for (const focus of focuses) {
      const alternative = rank(data, profile, focus).find((item) => !used.has(item.name));
      assert.ok(alternative);
      used.add(alternative.name);
    }
    assert.equal(used.size, 5, "primary city and four focused alternatives are unique");
  }
});
