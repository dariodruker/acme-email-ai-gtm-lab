---
name: analyze-calls
description: Run the full call-analysis pipeline on a set of call transcripts. Inventory, prepare batches, one call-analyst subagent per batch in parallel, load into SQLite, verify, and build the drill-down page, then publish it as a new artifact. Use when the user asks to analyze calls, rerun the call review, or run the pipeline on new data or a new slice.
argument-hint: "[config path, default analysis/config.json]"
---

# Analyze calls

Runs the pipeline in `analysis/` for one config file. `$ARGUMENTS` is the config path; if empty, ask which config to use and suggest creating a new one under `analysis/configs/` (copy `analysis/config.json`). Below, `CFG` means that path.

Follow `CLAUDE.md`: each run writes to its own `outputDir` under `reports/` and publishes as a new artifact. Never point a run at an existing output folder, never pass `--overwrite` to replace an earlier run's outputs, and never republish an earlier artifact.

## 1. Inventory

1. Read `CFG`. Confirm `outputDir` does not already contain `call-analysis.sqlite`. If it does, stop and ask for a new `outputDir`.
2. If `dataDir` is `data/generated`, run `npm run inventory`.
3. Run `npm run calls:prepare -- --config CFG --dry-run`. It checks every slice ID exists and every checksum matches, and prints counts by segment and call type. Stop on any error and report it.
4. Show the user a short inventory: calls, batches, batch size, hidden fields, output folder.

## 2. Themes (new data only)

If the dry run prints `"themesApproved": false` (the config's `themesApprovedFor` differs from `dataDir`):

1. Run `npm run calls:sample -- --config CFG` and read the sample file it writes.
2. Propose 10-16 themes as `key` (snake_case) and `label` pairs, grounded in what the sample calls discuss. Keep `competition` and `other`. Show the list and the calls that support each theme.
3. **Wait for the user's approval or edits.** Do not continue without it.
4. Write the approved list to `themes` in `CFG` and set `themesApprovedFor` to the `dataDir` value.

If themes are already approved, skip this step.

## 3. Prepare

Run `npm run calls:prepare -- --config CFG`. It writes `batches/batch_NN.txt`, `analyst-brief.md` and `manifest.json` under `workDir`.

## 4. Analyze (parallel)

Read `workDir/manifest.json`. In ONE message, launch one subagent per batch with the Agent tool, all in the background:

- `subagent_type`: `call-analyst` (defined in `.claude/agents/call-analyst.md`, runs on Sonnet).
- Prompt for each:
  ```
  Brief: <abs workDir>/analyst-brief.md
  Batch file: <abs workDir>/batches/<batch_id>.txt
  Result path: <abs workDir>/results/<batch_id>.json
  Batch id: <batch_id>
  Expected calls: <number of callIds in this batch>
  ```

**Fallback:** if `call-analyst` is not an available agent type (for example, the agent file was added after the session started), use `subagent_type: general-purpose` with `model: sonnet`, and start the prompt with "First read /abs/path/.claude/agents/call-analyst.md in full and follow it exactly." Tell the user which way the batches ran.

Wait for every subagent to finish. If a batch has no result file or reports failures, rerun that batch only.

## 5. Load and check

Run `npm run calls:load -- --config CFG`. It fails (non-zero exit) unless every call in the slice is analyzed. On failure, read the `validation_issues` and `coverage` tables, rerun only the failed batches, then rerun load with `--overwrite`. That flag is allowed here only because the database being replaced belongs to this same run.

## 6. Verify

Run `npm run calls:verify -- --config CFG`. All checks must pass: coverage equals the slice, one result file per batch, DB counts match the results, themes and sentiment are within the config, highlight spans match quotes, quotes are found in transcripts, and hidden fields are absent from batches. Stop and report any failure. Do not build the page over failed checks.

## 7. Build and publish

1. Run `npm run calls:page -- --config CFG`.
2. Publish the page file (`outputDir/pageFile`) as a NEW artifact, using the config's `pageTitle` as its name. Never pass the URL of an earlier artifact.
3. Report: the artifact link, calls analyzed out of expected, insight count, quotes verified, verify result, the agent type used, and the output folder.
