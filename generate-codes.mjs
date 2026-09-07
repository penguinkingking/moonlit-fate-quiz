import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const count = Math.min(1000, Math.max(1, Number(process.argv[2] || 10)));
const output = resolve(process.argv[3] || `codes-${new Date().toISOString().slice(0,10)}.txt`);
const codeSet = new Set();
while (codeSet.size < count) {
  const raw = randomBytes(9).toString("hex").toUpperCase().slice(0, 12);
  codeSet.add(`DL13-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`);
}
const codes = [...codeSet];
await mkdir(resolve(output, ".."), { recursive: true }); await writeFile(output, `${codes.join("\n")}\n`, "utf8"); console.log(`Generated ${codes.length} codes: ${output}`);
