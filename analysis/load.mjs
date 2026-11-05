// Step 3: validate subagent results against the transcripts and load everything into SQLite.
// Nothing is dropped silently: every slice call ends up as analyzed, failed or missing in `coverage`.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT, WORK, loadCorpus } from "./lib.mjs";

const THEMES = ["campaigns", "segmentation_scoring", "nurture_journeys", "crm_sync", "attribution_reporting",
  "forms_landing_pages", "consent_privacy", "deliverability", "security_governance", "pricing_packaging",
  "migration_onboarding", "support_service", "usability_adoption", "integrations_data", "competition", "other"];
// Known near-misses from subagent output, normalized instead of dropped to "other".
const THEME_ALIASES = { competitive: "competition", competitor: "competition", competitors: "competition" };
const TYPES = ["pain_point", "feature_request", "praise", "objection", "risk", "competitive"];
const SENTIMENTS = ["positive", "mixed", "neutral", "negative"];

const DB_PATH = path.join(ROOT, "reports/call-analysis.sqlite");
const manifest = JSON.parse(fs.readFileSync(path.join(WORK, "manifest.json"), "utf8"));
const calls = new Map(loadCorpus().map((c) => [c.id, c]));

// Normalize quotes, dashes and whitespace so a verbatim check survives typography differences.
const norm = (s) => s.replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
  .replace(/\s+/g, " ").trim().toLowerCase();

function locate(call, quote, preferred) {
  const q = norm(quote ?? "").replace(/^["'.… ]+|["'.… ]+$/g, "");
  if (q.length < 8) return null;
  const order = [...preferred.map((n) => call.turns[n - 1]).filter(Boolean),
    ...call.turns.filter((t) => !preferred.includes(t.turn))];
  for (const t of order) {
    // Map normalized offsets back to raw text by normalizing char-by-char.
    const raw = t.text;
    let normText = "", map = [];
    for (let i = 0; i < raw.length; i++) {
      const n = norm(raw[i] === " " || /\s/.test(raw[i]) ? " " : raw[i]) || " ";
      if (n === " " && normText.endsWith(" ")) continue;
      normText += n; map.push(i);
    }
    const at = normText.indexOf(q);
    if (at >= 0) return { turn: t.turn, start: map[at], end: map[at + q.length - 1] + 1, relocated: !preferred.includes(t.turn) };
  }
  return null;
}

fs.rmSync(DB_PATH, { force: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, segment TEXT, industry TEXT, region TEXT, employees INTEGER, arr REAL);
CREATE TABLE opportunities (id TEXT PRIMARY KEY, account_id TEXT, name TEXT, stage TEXT, outcome TEXT, competitor TEXT, amount REAL, close_date TEXT);
CREATE TABLE calls (id TEXT PRIMARY KEY, account_id TEXT, opportunity_id TEXT, call_type TEXT, occurred_at TEXT,
  duration_min INTEGER, word_count INTEGER, sha256 TEXT, batch_id TEXT);
CREATE TABLE turns (call_id TEXT, turn INTEGER, speaker TEXT, role TEXT, text TEXT, PRIMARY KEY (call_id, turn));
CREATE TABLE call_analysis (call_id TEXT PRIMARY KEY, summary TEXT, sentiment TEXT, sentiment_score INTEGER,
  sentiment_rationale TEXT, sentiment_turns TEXT, competitors TEXT, next_step TEXT, label_noise_turns TEXT);
CREATE TABLE insights (id INTEGER PRIMARY KEY, call_id TEXT, theme TEXT, type TEXT, raised_by TEXT, polarity TEXT,
  severity INTEGER, label TEXT, detail TEXT, turns TEXT, quote TEXT, quote_turn INTEGER, quote_start INTEGER,
  quote_end INTEGER, evidence_status TEXT);
CREATE TABLE coverage (call_id TEXT PRIMARY KEY, batch_id TEXT, status TEXT, reason TEXT);
CREATE TABLE validation_issues (call_id TEXT, batch_id TEXT, issue TEXT);
CREATE TABLE run_meta (key TEXT PRIMARY KEY, value TEXT);
`);

const ins = (sql) => db.prepare(sql);
const insAcct = ins("INSERT OR IGNORE INTO accounts VALUES (?,?,?,?,?,?,?)");
const insOpp = ins("INSERT OR IGNORE INTO opportunities VALUES (?,?,?,?,?,?,?,?)");
const insCall = ins("INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?)");
const insTurn = ins("INSERT INTO turns VALUES (?,?,?,?,?)");
const insAnalysis = ins("INSERT INTO call_analysis VALUES (?,?,?,?,?,?,?,?,?)");
const insInsight = ins(`INSERT INTO insights (call_id, theme, type, raised_by, polarity, severity, label, detail, turns,
  quote, quote_turn, quote_start, quote_end, evidence_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insCov = ins("INSERT INTO coverage VALUES (?,?,?,?)");
const insIssue = ins("INSERT INTO validation_issues VALUES (?,?,?)");

db.exec("BEGIN");
const batchOf = new Map();
for (const b of manifest.batches) for (const id of b.callIds) batchOf.set(id, b.id);

for (const c of calls.values()) {
  const a = c.account, o = c.opportunity;
  insAcct.run(a.id, a.name, a.segment, a.industry, a.region, a.employees, a.arr);
  if (o) insOpp.run(o.id, o.accountId, o.name, o.stage, o.outcome, o.competitor, o.amount, o.closeDate);
  insCall.run(c.id, c.accountId, c.opportunityId, c.callType, c.occurredAt, c.durationMinutes, c.wordCount, c.sha256, batchOf.get(c.id));
  for (const t of c.turns) insTurn.run(c.id, t.turn, t.speaker, t.role, t.text);
}

const done = new Set();
const stats = { insights: 0, verified: 0, relocated: 0, unverified: 0 };
for (const b of manifest.batches) {
  const file = path.join(WORK, b.result);
  let result;
  try { result = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { insIssue.run(null, b.id, `result unreadable: ${e.message}`); continue; }
  const expected = new Set(b.callIds);

  for (const f of result.failures ?? []) {
    if (!expected.has(f.call_id) || done.has(f.call_id)) continue;
    insCov.run(f.call_id, b.id, "failed", f.reason ?? "subagent reported failure"); done.add(f.call_id);
  }
  for (const r of result.calls ?? []) {
    const call = calls.get(r.call_id);
    if (!expected.has(r.call_id) || !call) { insIssue.run(r.call_id, b.id, "call not in this batch"); continue; }
    if (done.has(r.call_id)) { insIssue.run(r.call_id, b.id, "duplicate result ignored"); continue; }
    const problems = [];
    if (!SENTIMENTS.includes(r.customer_sentiment)) problems.push(`bad sentiment ${r.customer_sentiment}`);
    if (!Array.isArray(r.insights)) problems.push("insights missing");
    if (problems.length) { insCov.run(r.call_id, b.id, "failed", problems.join("; ")); done.add(r.call_id); continue; }

    const maxTurn = call.turns.length;
    const okTurns = (arr) => (Array.isArray(arr) ? arr : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= maxTurn);
    insAnalysis.run(r.call_id, r.summary, r.customer_sentiment, Math.max(-2, Math.min(2, Math.round(r.sentiment_score ?? 0))),
      r.sentiment_rationale, JSON.stringify(okTurns(r.sentiment_turns)), JSON.stringify(r.competitors_mentioned ?? []),
      r.next_step ?? null, JSON.stringify(okTurns(r.label_noise_turns)));

    for (const i of r.insights) {
      const theme = THEMES.includes(i.theme) ? i.theme : THEME_ALIASES[i.theme] ?? "other";
      if (theme !== i.theme) insIssue.run(r.call_id, b.id, `theme ${i.theme} normalized to ${theme}`);
      const type = TYPES.includes(i.type) ? i.type : "pain_point";
      const turns = okTurns(i.turns);
      const hit = locate(call, i.quote, turns);
      const status = !hit ? "unverified" : hit.relocated ? "relocated" : "verified";
      stats.insights++; stats[status]++;
      if (!hit) insIssue.run(r.call_id, b.id, `quote not found: ${String(i.quote).slice(0, 80)}`);
      const allTurns = hit && !turns.includes(hit.turn) ? [...turns, hit.turn].sort((x, y) => x - y) : turns;
      insInsight.run(r.call_id, theme, type, i.raised_by === "seller" ? "seller" : "customer",
        ["positive", "negative", "neutral"].includes(i.polarity) ? i.polarity : "neutral",
        Math.max(1, Math.min(3, Math.round(i.severity ?? 1))), i.label, i.detail, JSON.stringify(allTurns),
        i.quote, hit?.turn ?? null, hit?.start ?? null, hit?.end ?? null, status);
    }
    insCov.run(r.call_id, b.id, "analyzed", null); done.add(r.call_id);
  }
}
for (const id of manifest.callIds) if (!done.has(id)) insCov.run(id, batchOf.get(id), "missing", "no result returned");

const cov = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM coverage GROUP BY status").all().map((r) => [r.status, r.n]));
const meta = { loadedAt: new Date().toISOString(), expectedCalls: manifest.expectedCalls, coverage: cov, evidence: stats };
for (const [k, v] of Object.entries(meta)) db.prepare("INSERT INTO run_meta VALUES (?,?)").run(k, JSON.stringify(v));
db.exec("COMMIT");

// Machine-readable coverage manifest: one row per slice call.
const rows = db.prepare("SELECT call_id, batch_id, status, reason FROM coverage ORDER BY call_id").all();
fs.writeFileSync(path.join(ROOT, "reports/coverage-manifest.json"), JSON.stringify({ ...meta, calls: rows }, null, 2));
console.log(JSON.stringify(meta, null, 2));
const issues = db.prepare("SELECT COUNT(*) n FROM validation_issues").get().n;
console.log(`validation issues: ${issues} (see validation_issues table)`);
if ((cov.analyzed ?? 0) !== manifest.expectedCalls) process.exitCode = 2;
