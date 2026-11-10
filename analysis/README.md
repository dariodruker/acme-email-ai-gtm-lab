# Call analysis pipeline

Turns a set of call transcripts into a SQLite database and a three-level drill-down page: summary, segment, and per-call analysis with highlighted transcript evidence. Built in Class 3 on the 200-call class slice; packaged so it reruns on new data with one command.

## One command

In Claude Code:

```
/analyze-calls analysis/configs/<your-run>.json
```

The skill (`.claude/skills/analyze-calls/SKILL.md`) runs every step below, launches one `call-analyst` subagent per batch in parallel (`.claude/agents/call-analyst.md`, Sonnet), and publishes the page as a new artifact.

## Config

Each run has one config file. `analysis/config.json` is the Class 3 run; `analysis/configs/test-run.json` is the 20-call skill test. For a new run, copy one into `analysis/configs/` and change it.

| Key | Meaning | Class 3 default |
|---|---|---|
| `name` | Run name shown on the page | `ACME Email class slice` |
| `pageTitle` | Artifact title | `ACME Email Call Review` |
| `dataDir` | Folder with `manifest.jsonl`, `accounts.jsonl`, `opportunities.jsonl`, `contacts.jsonl` and transcripts | `data/generated` |
| `sliceFile` | Call IDs to analyze, one per line | `data/class-slice.txt` |
| `outputDir` | Where the database, coverage manifest and page go. One folder per run | `reports` |
| `workDir` | Batches, analyst brief and subagent results | `work/call-analysis` |
| `pageFile` | Page filename inside `outputDir` | `acme-call-insights.html` |
| `batchSize` | Calls per subagent | `20` |
| `hideFromSubagents` | Opportunity fields withheld from subagents, joined back in SQLite | `stage, outcome, competitor, amount, closeDate` |
| `sentimentScale` | `min`, `max` and `labels`. The lower half of `labels` counts as the negative side on the page | `-2` to `2`; negative, mixed, neutral, positive |
| `themes` | `key` and `label` pairs | 16 themes, including `competition` and `other` |
| `themeAliases` | Near-miss theme keys from subagents mapped to a real key, logged in `validation_issues` | `competitive` to `competition` |
| `themesApprovedFor` | The `dataDir` the theme list was approved for. If it differs, the skill proposes themes from a sample and waits for approval | `data/generated` |

## Steps and commands

Every script takes `--config <file>` and defaults to `analysis/config.json`.

| Step | Command | Output |
|---|---|---|
| 1. Inventory | `npm run calls:prepare -- --config CFG --dry-run` | Checks every slice ID and checksum; prints counts. Writes nothing |
| 2. Theme sample (new data) | `npm run calls:sample -- --config CFG` | `workDir/theme-sample.txt` for the theme proposal |
| 3. Prepare | `npm run calls:prepare -- --config CFG` | `workDir/batches/*.txt`, `analyst-brief.md`, `manifest.json` |
| 4. Analyze | One `call-analyst` subagent per batch, in parallel | `workDir/results/batch_NN.json` |
| 5. Load | `npm run calls:load -- --config CFG` | `outputDir/call-analysis.sqlite`, `coverage-manifest.json` |
| 6. Verify | `npm run calls:verify -- --config CFG` | 12 pass/fail checks; non-zero exit on any failure |
| 7. Page | `npm run calls:page -- --config CFG` | `outputDir/<pageFile>` |

## Guarantees

- Every slice call's SHA-256 is checked against `manifest.jsonl` before use, and again in verify.
- Turns are split on any line that starts with `Name (Role):`, so transcripts with blank-line or single-line-break turns both parse. Prepare stops if any call parses into fewer than 4 turns.
- Fields in `hideFromSubagents` never reach subagents. Verify checks the batch files.
- Every insight quote is machine-checked against the transcript: `verified` (in the cited turn), `relocated` (found in another turn, re-pointed) or `unverified` (flagged on the page and failed by verify).
- Every slice call lands in `coverage` as `analyzed`, `failed` or `missing`. `calls:load` exits non-zero unless all are analyzed.
- Load and page refuse to overwrite an existing database, coverage manifest or page. Pass `--overwrite` only to rerun a step for the same run after a failure.
- Speaker side (vendor or customer) comes from matching names to `contacts.jsonl`, since role labels carry transcription noise.

## Rerunning a failed batch

Rerun the subagent for that batch only, then `calls:load -- --config CFG --overwrite`, `calls:verify` and `calls:page`. Other batches' results are kept.

## SQLite tables

`accounts`, `opportunities`, `calls`, `turns`, `call_analysis`, `insights`, `coverage`, `validation_issues`, `run_meta`.

## History

- Class 3 run: tag `class3-original`, page archived at `archive/class3/acme-call-insights.html`.
- `analysis/SUBAGENT_PROMPT.md` is the original subagent prompt, kept for reference. The active version is `.claude/agents/call-analyst.md`.
