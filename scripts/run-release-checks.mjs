import { spawn } from "node:child_process";

const timeoutMs = Math.max(30_000, Number(process.env.RELEASE_STEP_TIMEOUT_MS) || 5 * 60_000);
const stages = ["test:validate", "build:platform", "test", "typecheck", "lint"];

function runStage(stage) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log(`[release-check] start ${stage}`);
    const windows = process.platform === "win32";
    const child = spawn(windows ? `npm run ${stage}` : "npm", windows ? [] : ["run", stage], {
      cwd: process.cwd(),
      env: process.env,
      shell: windows,
      stdio: "inherit",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (timedOut) return reject(new Error(`${stage} exceeded ${timeoutMs}ms`));
      if (code !== 0) return reject(new Error(`${stage} failed with code ${code ?? "none"} (${signal || "no signal"})`));
      console.log(`[release-check] pass ${stage} (${seconds}s)`);
      resolve();
    });
  });
}

for (const stage of stages) await runStage(stage);
console.log("[release-check] all sequential checks passed");
