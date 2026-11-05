# Call analysis pipeline

Builds the ACME Email call review artifact from the 200 calls in `data/class-slice.txt`.

| Step | Command | Output |
|---|---|---|
| 1. Verify and batch | `npm run calls:prepare` | `work/call-analysis/batches/*.txt` (20 calls each, turn-numbered) and `manifest.json` |
| 2. Analyze | One Claude Sonnet subagent per batch, following `analysis/SUBAGENT_PROMPT.md` | `work/call-analysis/results/batch_NN.json` |
| 3. Validate and load | `npm run calls:load` | `reports/call-analysis.sqlite`, `reports/coverage-manifest.json` |
| 4. Build page | `npm run calls:page` | `reports/acme-call-insights.html` |

## Guarantees

- Every slice call's SHA-256 is checked against `manifest.jsonl` before use.
- CRM stage, outcome and competitor are withheld from subagents and joined in SQLite afterward, so sentiment is read from the transcript alone.
- Every insight quote is machine-checked against the transcript. Status is `verified` (in the cited turn), `relocated` (found in another turn, re-pointed) or `unverified` (flagged on the page).
- Every slice call lands in the `coverage` table as `analyzed`, `failed` or `missing`. `calls:load` exits non-zero unless all 200 are analyzed.
- Speaker side (ACME or customer) comes from matching names to CRM contacts, since role labels contain transcription noise.

## Rerunning a failed batch

Rerun the subagent for that batch only, then rerun `calls:load` and `calls:page`. Other batches' results are kept.

## SQLite tables

`accounts`, `opportunities`, `calls`, `turns`, `call_analysis`, `insights`, `coverage`, `validation_issues`, `run_meta`.
