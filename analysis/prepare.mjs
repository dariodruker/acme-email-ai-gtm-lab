// Step 1: verify the slice and write turn-numbered batch files plus an analyst brief for subagents.
//   node analysis/prepare.mjs [--config <file>] [--dry-run]
// --dry-run checks the slice and checksums and prints an inventory without writing anything.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig, loadCorpus, hasFlag } from "./lib.mjs";

const cfg = loadConfig();
const calls = loadCorpus(cfg);
const hidden = new Set(cfg.hideFromSubagents ?? []);

const count = (key) => calls.reduce((m, c) => ((m[key(c)] = (m[key(c)] ?? 0) + 1), m), {});
const inventory = {
  config: cfg.configFile,
  calls: calls.length,
  batches: Math.ceil(calls.length / cfg.batchSize),
  batchSize: cfg.batchSize,
  bySegment: count((c) => c.account?.segment ?? "unknown"),
  byCallType: count((c) => c.callType),
  words: calls.reduce((n, c) => n + (c.wordCount ?? 0), 0),
  hiddenFromSubagents: [...hidden],
  themesApproved: cfg.themesApprovedFor === cfg.dataDir,
};
console.log(JSON.stringify(inventory, null, 2));
if (hasFlag("--dry-run")) process.exit(0);

const work = cfg.paths.work;
fs.mkdirSync(path.join(work, "batches"), { recursive: true });
fs.mkdirSync(path.join(work, "results"), { recursive: true });

// Opportunity fields shown to subagents are whatever the config does not hide.
function oppLine(o) {
  if (!o) return null;
  const shown = Object.entries(o).filter(([k]) => !["id", "accountId", "name"].includes(k) && !hidden.has(k));
  return shown.length ? `opportunity: ${shown.map(([k, v]) => `${k}: ${v ?? "none"}`).join(" | ")}` : null;
}

const batches = [];
for (let i = 0; i < calls.length; i += cfg.batchSize) {
  const group = calls.slice(i, i + cfg.batchSize);
  const id = `batch_${String(batches.length + 1).padStart(2, "0")}`;
  const body = group.map((c) => [
    `=== CALL ${c.id} ===`,
    `type: ${c.callType} | date: ${c.occurredAt.slice(0, 10)} | segment: ${c.account?.segment} | industry: ${c.account?.industry} | region: ${c.account?.region}`,
    `account: ${c.account?.name}`,
    oppLine(c.opportunity),
    "",
    ...c.turns.map((t) => `[T${t.turn}] ${t.speaker} (${t.role}): ${t.text}`),
    "",
  ].filter((l) => l !== null).join("\n")).join("\n");
  fs.writeFileSync(path.join(work, "batches", `${id}.txt`), body);
  batches.push({ id, callIds: group.map((c) => c.id), file: `batches/${id}.txt`, result: `results/${id}.json` });
}

// The brief carries the run-specific theme list and scale; the call-analyst agent reads it first.
const s = cfg.sentimentScale;
fs.writeFileSync(path.join(work, "analyst-brief.md"), `# Analyst brief for this run

Config: ${cfg.configFile}

## Themes (use the key)

${cfg.themes.map((t) => `- \`${t.key}\`: ${t.label}`).join("\n")}

## Sentiment

- \`customer_sentiment\`, one of: ${s.labels.map((l) => `\`${l}\``).join(", ")}.
- \`sentiment_score\`: an integer from ${s.min} (most negative) to ${s.max} (most positive).
`);

fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify({
  createdAt: new Date().toISOString(),
  config: cfg.configFile,
  expectedCalls: calls.length,
  callIds: calls.map((c) => c.id),
  batches,
}, null, 2));
console.log(`wrote ${batches.length} batches and analyst-brief.md to ${path.relative(ROOT, work)}`);
