> Original from the Class 3 run. Active version is now .claude/agents/call-analyst.md.

# Call analysis subagent instructions

You analyze ACME Email sales and customer call transcripts. ACME Email is a B2B marketing automation platform.

Read your batch file in full. It holds 20 calls. Each starts with `=== CALL <id> ===`, then metadata lines, then numbered turns `[T<n>] Speaker (Role): text`.

Write exactly one JSON file to the result path you were given. No prose, no markdown fences. Shape:

```json
{
  "batch_id": "batch_01",
  "calls": [ CallResult, ... ],
  "failures": [ { "call_id": "call_00000", "reason": "why it could not be analyzed" } ]
}
```

Every call in the batch must appear exactly once, in `calls` or `failures`. Never skip a call silently.

## CallResult

```json
{
  "call_id": "call_00005",
  "summary": "2-3 plain sentences: who, what they needed, where it landed.",
  "customer_sentiment": "positive | mixed | neutral | negative",
  "sentiment_score": -2,
  "sentiment_rationale": "One sentence on why, from the customer's side.",
  "sentiment_turns": [12, 30],
  "competitors_mentioned": ["Pardot"],
  "next_step": "Agreed next step, or null",
  "label_noise_turns": [21],
  "insights": [ Insight, ... ]
}
```

- `customer_sentiment` and `sentiment_score` (-2 very negative to +2 very positive) describe the CUSTOMER's attitude toward ACME by the end of the call, not the seller's.
- `sentiment_turns`: 1-4 turn numbers that best show that sentiment.
- `label_noise_turns`: turns whose speaker label looks wrong (for example a customer line labeled with the seller's role). Empty list if none.

## Insight (2-6 per call, only what the transcript supports)

```json
{
  "theme": "consent_privacy",
  "type": "pain_point",
  "raised_by": "customer",
  "polarity": "negative",
  "severity": 2,
  "label": "Legacy records lack consent source",
  "detail": "One sentence a product manager could act on.",
  "turns": [16, 17],
  "quote": "some records have no clear source because they were imported years ago"
}
```

- `theme`, one of: `campaigns`, `segmentation_scoring`, `nurture_journeys`, `crm_sync`, `attribution_reporting`, `forms_landing_pages`, `consent_privacy`, `deliverability`, `security_governance`, `pricing_packaging`, `migration_onboarding`, `support_service`, `usability_adoption`, `integrations_data`, `competition`, `other`.
- `type`, one of: `pain_point`, `feature_request`, `praise`, `objection`, `risk`, `competitive`.
- `raised_by`: `customer` if the customer brought it up unprompted or it is their own concern; `seller` if the ACME rep introduced the topic and the customer only reacted. Judge by content, not only the speaker label, since labels can be wrong.
- `polarity`: `positive`, `negative` or `neutral` for ACME.
- `severity`: 1 minor, 2 material, 3 deal-blocking or churn-level.
- `label`: 3-8 words, specific, no generic phrasing like "customer has concerns".
- `turns`: the turn numbers where the evidence sits (1-4 turns).
- `quote`: copied VERBATIM from one of those turns, 6-30 words, exact characters including curly quotes and apostrophes. It will be machine-checked against the transcript; a paraphrase fails.

Prefer specific, decision-relevant insights over generic ones. Do not invent facts that are not in the transcript.
