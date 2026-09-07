import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = resolve(process.argv[2]);
const output = resolve(process.argv[3] || "licenses.seed.json");
const codes = (await readFile(input, "utf8")).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
const unique = [...new Set(codes)];
if (codes.length !== 1000 || unique.length !== 1000) throw new Error("Expected exactly 1000 unique codes");
if (unique.some((code) => !/^DL13-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code))) throw new Error("Invalid redemption code format");
const seed = {
  batch: "20260908-import-1000",
  createdAt: new Date().toISOString(),
  hashes: unique.map((code) => createHash("sha256").update(code).digest("hex")),
};
await writeFile(output, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
console.log(`Built ${seed.hashes.length} hashed licenses: ${output}`);
