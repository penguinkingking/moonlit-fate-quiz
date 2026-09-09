import { createPasswordHash } from "../server/crypto.mjs";

const password = process.argv[2];
if (!password) throw new Error("Usage: node scripts/hash-password.mjs <password>");
console.log(createPasswordHash(password));
