# Portal coordination simulation

Run from this directory with Node.js 24 (no dependencies):

```sh
node run.mjs
```

The command executes 15 directed comparisons and 300 paired seeded comparisons, checks directed timing oracles and duplicate-message controls, and writes results.csv, summary.json, traces.json. Output files are deterministic for the same source and Node version; summary.json records the runtime. Virtual seconds do not measure CPU runtime or browser latency.

# Experimental design and interpretation

A discrete-event JavaScript simulator was executed under Node.js v24.19.0. It compares push only, polling only every 60 seconds, and the proposed push/conditional-verification design with 300-second catalog reconciliation. All designs share monotonic version acceptance and non-overlapping requests; the baselines are not deliberately deprived of stale-update safeguards. The experiment models one authorized application over 1,800 virtual seconds. Initial state is synchronized AVAILABLE; initial-load requests are excluded. Healthy requests return the status captured at request start after two seconds. Verification waits 60 seconds after completion. A request started at the horizon is counted even when its response falls outside observation.

Five directed traces cover missed outage, duplicate outage, delayed observations, missed recovery, and planned maintenance. For an outage at second 100 whose push is lost, incorrectly enabled duration is 600 seconds for push only, 22 for polling only, and 202 for the proposal; the latter waits for its first catalog reconciliation. For recovery at second 400 whose push is lost, incorrectly disabled duration is 1,400, 22, and 11 seconds respectively. Duplicate outage messages do not increase proposed request counts relative to a single-message control. Delayed lower-version pushes are rejected; a polling response can still temporarily reflect an old authoritative state before a newer version has been learned. Planned maintenance triggers zero proposed per-application verification requests, while six catalog requests remain.

A paired sensitivity workload uses seeds 1–100, ten alternating offline/available transitions at seconds 100 + 140*i (i=0–9), independent 20% push omission, uniform integer push delay of 1–180 seconds, and 20% two-copy delivery. Each seed supplies identical input to all designs. Polling schedules remain fixed; these runs explore push-channel variation, not general network uncertainty. Table 5 reports arithmetic means from the executed runs. Incorrectly enabled/disabled durations integrate disagreement with authoritative state, not actual failed navigation or user impact.

**Table 5. Synthetic comparison: means over 100 paired traces.**

| Design | Requests | Incorrectly enabled (s) | Incorrectly disabled (s) | Correct final state (runs) |
|---|---:|---:|---:|---:|
| Push only | 0.00 | 383.57 | 460.73 | 80/100 |
| Polling only | 30.00 | 130.00 | 90.00 | 100/100 |
| Proposed | 11.48 | 461.63 | 139.44 | 100/100 |

The proposal uses fewer API requests but has longer mismatch duration than one-minute polling under this workload. It repairs persistent missed delivery without establishing universal superiority. Calls are counted without payload bytes or server cost; catalog and status calls are not equivalent traffic units. Push acknowledgments/retries, backend detection delay, browser throttling, request failures, access changes, and multiple applications are excluded. This is simulation evidence, not production measurement. Source, CSV, directed traces, assumptions, and hand-checkable assertions accompany the paper; two runs reproduced identical result bytes.


Additional semantics: the queue breaks equal-time ties by insertion order. Request completion precedes subsequently queued ticks when inserted earlier. Push duplicates are spaced one second apart. Per-design fetches capture the current authoritative state at initiation. The stale-observations trace delays the first outage push to second 800 and one polling request at second 120 by 300 seconds. There is no background concurrency within a client; occupied ticks retry one virtual second later. Reconciliation and verification are both counted even if adjacent rather than coalesced. Model-state loop uniqueness is separately checked by the bounded model explorer; this simulator implements one generation-controlled chain rather than proving timer uniqueness. Final correctness can coexist with an outage never being observed. Unobserved transitions count versions never displayed, including superseded intermediate states. Maximum observed convergence excludes those transitions and must not be interpreted alone as recovery performance.

Random generator: unsigned 32-bit LCG, multiplier 1664525, increment 1013904223, seed 1–100. For each transition, draws determine omission, delay, then duplication, even for omitted pushes. Seeded configurations use successful two-second requests only. No retry protocol is simulated.
