// Shared helpers for the call-analysis pipeline.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const DATA = path.join(ROOT, "data/generated");
export const WORK = path.join(ROOT, "work/call-analysis");
export const BATCH_SIZE = 20;

export const readJsonl = (f) =>
  fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function sliceIds() {
  return fs.readFileSync(path.join(ROOT, "data/class-slice.txt"), "utf8")
    .split("\n").map((s) => s.trim()).filter(Boolean);
}

// A transcript is paragraphs separated by blank lines: "Name (Role): text".
export function parseTurns(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, i) => {
    const m = p.match(/^([^:(]+?)\s*\(([^)]+)\):\s*([\s\S]*)$/);
    return m
      ? { turn: i + 1, speaker: m[1].trim(), role: m[2].trim(), text: m[3].trim() }
      : { turn: i + 1, speaker: "Unknown", role: "Unknown", text: p };
  });
}

export function loadCorpus() {
  const ids = sliceIds();
  const manifest = new Map(readJsonl(path.join(DATA, "manifest.jsonl")).map((r) => [r.id, r]));
  const accounts = new Map(readJsonl(path.join(DATA, "accounts.jsonl")).map((r) => [r.id, r]));
  const opps = new Map(readJsonl(path.join(DATA, "opportunities.jsonl")).map((r) => [r.id, r]));
  const calls = ids.map((id) => {
    const m = manifest.get(id);
    if (!m) throw new Error(`${id} is in class-slice.txt but not in manifest.jsonl`);
    const buf = fs.readFileSync(path.join(DATA, m.path));
    const actual = sha256(buf);
    if (actual !== m.sha256) throw new Error(`${id} checksum mismatch`);
    return { ...m, account: accounts.get(m.accountId), opportunity: opps.get(m.opportunityId),
      turns: parseTurns(buf.toString("utf8")) };
  });
  return calls;
}
