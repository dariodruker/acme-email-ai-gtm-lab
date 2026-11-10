// Theme proposal helper: writes a readable sample of calls for the analyze-calls skill to read.
//   node analysis/sample.mjs [--config <file>] [--n 8]
// Picks calls spread across call types and segments, deterministically.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig, loadCorpus, argValue } from "./lib.mjs";

const cfg = loadConfig();
const n = Number(argValue("--n") ?? 8);
const calls = loadCorpus(cfg);
const groups = new Map();
for (const c of calls) {
  const k = `${c.callType}|${c.account?.segment}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}
const keys = [...groups.keys()].sort();
const picked = [];
for (let round = 0; picked.length < Math.min(n, calls.length); round++) {
  for (const k of keys) if (groups.get(k)[round] && picked.length < n) picked.push(groups.get(k)[round]);
}
fs.mkdirSync(cfg.paths.work, { recursive: true });
const out = path.join(cfg.paths.work, "theme-sample.txt");
fs.writeFileSync(out, picked.map((c) => [
  `=== CALL ${c.id} | ${c.callType} | ${c.account?.segment} | ${c.account?.industry} ===`,
  ...c.turns.map((t) => `[T${t.turn}] ${t.speaker} (${t.role}): ${t.text}`), "",
].join("\n")).join("\n"));
console.log(`themes approved for this data: ${cfg.themesApprovedFor === cfg.dataDir ? "yes" : "no"}`);
console.log(`current themes: ${cfg.themeKeys.join(", ")}`);
console.log(`wrote ${picked.length} sample calls to ${path.relative(ROOT, out)}`);
