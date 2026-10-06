# Experiment matrix (portal coordination)

## Research claim (one sentence)

Under lossy and delayed push delivery, a version-aware portal design that combines push events, offline-only conditional verification, and periodic snapshot reconciliation matches polling on final-state correctness and uses fewer API requests than 60-second polling, while trading longer incorrectly-enabled windows for that request saving; version/generation guards are necessary (mutation counterexamples).

## Designs (independent variable)

| ID | Mechanism |
|---|---|
| `push_only` | Status push only; monotonic version accept; no polling |
| `polling_60` | Status poll every 60s; no push |
| `polling_300` | Status poll every 300s; no push (cost-matched reconcile baseline) |
| `proposed` | Push + offline-only verify every 60s after completion + catalog reconcile every 300s |

All designs share monotonic version acceptance and non-overlapping in-flight requests.

## Workloads

1. **Directed faults** (oracle-checked): missed outage, duplicate outage, stale/delayed observations, missed recovery, planned maintenance.
2. **Seeded sensitivity** (seeds 1–100): 10 alternating offline/available transitions; independent 20% push omission; delay U{1…180}s; 20% duplicate delivery. Identical inputs across designs.

## Metrics

- `incorrectly_enabled_s` — display AVAILABLE while truth is not
- `incorrectly_disabled_s` — display not AVAILABLE while truth is AVAILABLE
- `status_mismatch_s` — any display≠truth time
- `requests` — HTTP-like client calls (verify + poll/catalog)
- `final_correct` — display equals truth at horizon
- Summary reports mean, std, and p50 over 100 seeds

## What this does / does not show

Shows a **request-versus-staleness Pareto trade-off** in a discrete-event model.  
Does **not** show production latency, multi-tab browser throttling, or enterprise scale.

## Run

```sh
node run.mjs
```

Outputs: `results.csv`, `summary.json`, `traces.json`, stdout JSON.

## Next extensions (optional, not required for current claim)

| Extension | Why |
|---|---|
| Multi-app (n=5,20) with shared push channel | Request scaling |
| Tab throttle (pause timers 0–300s) | Browser realism |
| Snapshot-only (reconcile 300, no verify) | Ablation of conditional verify |
| Open prototype with real service worker | Implementation evidence |
