import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile("测试项目/inner-voices/script.js", "utf8");
const noop = () => {};
const element = {
  addEventListener: noop,
  classList: { add: noop, remove: noop, toggle: noop },
  style: {},
  disabled: false,
  title: "",
};
const storage = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  document: {
    getElementById: () => ({ ...element }),
    querySelector: () => ({ ...element }),
    querySelectorAll: () => [],
  },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  },
  window: { scrollTo: noop },
};
vm.runInNewContext(`${source}\nglobalThis.__verification={questions,profiles,classify,calculatePercentages};`, context);

const { questions, profiles, classify, calculatePercentages } = context.__verification;
assert.equal(questions.length, 48);
assert.ok(questions.every((question) => question.length === 4));
assert.equal(Object.keys(profiles).length, 8);

const reachable = new Set();
for (let id = 0; id <= 48; id += 1) {
  for (let ego = 0; ego <= 48 - id; ego += 1) {
    const scores = [id, ego, 48 - id - ego];
    const type = classify(scores);
    assert.ok(profiles[type], `Unknown profile returned for ${scores.join(",")}: ${type}`);
    reachable.add(type);
    assert.equal(calculatePercentages(scores).reduce((sum, value) => sum + value, 0), 100);
  }
}
assert.deepEqual([...reachable].sort((a, b) => a.localeCompare(b)), Object.keys(profiles).sort((a, b) => a.localeCompare(b)));
console.log("PASS: 48 questions have three options; all 8 profiles are reachable; percentages always total 100.");
