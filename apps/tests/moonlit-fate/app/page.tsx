"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Sparkles,
  Moon,
  MoveLeft,
  Check,
  BookOpen,
  RotateCcw,
  Heart,
  Feather,
  Compass,
  X,
  ChevronRight,
  Stars,
  Orbit,
  Leaf,
  KeyRound,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { artUrl } from "@/lib/art";
import { redeemLicense, verifyLicense } from "@/lib/license";
import {
  characters,
  chapters,
  dimensions,
  groups,
  questions,
  scoreAnswers,
  dimensionText,
  evidenceFor,
  type Character,
} from "@/lib/quiz";

type Stage = "intro" | "quiz" | "reveal" | "result";
const numeral = (n: number) => String(n).padStart(2, "0");
function Portrait({
  character,
  className = "",
}: {
  character: Character;
  className?: string;
}) {
  return (
    <div
      className={`portrait portrait-world-${character.group} portrait-character-${character.id} ${className}`}
    >
      <div
        role="img"
        aria-label={`${character.name}角色立绘`}
        className="portrait-art"
        style={{
          backgroundImage: `url(${artUrl(`characters/${character.id}`)})`,
        }}
      />
    </div>
  );
}
function Particles() {
  return (
    <div className="particles" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 41 + 7) % 100}%`,
              top: `${(i * 23 + 11) % 100}%`,
              animationDelay: `-${i * 1.7}s`,
              animationDuration: `${13 + (i % 5) * 3}s`,
              "--drift": `${(i % 2 ? 1 : -1) * (24 + i * 2)}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
function Divider() {
  return (
    <div className="ornament" aria-hidden="true">
      <span />✧<span />
    </div>
  );
}
function Radar({
  vector,
  character,
}: {
  vector: number[];
  character: Character;
}) {
  const points = (values: number[], scale = 1) =>
    values
      .map((v, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI) / 2;
        const r = ((v + 3) / 6) * 92 * scale;
        return `${150 + Math.cos(angle) * r},${137 + Math.sin(angle) * r}`;
      })
      .join(" ");
  return (
    <div className="radar-wrap">
      <svg
        viewBox="0 0 300 285"
        role="img"
        aria-label={`四维偏好图：${dimensions.map((d, i) => `${d.name}${Math.round(((vector[i] + 3) / 6) * 100)}`).join("，")}；越外侧越偏向热烈、探索、陪伴与规划。`}
      >
        {[0.25, 0.5, 0.75, 1].map((s) => (
          <polygon
            key={s}
            points={points([3, 3, 3, 3], s)}
            fill="none"
            stroke="#d8bd902b"
          />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1="150"
            y1="137"
            x2={150 + Math.cos(-Math.PI / 2 + (i * Math.PI) / 2) * 92}
            y2={137 + Math.sin(-Math.PI / 2 + (i * Math.PI) / 2) * 92}
            stroke="#d8bd902b"
          />
        ))}
        <polygon
          points={points(character.vector)}
          fill="#bc9ed50d"
          stroke="#b8a4d0"
          strokeDasharray="4 4"
        />
        <polygon
          className="radar-value"
          points={points(vector)}
          fill="#e0ba8a33"
          stroke="#e3c399"
          strokeWidth="2"
        />
        {["坦率热烈", "未知奇遇", "亲密同行", "认真规划"].map((t, i) => (
          <text
            key={t}
            x={[150, 263, 150, 37][i]}
            y={[23, 142, 265, 142][i]}
            textAnchor="middle"
            fill="#cbbcca"
            fontSize="13"
          >
            {t}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i />
          你的偏好
        </span>
        <span>
          <i />
          角色意象
        </span>
      </div>
    </div>
  );
}
function CharacterDetails({ character }: { character: Character }) {
  return (
    <div className="character-detail">
      <Portrait character={character} />
      <div>
        <div className="eyebrow">{groups[character.group].name}</div>
        <h2>{character.name}</h2>
        <p className="jp-name">
          <span lang="ja">{character.jp}</span> / {character.en}
        </p>
        <div className="tagline">{character.tag}</div>
        <p>{character.intro}</p>
        <Divider />
        <h3>{character.archetype}</h3>
        <p>{character.chemistry}</p>
        <p className="mini-note">
          角色气质为本测试的同人解读；插画、情境与文案均非官方内容。
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("intro");
  const [answers, setAnswers] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [lightMotion, setLightMotion] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [detail, setDetail] = useState<Character | null>(null);
  const [about, setAbout] = useState(false);
  const [licensed, setLicensed] = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [licenseCode, setLicenseCode] = useState("");
  const [licenseError, setLicenseError] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ stage, answers, index });
  latest.current = { stage, answers, index };
  const result = useMemo(
    () =>
      answers.length === 16 && answers.every((v) => Number.isInteger(v))
        ? scoreAnswers(answers)
        : null,
    [answers],
  );
  const changeStage = useCallback((next: Stage) => {
    setStage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const start = useCallback(() => {
    setAnswers([]);
    setIndex(0);
    changeStage("quiz");
  }, [changeStage]);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setLightMotion(q.matches);
    const change = () => setLightMotion(q.matches);
    q.addEventListener("change", change);
    return () => q.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (stage === "quiz" || stage === "result")
      headingRef.current?.focus({ preventScroll: true });
  }, [stage, index]);
  useEffect(() => {
    if (stage !== "reveal") return;
    const t = window.setTimeout(
      () => changeStage("result"),
      lightMotion ? 80 : 2000,
    );
    return () => window.clearTimeout(t);
  }, [stage, lightMotion, changeStage]);
  useEffect(() => {
    let active = true;
    void verifyLicense()
      .then((authorized) => { if (active) setLicensed(authorized); })
      .catch(() => { if (active) setLicensed(false); })
      .finally(() => { if (active) setLicenseChecked(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    type Tool = {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: Tool,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const nextPaint = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    const toolList: Tool[] = [
      {
        name: "read_moonlit_quiz",
        title: "读取当前心动测试",
        description: "读取当前阶段、题目、已选答案；完成后读取匹配结果。",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const s = latest.current;
          return {
            stage: s.stage,
            question:
              s.stage === "quiz"
                ? {
                    number: s.index + 1,
                    ...questions[s.index],
                    selected: s.answers[s.index] ?? null,
                  }
                : null,
            answered: s.answers.filter(Number.isInteger).length,
            result:
              s.stage === "result"
                ? scoreAnswers(s.answers)
                    .matches.slice(0, 3)
                    .map((m) => ({
                      id: m.character.id,
                      name: m.character.name,
                      score: m.score,
                    }))
                : null,
          };
        },
      },
      {
        name: "start_moonlit_quiz",
        title: "开始新的心动测试",
        description: "清空本轮答案并打开第一题。",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async () => {
          start();
          await nextPaint();
          return { stage: "quiz", question: 1 };
        },
      },
      {
        name: "answer_moonlit_question",
        title: "作答并继续",
        description:
          "为当前题选择0至3号选项并继续。必须传入当前题号1至16；末题展开结果。",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "integer", minimum: 1, maximum: 16 },
            option: { type: "integer", minimum: 0, maximum: 3 },
          },
          required: ["question", "option"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: async (input) => {
          const v = input as { question: number; option: number };
          const s = latest.current;
          if (
            !v ||
            s.stage !== "quiz" ||
            v.question !== s.index + 1 ||
            !Number.isInteger(v.option) ||
            v.option < 0 ||
            v.option > 3
          )
            throw new Error("题号或选项无效，请先读取当前题目。");
          setAnswers((a) => {
            const n = [...a];
            n[s.index] = v.option;
            return n;
          });
          if (s.index === 15) changeStage("result");
          else setIndex(s.index + 1);
          await nextPaint();
          return {
            stage: s.index === 15 ? "result" : "quiz",
            answered: v.question,
          };
        },
      },
    ];
    for (const tool of toolList) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    }
    return () => lifecycle.abort();
  }, [start, changeStage]);
  const q = questions[index];
  const chapter = chapters[Math.floor(index / 4)];
  const select = (value: string) => {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n < 4)
      setAnswers((a) => {
        const next = [...a];
        next[index] = n;
        return next;
      });
  };
  const next = () => {
    if (answers[index] === undefined) return;
    if (index === 15) changeStage("reveal");
    else {
      setIndex(index + 1);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  };
  const back = () => {
    if (index > 0) {
      setIndex(index - 1);
      window.scrollTo({ top: 0, behavior: "instant" });
    } else changeStage("intro");
  };
  const showCharacter = (c: Character) => {
    setDetail(c);
    setCatalog(true);
  };
  const match = result?.matches[0];
  const favorite = match?.character;
  const unlock = async () => {
    setLicenseError(""); setRedeeming(true);
    try { await redeemLicense(licenseCode); setLicensed(true); }
    catch (error) { setLicenseError(error instanceof Error ? error.message : "兑换失败，请检查兑换码"); }
    finally { setRedeeming(false); }
  };
  if (!licensed) return <div className={`app ${lightMotion ? "motion-lite" : ""}`}><header className="site-header"><button className="brand" onClick={() => window.location.reload()} aria-label="月下心笺"><span className="brand-symbol">✧</span><span>月下心笺<small>MOONLIT FATE</small></span></button></header><main><section className="license-gate"><KeyRound size={30}/><p className="eyebrow">MOONLIT FATE · ACCESS</p><h1>{licenseChecked ? "输入兑换码，开启心动测试" : "正在确认访问授权"}</h1><p>{licenseChecked ? "兑换码仅需使用一次，成功后当前浏览器可反复测试。" : "请稍候…"}</p>{licenseChecked && <><div className="license-form"><input value={licenseCode} onChange={e => setLicenseCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void unlock(); }} placeholder="请输入兑换码" aria-label="兑换码" autoComplete="off"/><button className="primary-button" onClick={() => void unlock()} disabled={redeeming || !licenseCode.trim()}>{redeeming ? "验证中…" : "立即解锁"}<KeyRound size={17}/></button></div>{licenseError && <p className="license-error" role="alert">{licenseError}</p>}<small>兑换码由购买平台提供 · 本页不参与支付</small></>}</section></main><footer className="site-footer"><span>✧ 月下心笺</span><p>同人娱乐测试 · 不属于心理测评或关系建议</p></footer></div>;
  return (
    <div className={`app ${lightMotion ? "motion-lite" : ""}`}>
      <header className="site-header">
        <button
          className="brand"
          onClick={() => changeStage("intro")}
          aria-label="月下心笺，返回首页"
        >
          <span className="brand-symbol">✧</span>
          <span>
            月下心笺<small>MOONLIT FATE</small>
          </span>
        </button>
        <span className="header-note">一场只属于你的，心动奇遇</span>
        <div className="header-actions">
          <button
            className="text-button catalog-link"
            onClick={() => {
              setDetail(null);
              setCatalog(true);
            }}
          >
            <BookOpen size={16} />
            <span>角色图鉴</span>
          </button>
          <button
            className="text-button motion-button"
            aria-pressed={lightMotion}
            onClick={() => setLightMotion(!lightMotion)}
            aria-label={lightMotion ? "开启完整动效" : "开启轻盈动效"}
          >
            {lightMotion ? <Leaf size={16} /> : <Sparkles size={16} />}
            <span>{lightMotion ? "轻盈动效" : "完整动效"}</span>
          </button>
        </div>
      </header>
      <main>
        {stage === "intro" && (
          <div className="view-enter">
            <section className="hero">
              <div className="hero-image" />
              <div className="hero-shade" />
              <Particles />
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="hero-content">
                <div className="eyebrow">
                  <span /> THE HEART KNOWS THE WAY
                </div>
                <p className="intro-kicker">13 位吸血鬼 · 13 种危险心动</p>
                <h1>
                  循着心动，
                  <br />
                  遇见<span>命定的他</span>
                  <i>。</i>
                </h1>
                <p className="hero-description">
                  当月光照进逆卷宅邸，
                  <br />
                  你的每一次选择，都在唤醒一段命定羁绊。
                </p>
                <button className="primary-button" onClick={start}>
                  开启心动测试 <ArrowRight size={20} />
                </button>
                <div className="test-meta">
                  <span>16 道情境题</span>
                  <span>约 3–5 分钟</span>
                  <span>凭直觉选择</span>
                </div>
                {answers.length > 0 && (
                  <button
                    className="resume-button"
                    onClick={() => changeStage(result ? "result" : "quiz")}
                  >
                    {result ? "重读我的心动结果" : "继续刚才的心动旅程"}
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>
              <div className="hero-caption">
                <span>✦ DIABOLIK ENCOUNTER</span>
                <p>“今夜，听见血色蔷薇的答案。”</p>
                <small>用户提供角色立绘 · 非官方企划</small>
              </div>
              <div className="hero-bottom">
                <span>逆卷家族</span>
                <i>✧</i>
                <span>无神家族</span>
                <i>✧</i>
                <span>月浪家族</span>
                <i>✧</i>
                <span>索恩家族</span>
              </div>
            </section>
            <section className="encounters">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">YOUR DESTINED ENCOUNTER</p>
                  <h2>四大家族，十三种命定羁绊</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setDetail(null);
                    setCatalog(true);
                  }}
                >
                  邂逅全部 13 位 <ArrowUpRight size={18} />
                </button>
              </div>
              <div className="world-cards">
                {[characters[0], characters[6], characters[10]].map((c, i) => (
                  <button
                    key={c.id}
                    className={`world-card world-${i}`}
                    onClick={() => showCharacter(c)}
                  >
                    <div className="world-portrait">
                      <Portrait character={c} />
                    </div>
                    <div className="world-overlay" />
                    <span className="world-number">0{i + 1}</span>
                    <div className="world-copy">
                      <span>{groups[i].name}</span>
                      <h3>{groups[i].subtitle}</h3>
                      <p>
                        {i === 0
                          ? "蔷薇宅邸里，六种心跳悄然苏醒。"
                          : i === 1
                            ? "不同的过去，汇成四种深刻靠近。"
                            : "古老血脉之下，藏着最危险的心意。"}
                      </p>
                    </div>
                    <ArrowUpRight size={20} />
                  </button>
                ))}
              </div>
              <p className="section-note">
                四个心动维度，读懂你偏爱的吸引力。没有标准答案，也无需迎合任何人。
              </p>
            </section>
          </div>
        )}
        {stage === "quiz" && (
          <section className="quiz-shell view-enter">
            <Particles />
            <div className="quiz-top">
              <button className="text-button" onClick={back}>
                <MoveLeft size={17} />
                {index === 0 ? "回到扉页" : "上一题"}
              </button>
              <span className="quiz-count">
                <strong>{numeral(index + 1)}</strong>
                <span>/ 16</span>
              </span>
              <span className="quiz-top-hint">跟随直觉，不必想得太久</span>
            </div>
            <Progress
              value={(index / 16) * 100}
              aria-label={`测试进度，正在第${index + 1}题，共16题`}
              className="quiz-progress"
            />
            <div className="quiz-layout">
              <aside className="chapter-panel">
                <div className="chapter-art">
                  <div className="chapter-image" />
                  <div className="chapter-image-shade" />
                  <div className="chapter-moon">
                    <Moon size={40} />
                  </div>
                  <div className="chapter-copy">
                    <span>
                      CHAPTER {["I", "II", "III", "IV"][Math.floor(index / 4)]}
                    </span>
                    <h2>{chapter.name}</h2>
                    <p>{chapter.en}</p>
                    <Divider />
                    <p>{chapter.line}</p>
                  </div>
                </div>
                <div className="chapter-steps">
                  {chapters.map((c, i) => (
                    <div
                      className={
                        i === Math.floor(index / 4)
                          ? "current"
                          : i < Math.floor(index / 4)
                            ? "done"
                            : ""
                      }
                      key={c.name}
                    >
                      <span>
                        {i < Math.floor(index / 4) ? (
                          <Check size={12} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      {c.name}
                    </div>
                  ))}
                </div>
              </aside>
              <div className="question-panel" key={q.id}>
                <span className="question-label">
                  心动片段 {numeral(index + 1)}
                  <i>✦</i>
                </span>
                <h1 ref={headingRef} tabIndex={-1} id="question-title">
                  {q.title}
                </h1>
                <p className="question-scene">{q.scene}</p>
                <RadioGroup
                  value={
                    answers[index] === undefined ? "" : String(answers[index])
                  }
                  onValueChange={select}
                  aria-labelledby="question-title"
                  className="answers"
                >
                  {q.options.map((option, j) => (
                    <label
                      className={`answer ${answers[index] === j ? "selected" : ""}`}
                      key={j}
                      htmlFor={`${q.id}-${j}`}
                    >
                      <span className="option-letter">
                        {String.fromCharCode(65 + j)}
                      </span>
                      <span className="option-text">{option}</span>
                      <RadioGroupItem
                        id={`${q.id}-${j}`}
                        value={String(j)}
                        aria-label={option}
                        className="answer-radio"
                      />
                    </label>
                  ))}
                </RadioGroup>
                <div className="question-footer">
                  <span>
                    {answers[index] === undefined
                      ? "选择最接近你的那一个"
                      : "已选好，继续故事吧"}
                    <span className="desktop-hint">
                      方向键切换 · Tab 移至下一步
                    </span>
                  </span>
                  <button
                    className="primary-button next-button"
                    onClick={next}
                    disabled={answers[index] === undefined}
                  >
                    {index === 15 ? "揭晓命定角色" : "下一段心动"}
                    <ArrowRight size={19} />
                  </button>
                </div>
              </div>
            </div>
            <p className="quiz-privacy">
              答案仅在当前页面内计算，不上传个人资料。刷新页面会重新开始。
            </p>
          </section>
        )}
        {stage === "reveal" && (
          <section className="reveal-screen" role="status" aria-live="polite">
            <Particles />
            <div className="reveal-orbits">
              <i />
              <i />
              <i />
              <span>✧</span>
            </div>
            <p className="eyebrow">A LETTER WRITTEN IN THE STARS</p>
            <h1>月光正在展开你的心笺</h1>
            <p>十六次选择，汇成这一刻的相遇。</p>
          </section>
        )}
        {stage === "result" && result && favorite && match && (
          <section
            className="result-shell view-enter"
            style={{ "--character-color": favorite.color } as CSSProperties}
          >
            <div className="result-top">
              <div className="eyebrow">YOUR MOONLIT DESTINY · 心动档案</div>
              <button
                className="text-button"
                onClick={() => {
                  setIndex(0);
                  changeStage("quiz");
                }}
              >
                <Feather size={16} />
                回看答案
              </button>
            </div>
            <div className="result-hero">
              <div className="result-portrait">
                <Portrait character={favorite} />
                <div className="portrait-vignette" />
                <div className="portrait-corner tl" />
                <div className="portrait-corner br" />
                <span className="portrait-edition">
                  MOONLIT FATE / No.{numeral(characters.indexOf(favorite) + 1)}
                </span>
                <span className="portrait-sign">{favorite.en}</span>
              </div>
              <div className="result-intro">
                <p className="eyebrow">
                  <Stars size={16} /> 在故事里，与你共鸣的他是
                </p>
                <h1 ref={headingRef} tabIndex={-1}>
                  {favorite.name}
                </h1>
                <p className="result-jp">
                  <span lang="ja">{favorite.jp}</span>
                  <span> / </span>
                  {groups[favorite.group].name}
                </p>
                <div className="result-tags">
                  {favorite.tag.split(" · ").map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <h2>{favorite.archetype}</h2>
                <p>{favorite.intro}</p>
                <div className="resonance">
                  <div>
                    <strong>
                      {match.score}
                      <small>/100</small>
                    </strong>
                    <span>故事共鸣指数</span>
                  </div>
                  <p>
                    依据本次四维偏好与角色意象的接近程度计算，
                    <br />
                    不代表真实恋爱概率或心理测量分数。
                  </p>
                </div>
                {result.matches[1].score >= match.score - 3 && (
                  <p className="close-match">
                    ✧ 你也与{result.matches[1].character.name}
                    十分接近。心动有时不止一种答案。
                  </p>
                )}
              </div>
            </div>
            <div className="result-quote">
              <span>“</span>
              <p>{favorite.quote}</p>
              <span>”</span>
            </div>
            <div className="analysis-grid">
              <section className="analysis-panel preference-panel">
                <div className="section-heading compact">
                  <div>
                    <p className="eyebrow">01 / THE SHAPE OF YOUR HEART</p>
                    <h2>你的心动轮廓</h2>
                  </div>
                  <Orbit className="gold" size={22} />
                </div>
                <div className="preference-body">
                  <Radar vector={result.vector} character={favorite} />
                  <div className="dimension-bars">
                    {dimensions.map((d, i) => (
                      <div key={d.name} className="dimension-row">
                        <div>
                          <strong>{d.name}</strong>
                          <span>
                            {Math.abs(result.vector[i]) <= 0.5
                              ? "均衡倾向"
                              : result.vector[i] > 0
                                ? d.high
                                : d.low}
                          </span>
                        </div>
                        <div className="dimension-track">
                          <i
                            style={{
                              left: `${((result.vector[i] + 3) / 6) * 100}%`,
                            }}
                          />
                        </div>
                        <div className="dimension-poles">
                          <span>{d.low}</span>
                          <span>{d.high}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="dimension-readings">
                  {dimensions.map((d, i) => (
                    <div key={d.name}>
                      <h3>
                        <span>0{i + 1}</span>
                        {d.name}
                      </h3>
                      <p>{dimensionText(i, result.vector[i])}</p>
                    </div>
                  ))}
                </div>
                <p className="mini-note">
                  刻度表示两端偏好的相对位置，没有高低优劣；居中也可能是不同情境下选择不同。
                </p>
              </section>
              <section className="analysis-panel chemistry-panel">
                <p className="eyebrow">02 / WHY YOUR STORIES ALIGN</p>
                <h2>为什么会是他？</h2>
                <p>{favorite.chemistry}</p>
                <h3 className="evidence-title">
                  <Heart size={16} /> 你的选择留下了线索
                </h3>
                <div className="evidence-list">
                  {evidenceFor(answers, favorite).map((e) => (
                    <div key={e.question.id}>
                      <span>{numeral(questions.indexOf(e.question) + 1)}</span>
                      <div>
                        <blockquote>“{e.answer}”</blockquote>
                        <p>
                          与你在「{dimensions[e.question.dimension].name}
                          」上的偏好呼应。
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="imagined-scene">
                  <div className="eyebrow">IF YOUR STORY BEGINS</div>
                  <h3>如果相遇发生在今晚</h3>
                  <p>{favorite.scene}</p>
                  <small>为你们创作的同人情境 · 非原作剧情</small>
                </div>
              </section>
              <section className="analysis-panel advice-panel">
                <p className="eyebrow">03 / A LITTLE CLOSER</p>
                <h2>让心动走向舒服的相处</h2>
                <div className="advice-columns">
                  <div>
                    <span className="advice-icon">
                      <Compass size={20} />
                    </span>
                    <h3>容易错过的信号</h3>
                    <p>{favorite.friction}</p>
                  </div>
                  <div>
                    <span className="advice-icon">
                      <Feather size={20} />
                    </span>
                    <h3>写给你的相处小笺</h3>
                    <p>{favorite.advice}</p>
                  </div>
                </div>
              </section>
            </div>
            <section className="other-matches">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">ANOTHER POSSIBLE CHAPTER</p>
                  <h2>你故事里的另外两种可能</h2>
                </div>
                <span className="mini-note">同一颗心，也有不同侧面</span>
              </div>
              <div className="runner-grid">
                {result.matches.slice(1, 3).map((m, i) => (
                  <button
                    key={m.character.id}
                    className="runner-card"
                    onClick={() => showCharacter(m.character)}
                  >
                    <Portrait character={m.character} />
                    <div>
                      <span className="eyebrow">
                        0{i + 2} / {groups[m.character.group].name}
                      </span>
                      <h3>{m.character.name}</h3>
                      <span className="runner-jp" lang="ja">
                        {m.character.jp}
                      </span>
                      <p>{m.character.archetype}</p>
                      <span className="runner-score">
                        共鸣指数 {m.score} / 100
                      </span>
                    </div>
                    <ArrowUpRight size={20} />
                  </button>
                ))}
              </div>
            </section>
            <div className="result-end">
              <Divider />
              <p>故事里的命定是浪漫的想象，真实的你永远比一次测试更丰富。</p>
              <button className="primary-button" onClick={start}>
                <RotateCcw size={17} />
                重新开启一场邂逅
              </button>
              <button className="text-button" onClick={() => setAbout(true)}>
                这份心笺如何写成？
              </button>
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>✧ 月下心笺</span>
        <p>同人娱乐测试 · 不属于心理测评或关系建议</p>
        <button className="text-button" onClick={() => setAbout(true)}>
          关于企划 <ArrowUpRight size={13} />
        </button>
      </footer>
      <Dialog open={catalog} onOpenChange={setCatalog}>
        <DialogContent
          className={`catalog-dialog ${lightMotion ? "motion-lite" : ""}`}
          showCloseButton={false}
        >
          <div className="dialog-heading">
            <div>
              <DialogTitle className="dialog-title">
                {detail ? "月下角色档案" : "十三种心动，等你翻阅"}
              </DialogTitle>
              <DialogDescription className="dialog-description">
                {detail
                  ? "保留角色气质的同人演绎"
                  : "逆卷家族 · 无神家族 · 月浪家族 · 索恩家族"}
              </DialogDescription>
            </div>
            <DialogClose className="icon-button" aria-label="关闭角色图鉴">
              <X size={20} />
            </DialogClose>
          </div>
          {detail ? (
            <>
              <button className="text-button" onClick={() => setDetail(null)}>
                <MoveLeft size={16} />
                返回全部角色
              </button>
              <CharacterDetails character={detail} />
            </>
          ) : (
            <div className="catalog-scroll">
              {groups.map((g, i) => (
                <section className="catalog-group" key={g.name}>
                  <div className="catalog-group-title">
                    <span>0{i + 1}</span>
                    <h3>{g.name}</h3>
                    <small>{g.subtitle}</small>
                  </div>
                  <div className="catalog-grid">
                    {characters
                      .filter((c) => c.group === i)
                      .map((c) => (
                        <button
                          className="catalog-card"
                          onClick={() => setDetail(c)}
                          key={c.id}
                        >
                          <Portrait character={c} />
                          <div>
                            <h4>{c.name}</h4>
                            <span lang="ja">{c.jp}</span>
                          </div>
                        </button>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent className="about-dialog" showCloseButton={false}>
          <div className="dialog-heading">
            <DialogTitle className="dialog-title">关于这份月下心笺</DialogTitle>
            <DialogClose className="icon-button" aria-label="关闭企划说明">
              <X size={20} />
            </DialogClose>
          </div>
          <DialogDescription className="dialog-description">
            以《魔鬼恋人》的角色魅力为灵感，重新创作的中文同人娱乐企划。
          </DialogDescription>
          <div className="about-copy">
            <h3>从情境选择，到十三种心动</h3>
            <p>
              测试收录逆卷家族六人、无神家族四人、月浪家族两人，以及索恩家族的基诺。16
              道原创情境题从表达、探索、陪伴与秩序四个方向勾勒你的偏好。
            </p>
            <p>
              每个维度综合 4 道题，再与 13
              组人工设定的角色意象比较；四维距离越近，共鸣指数越高。完全同分时按角色图鉴顺序排列，接近的结果会单独提示。
            </p>
            <h3>认真写故事，轻松看结果</h3>
            <p>
              本测试未经过心理测量验证，也不推断人格、依恋类型或真实关系结局。角色简介和相处分析是娱乐向同人解读，情境与寄语为原创文案，不是官方设定或台词。
            </p>
            <h3>角色与素材</h3>
            <p>
              角色名称与作品归属参考用户提供的资料图及官网。13
              位角色立绘采用用户提供的对应图片，相关角色权利归原权利人所有。本页为非官方同人企划。
            </p>
            <div className="source-links">
              <a href="https://dialover.net/" target="_blank" rel="noreferrer">
                DIABOLIK LOVERS 官方资料 <ArrowUpRight size={14} />
              </a>
            </div>
            <h3>你的选择留在这里</h3>
            <p>
              答题内容只在当前浏览器页面内计算，不会发送到服务器；刷新或关闭页面后清空。可用上一题和回看答案调整选择，结果会随之变化。
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
