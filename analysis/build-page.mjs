// Step 5: read the SQLite results and write a self-contained HTML page for the artifact.
//   node analysis/build-page.mjs [--config <file>] [--overwrite]
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT, loadConfig, readJsonl, guardOverwrite } from "./lib.mjs";

const cfg = loadConfig();
guardOverwrite(cfg.paths.page);
const db = new DatabaseSync(cfg.paths.db, { readOnly: true });
const meta = Object.fromEntries(db.prepare("SELECT key, value FROM run_meta").all().map((r) => [r.key, JSON.parse(r.value)]));

const calls = db.prepare(`
  SELECT c.id, c.call_type, c.occurred_at, c.duration_min, c.batch_id, a.name acct, a.segment, a.industry, a.region,
         a.arr, o.stage, o.outcome, o.competitor, o.amount, cov.status, cov.reason,
         ca.summary, ca.sentiment, ca.sentiment_score, ca.sentiment_rationale, ca.sentiment_turns, ca.competitors,
         ca.next_step, ca.label_noise_turns
  FROM calls c JOIN accounts a ON a.id = c.account_id LEFT JOIN opportunities o ON o.id = c.opportunity_id
  JOIN coverage cov ON cov.call_id = c.id LEFT JOIN call_analysis ca ON ca.call_id = c.id
  ORDER BY c.occurred_at`).all();
// A speaker is on the customer side when their name is a CRM contact; role labels carry transcription noise.
const contactsFile = path.join(cfg.paths.data, "contacts.jsonl");
const contactNames = new Set(fs.existsSync(contactsFile) ? readJsonl(contactsFile).map((p) => p.name) : []);
const turnsBy = new Map();
for (const t of db.prepare("SELECT call_id, turn, speaker, role, text FROM turns ORDER BY call_id, turn").all()) {
  if (!turnsBy.has(t.call_id)) turnsBy.set(t.call_id, []);
  turnsBy.get(t.call_id).push([t.speaker, t.role, t.text, contactNames.has(t.speaker) ? "c" : "a"]);
}
const insights = db.prepare("SELECT * FROM insights ORDER BY call_id, severity DESC, id").all();

const data = {
  meta: {
    ...meta, builtAt: new Date().toISOString(), batches: meta.batches ?? new Set(calls.map((c) => c.batch_id)).size,
    name: cfg.name, themes: Object.fromEntries(cfg.themes.map((t) => [t.key, t.label])), scale: cfg.sentimentScale,
  },
  calls: calls.map((c) => ({
    id: c.id, acct: c.acct, seg: c.segment, ind: c.industry, reg: c.region, type: c.call_type,
    date: c.occurred_at.slice(0, 10), dur: c.duration_min, stage: c.stage, outcome: c.outcome, crmComp: c.competitor,
    amt: c.amount, status: c.status, reason: c.reason, summ: c.summary, sent: c.sentiment, score: c.sentiment_score,
    rat: c.sentiment_rationale, sTurns: JSON.parse(c.sentiment_turns ?? "[]"), comps: JSON.parse(c.competitors ?? "[]"),
    next: c.next_step, noise: JSON.parse(c.label_noise_turns ?? "[]"), turns: turnsBy.get(c.id) ?? [],
  })),
  insights: insights.map((i) => ({
    c: i.call_id, th: i.theme, ty: i.type, by: i.raised_by, pol: i.polarity, sev: i.severity, lab: i.label,
    det: i.detail, turns: JSON.parse(i.turns), qt: i.quote, qTurn: i.quote_turn, qs: i.quote_start, qe: i.quote_end, st: i.evidence_status,
  })),
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const template = fs.readFileSync(path.join(ROOT, "analysis/page.html"), "utf8");
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const html = template
  .replace("__TITLE__", () => esc(cfg.pageTitle ?? "Call Review"))
  .replace("__DATA__", () => json);
fs.writeFileSync(cfg.paths.page, html);
console.log(`wrote ${path.relative(ROOT, cfg.paths.page)} (${(fs.statSync(cfg.paths.page).size / 1e6).toFixed(2)} MB)`);
