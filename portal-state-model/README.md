# Portal coordination: bounded state exploration

Run with Node.js 18+ (validated here with Node.js v24.18.0):

    node model-check.mjs

No packages or network services are required. The program overwrites results.json beside the script. Exit code 0 requires the corrected model and five scenarios to pass and each deliberately flawed variant to fail.

## Model and method

Breadth-first search starts from an authorized available application, incarnation A, status version 1, catalog revision 1. It applies a fixed alphabet of 100 actions, deduplicating complete states and expanding each reachable state at its shortest depth, through six transitions. This covers reachable-state safety within the bound; it does not enumerate every distinct event history.

Domains: one application, two incarnations (A/B), status versions 1–3, catalog revisions 1–2, four statuses (available/maintenance/offline/unknown), at most one context change, and one pending verification request. Timer generation remains finite under the exploration depth. Actions include push, response, snapshot, begin verification, and context change. No-op/invalid inputs count as examined transitions. Catalog snapshots in the action alphabet are current-context responses; delayed old-context catalog responses are not modeled. Transport failure and timing are abstracted as absent actions.

Safety checks: at most one timer; timers only for present offline entries; version does not decrease within an incarnation and context; push cannot recreate absent membership; obsolete verification generation cannot change status/version; stale/equal-version push cannot change status/version.

Mutation tests remove version ordering, introduce timers on duplicate outage events, recreate absent entries on push, and remove request-generation checks. Each saves its shortest discovered counterexample. Some mutation inputs intentionally violate authoritative payload consistency to check defensive rejection.

Five directed scenarios address snapshot repair after a lost outage, maintenance versus a pending response, old-incarnation delivery, recovery cancellation, and context invalidation. They are examples, not a liveness proof.

## Actual output from this run

Corrected model: 1,465 unique states; 971 expanded states; 97,100 examined transitions; depth bound 6; no checked safety violation. Four flawed variants failed. Five directed scenarios passed. Consult results.json for exact traces and counts.

## Limits

This is a custom bounded JavaScript transition explorer, not a verified model-checking tool. Model construction and invariant selection can contain errors. It does not prove global correctness, eventual delivery, multi-application or multi-tab behavior, fairness, authorization implementation, timing accuracy, API semantics, or React/service-worker correctness. Generation counters, versions, membership, and request fields are explicit abstractions. Acknowledgment retries and the 15s/30s/2m/4m/10m schedule are not modeled. No performance result or company deployment claim follows from these checks.
