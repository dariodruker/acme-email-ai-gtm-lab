// Step 4: independent checks on a loaded run. Exits non-zero if any check fails.
//   node analysis/verify.mjs [--config <file>]
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig, loadCorpus } from "./lib.mjs";

const cfg = loadConfig();
const db = new DatabaseSync(cfg.paths.db, { readOnly: true });
const manifest = JSON.parse(fs.readFileSync(path.join(cfg.paths.work, "manifest.json"), "utf8"));
const corpus = new Map(loadCorpus(cfg).map((c) => [c.id, c])); // re-verifies slice checksums
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

// 1. Coverage equals the slice, every call analyzed.
const slice = [...corpus.keys()];
const cov = new Map(all("SELECT call_id, status FROM coverage").map((r) => [r.call_id, r.status]));
const notAnalyzed = slice.filter((id) => cov.get(id) !== "analyzed");
const extra = [...cov.keys()].filter((id) => !corpus.has(id));
check("every slice call analyzed", notAnalyzed.length === 0, `${slice.length - notAnalyzed.length}/${slice.length}${notAnalyzed.length ? `; missing ${notAnalyzed.slice(0, 5).join(", ")}` : ""}`);
check("no calls outside the slice", extra.length === 0, extra.slice(0, 5).join(", "));
check("one analysis row per call", one("SELECT COUNT(*) n FROM call_analysis").n === slice.length, `${one("SELECT COUNT(*) n FROM call_analysis").n} rows`);

// 2. Every batch produced a result file, and the DB matches the result files.
const files = manifest.batches.map((b) => path.join(cfg.paths.work, b.result));
const present = files.filter((f) => fs.existsSync(f));
check("one result file per batch", present.length === manifest.batches.length, `${present.length}/${manifest.batches.length}`);
let resultInsights = 0, resultCalls = 0;
for (const f of present) { const r = JSON.parse(fs.readFileSync(f, "utf8")); resultCalls += r.calls?.length ?? 0; resultInsights += (r.calls ?? []).reduce((n, c) => n + (c.insights?.length ?? 0), 0); }
const dbInsights = one("SELECT COUNT(*) n FROM insights").n;
check("result calls equal slice size", resultCalls === slice.length, `${resultCalls} in results`);
check("DB insight count matches results", dbInsights === resultInsights, `${dbInsights} in DB, ${resultInsights} in results`);

// 3. Insights point at real calls, real turns and config themes.
const themes = new Set(cfg.themeKeys);
check("all insight themes in config", one(`SELECT COUNT(*) n FROM insights WHERE theme NOT IN (${cfg.themeKeys.map(() => "?").join(",")})`, ...cfg.themeKeys).n === 0);
check("no orphan insights", one("SELECT COUNT(*) n FROM insights i LEFT JOIN calls c ON c.id = i.call_id WHERE c.id IS NULL").n === 0);
const { min, max, labels } = cfg.sentimentScale;
check("sentiment within scale", one(`SELECT COUNT(*) n FROM call_analysis WHERE sentiment_score < ? OR sentiment_score > ? OR sentiment NOT IN (${labels.map(() => "?").join(",")})`, min, max, ...labels).n === 0, `${min} to ${max}`);

// 4. Highlight offsets land on the quoted text.
const norm = (s) => s.replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
let badSpan = 0, located = 0;
for (const i of all("SELECT call_id, quote, quote_turn, quote_start, quote_end FROM insights WHERE quote_turn IS NOT NULL")) {
  located++;
  const t = corpus.get(i.call_id)?.turns[i.quote_turn - 1];
  const span = t ? norm(t.text.slice(i.quote_start, i.quote_end)) : "";
  if (!span || !norm(i.quote).includes(span.replace(/^["'.… ]+|["'.… ]+$/g, ""))) badSpan++;
}
check("highlight spans match quotes", badSpan === 0, `${located - badSpan}/${located} spans`);
const unverified = one("SELECT COUNT(*) n FROM insights WHERE evidence_status = 'unverified'").n;
check("quotes found in transcripts", unverified === 0, `${dbInsights - unverified}/${dbInsights} verified or relocated`);

// 5. Hidden outcome fields never reached the subagents.
const hidden = cfg.hideFromSubagents ?? [];
const leaks = manifest.batches.filter((b) => {
  const txt = fs.readFileSync(path.join(cfg.paths.work, b.file), "utf8");
  return hidden.some((k) => new RegExp(`\\b${k}: `).test(txt.split("\n").filter((l) => l.startsWith("opportunity:")).join("\n")));
});
check("hidden fields absent from batches", leaks.length === 0, hidden.join(", "));

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
