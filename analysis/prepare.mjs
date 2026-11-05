// Step 1: verify the 200-call slice and write turn-numbered batch files for subagents.
import fs from "node:fs";
import path from "node:path";
import { WORK, BATCH_SIZE, loadCorpus } from "./lib.mjs";

const calls = loadCorpus();
if (new Set(calls.map((c) => c.id)).size !== calls.length) throw new Error("duplicate IDs in slice");
fs.mkdirSync(path.join(WORK, "batches"), { recursive: true });
fs.mkdirSync(path.join(WORK, "results"), { recursive: true });

const batches = [];
for (let i = 0; i < calls.length; i += BATCH_SIZE) {
  const group = calls.slice(i, i + BATCH_SIZE);
  const id = `batch_${String(batches.length + 1).padStart(2, "0")}`;
  const body = group.map((c) => [
    `=== CALL ${c.id} ===`,
    `type: ${c.callType} | date: ${c.occurredAt.slice(0, 10)} | segment: ${c.account.segment} | industry: ${c.account.industry} | region: ${c.account.region}`,
    // CRM stage, outcome and competitor are withheld so they cannot bias the read; they are joined in SQLite later.
    `account: ${c.account.name}`,
    "",
    ...c.turns.map((t) => `[T${t.turn}] ${t.speaker} (${t.role}): ${t.text}`),
    "",
  ].join("\n")).join("\n");
  fs.writeFileSync(path.join(WORK, "batches", `${id}.txt`), body);
  batches.push({ id, callIds: group.map((c) => c.id), file: `batches/${id}.txt`, result: `results/${id}.json` });
}

fs.writeFileSync(path.join(WORK, "manifest.json"), JSON.stringify({
  createdAt: new Date().toISOString(),
  expectedCalls: calls.length,
  callIds: calls.map((c) => c.id),
  batches,
}, null, 2));
console.log(`verified ${calls.length} calls, wrote ${batches.length} batches to ${WORK}`);
