// Shared helpers for the call-analysis pipeline. Every path and setting comes from a config file.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const DEFAULT_CONFIG = "analysis/config.json";

export const readJsonl = (f) =>
  fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export const hasFlag = (name) => process.argv.includes(name);
export function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Load the config named by --config (default analysis/config.json) and resolve its paths.
export function loadConfig() {
  const rel = argValue("--config") ?? DEFAULT_CONFIG;
  const file = path.resolve(ROOT, rel);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const required = ["dataDir", "sliceFile", "outputDir", "workDir", "batchSize", "themes", "sentimentScale"];
  for (const k of required) if (cfg[k] == null) throw new Error(`${rel} is missing "${k}"`);
  const abs = (p) => path.resolve(ROOT, p);
  return {
    ...cfg,
    configFile: path.relative(ROOT, file),
    themeKeys: cfg.themes.map((t) => t.key),
    paths: {
      data: abs(cfg.dataDir),
      slice: abs(cfg.sliceFile),
      out: abs(cfg.outputDir),
      work: abs(cfg.workDir),
      db: path.join(abs(cfg.outputDir), "call-analysis.sqlite"),
      coverage: path.join(abs(cfg.outputDir), "coverage-manifest.json"),
      page: path.join(abs(cfg.outputDir), cfg.pageFile ?? "acme-call-insights.html"),
    },
  };
}

// Refuse to replace an earlier output unless --overwrite is passed.
export function guardOverwrite(file) {
  if (fs.existsSync(file) && !hasFlag("--overwrite")) {
    console.error(`Refusing to overwrite ${path.relative(ROOT, file)}. Point outputDir at a new folder, or pass --overwrite.`);
    process.exit(3);
  }
}

export function sliceIds(cfg) {
  return fs.readFileSync(cfg.paths.slice, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
}

// A transcript is a sequence of "Name (Role): text" turns. Turns may be separated by blank lines or by
// single line breaks (some transcripts use each format), so a new turn starts at any line with a speaker prefix.
const SPEAKER = /^([^:(\n]+?)\s*\(([^)]+)\):\s*([\s\S]*)$/;
export function parseTurns(text) {
  const blocks = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) { if (blocks.length) blocks[blocks.length - 1].push(""); continue; }
    if (SPEAKER.test(line.trim()) || !blocks.length) blocks.push([line]);
    else blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => b.join("\n").trim()).filter(Boolean).map((p, i) => {
    const m = p.match(SPEAKER);
    return m
      ? { turn: i + 1, speaker: m[1].trim(), role: m[2].trim(), text: m[3].trim() }
      : { turn: i + 1, speaker: "Unknown", role: "Unknown", text: p };
  });
}

// Read the slice, verify each transcript checksum, and join account and opportunity records.
export function loadCorpus(cfg) {
  const ids = sliceIds(cfg);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate IDs in slice file");
  const d = cfg.paths.data;
  const manifest = new Map(readJsonl(path.join(d, "manifest.jsonl")).map((r) => [r.id, r]));
  const accounts = new Map(readJsonl(path.join(d, "accounts.jsonl")).map((r) => [r.id, r]));
  const opps = new Map(readJsonl(path.join(d, "opportunities.jsonl")).map((r) => [r.id, r]));
  return ids.map((id) => {
    const m = manifest.get(id);
    if (!m) throw new Error(`${id} is in the slice file but not in manifest.jsonl`);
    const buf = fs.readFileSync(path.join(d, m.path));
    if (m.sha256 && sha256(buf) !== m.sha256) throw new Error(`${id} checksum mismatch`);
    return { ...m, account: accounts.get(m.accountId), opportunity: opps.get(m.opportunityId),
      turns: parseTurns(buf.toString("utf8")) };
  });
}
