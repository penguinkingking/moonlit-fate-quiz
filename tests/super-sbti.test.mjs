import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const project = resolve(process.cwd(), "测试项目", "super-sbti");

async function loadQuizModel() {
  const [questionsSource, profilesSource, extensionsSource, scoringSource] = await Promise.all([
    readFile(resolve(project, "questions.js"), "utf8"),
    readFile(resolve(project, "profiles.js"), "utf8"),
    readFile(resolve(project, "profile-extensions.js"), "utf8"),
    readFile(resolve(project, "scoring.js"), "utf8"),
  ]);
  const context = vm.createContext({});
  vm.runInContext(`${questionsSource}\n${profilesSource}\n${extensionsSource}\n${scoringSource}\n
    const dimensionKeys = Object.keys(dimensions);
    let state = { answers: {}, answerTimes: {}, backtracks: 0, idleHints: 0, dangerPresses: 0, rootUnlocked: false };
    globalThis.quiz = {
      questions,
      profiles,
      prototypes,
      dimensions,
      calculateMetrics,
      pickProfile,
      secretAnswerCount,
      setState(next) { state = next; }
    };
  `, context, { filename: "super-sbti-model.js" });
  return context.quiz;
}

test("Super SBTI has a complete original quiz model", async () => {
  const { questions, profiles, prototypes, dimensions } = await loadQuizModel();
  assert.equal(questions.length, 16);
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
  assert.equal(Object.keys(dimensions).length, 6);
  assert.equal(Object.keys(prototypes).length, 12);
  assert.equal(Object.keys(profiles).length, 13);
  assert.equal(questions.filter((question) => question.secret).length, 4);
  assert.ok(profiles.root, "hidden ROOT profile must exist");

  const dimensionKeys = new Set(Object.keys(dimensions));
  for (const [questionIndex, question] of questions.entries()) {
    assert.ok(question.scene && question.text && question.note, `question ${questionIndex + 1} has complete copy`);
    assert.equal(question.options.length, 4, `question ${questionIndex + 1} has four visible options`);
    for (const option of question.options.concat(question.secret ? [question.secret] : [])) {
      assert.equal(option.length, 3);
      assert.ok(option[0] && option[1]);
      assert.ok(Object.keys(option[2]).every((key) => dimensionKeys.has(key)), `question ${questionIndex + 1} only scores known dimensions`);
      assert.ok(Object.values(option[2]).every((score) => Number.isInteger(score) && score > 0 && score <= 5));
    }
  }

  for (const [key, profile] of Object.entries(profiles)) {
    assert.match(profile.code, /^[A-Z]{3,5}$/);
    assert.ok(profile.title && profile.subtitle && profile.lede && profile.quote, `${key} has complete headline copy`);
    assert.ok(profile.lede.length >= 80, `${key} includes a substantial opening analysis`);
    assert.ok(profile.sections.length >= 9, `${key} has at least nine long-form analysis sections`);
    assert.ok(profile.sections.every(([title, body]) => title && body.length >= 80), `${key} analysis sections are substantive`);
    const analysisLength = profile.lede.length + profile.sections.reduce((sum, [, body]) => sum + body.length, 0);
    assert.ok(analysisLength > 1000, `${key} analysis must exceed 1000 Chinese characters (actual: ${analysisLength})`);
    assert.ok([profile.manual, profile.crash, profile.reboot].every((row) => row.length === 2 && row.every(Boolean)));
  }
});

test("Super SBTI scoring produces bounded metrics and every declared prototype", async () => {
  const quiz = await loadQuizModel();
  const baseState = {
    answers: Object.fromEntries(quiz.questions.map((question) => [question.id, 0])),
    answerTimes: Object.fromEntries(quiz.questions.map((question) => [question.id, 5000])),
    backtracks: 0,
    idleHints: 0,
    dangerPresses: 0,
    rootUnlocked: false,
  };
  quiz.setState(baseState);
  const { metrics, averageTime } = quiz.calculateMetrics();
  assert.equal(averageTime, 5000);
  assert.deepEqual(
    Object.keys(metrics).sort((left, right) => left.localeCompare(right)),
    Object.keys(quiz.dimensions).sort((left, right) => left.localeCompare(right)),
  );
  assert.ok(Object.values(metrics).every((value) => Number.isInteger(value) && value >= 4 && value <= 99));

  for (const [profileKey, prototype] of Object.entries(quiz.prototypes)) {
    quiz.setState(baseState);
    assert.equal(quiz.pickProfile(prototype), profileKey, `${profileKey} wins for its own prototype vector`);
  }
});

test("ROOT remains hidden unless secret behavior is actually triggered", async () => {
  const quiz = await loadQuizModel();
  const visibleAnswers = Object.fromEntries(quiz.questions.map((question) => [question.id, 0]));
  const baseState = {
    answers: visibleAnswers,
    answerTimes: {},
    backtracks: 0,
    idleHints: 0,
    dangerPresses: 0,
    rootUnlocked: false,
  };
  quiz.setState(baseState);
  assert.notEqual(quiz.pickProfile(quiz.prototypes.boss), "root");

  const secretQuestion = quiz.questions.find((question) => question.secret);
  quiz.setState({
    ...baseState,
    rootUnlocked: true,
    answers: { ...visibleAnswers, [secretQuestion.id]: secretQuestion.options.length },
  });
  assert.equal(quiz.secretAnswerCount(), 1);
  assert.equal(quiz.pickProfile(quiz.prototypes.boss), "root");
});

test("all twelve regular profiles are reachable from ordinary answers", async () => {
  const quiz = await loadQuizModel();
  const reached = new Set();
  let seed = 20260910;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let run = 0; run < 30_000 && reached.size < 12; run += 1) {
    const answers = Object.fromEntries(quiz.questions.map((question) => [question.id, Math.floor(random() * question.options.length)]));
    quiz.setState({
      answers,
      answerTimes: Object.fromEntries(quiz.questions.map((question) => [question.id, 2500 + Math.floor(random() * 9000)])),
      backtracks: Math.floor(random() * 4),
      idleHints: Math.floor(random() * 2),
      dangerPresses: 0,
      rootUnlocked: false,
    });
    reached.add(quiz.pickProfile(quiz.calculateMetrics().metrics));
  }

  assert.deepEqual(
    [...reached].sort((left, right) => left.localeCompare(right)),
    Object.keys(quiz.prototypes).sort((left, right) => left.localeCompare(right)),
  );
});
