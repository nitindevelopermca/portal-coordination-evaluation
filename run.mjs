import fs from 'node:fs';
import assert from 'node:assert/strict';

const H = 1800;
/** @typedef {'push_only'|'polling_60'|'polling_300'|'proposed'} Design */
const designs = /** @type {Design[]} */ ([
  'push_only',
  'polling_60',
  'polling_300',
  'proposed',
]);

const scenarios = [
  {
    name: 'missed_outage',
    changes: [
      { t: 100, s: 'offline', drop: true },
      { t: 700, s: 'available' },
    ],
  },
  {
    name: 'duplicate_outage',
    changes: [
      { t: 100, s: 'offline', copies: 3 },
      { t: 700, s: 'available' },
    ],
  },
  {
    name: 'stale_observations',
    changes: [
      { t: 100, s: 'offline', delay: 700 },
      { t: 200, s: 'available' },
    ],
    slow: true,
  },
  {
    name: 'missed_recovery',
    changes: [
      { t: 100, s: 'offline' },
      { t: 400, s: 'available', drop: true },
    ],
  },
  {
    name: 'planned_maintenance',
    changes: [
      { t: 100, s: 'under_maintenance' },
      { t: 700, s: 'available' },
    ],
  },
];

function simulate(spec, design, seed = 0) {
  let q = [],
    seq = 0,
    now = 0,
    last = 0,
    truth = 'available',
    tv = 1,
    status = 'available',
    v = 1,
    requests = 0,
    pushes = 0,
    rejects = 0,
    unsafe = 0,
    blocked = 0,
    mismatch = 0,
    busy = false,
    generation = 0,
    maxLoops = 0,
    verifyRequests = 0,
    catalogRequests = 0;
  const log = [],
    latencies = [],
    pending = [];
  const usesPush = design === 'push_only' || design === 'proposed';

  function at(t, fn) {
    if (t <= H) q.push({ t, seq: seq++, fn });
  }
  function record(kind) {
    log.push({ time: now, kind, truth, display: status, version: v });
  }
  function update(s, version) {
    if (version < v) {
      rejects++;
      record('stale_rejected');
      return;
    }
    if (version === v) return;
    const old = status;
    status = s;
    v = version;
    record('accepted');
    for (const p of pending)
      if (!p.done && p.version === v) {
        p.done = true;
        latencies.push(now - p.t);
      }
    if (design === 'proposed' && old !== status) {
      generation++;
      if (status === 'offline') {
        maxLoops = 1;
        scheduleVerify(generation);
      }
    }
  }
  function request(kind, gen) {
    if (kind === 'verify' && (gen !== generation || status !== 'offline')) return;
    if (busy) {
      at(now + 1, () => request(kind, gen));
      return;
    }
    requests++;
    if (kind === 'verify') verifyRequests++;
    if (kind === 'catalog' || kind === 'periodic') catalogRequests++;
    busy = true;
    const captured = { s: truth, v: tv };
    const delay = spec.slow && now === 120 ? 300 : 2;
    at(now + delay, () => {
      busy = false;
      if (kind !== 'verify' || gen === generation) update(captured.s, captured.v);
      else {
        rejects++;
        record('obsolete_verification_rejected');
      }
      if (kind === 'verify' && gen === generation && status === 'offline') scheduleVerify(gen);
    });
  }
  function scheduleVerify(gen) {
    at(now + 60, () => request('verify', gen));
  }
  function periodic(period, kind = 'periodic') {
    at(now + period, () => {
      request(kind);
      periodic(period, kind);
    });
  }

  if (design === 'polling_60') periodic(60);
  if (design === 'polling_300') periodic(300);
  if (design === 'proposed') periodic(300, 'catalog');

  for (const c of spec.changes)
    at(c.t, () => {
      truth = c.s;
      tv++;
      const version = tv;
      pending.push({ t: now, version, done: false });
      record('truth_changed');
      if (usesPush && !c.drop)
        for (let i = 0; i < (c.copies ?? 1); i++)
          at(now + (c.delay ?? 1) + i, () => {
            pushes++;
            update(c.s, version);
          });
    });

  at(H, () => record('end'));
  while (q.length) {
    q.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const e = q.shift();
    now = e.t;
    const dt = now - last;
    if (status !== truth) mismatch += dt;
    if (status === 'available' && truth !== 'available') unsafe += dt;
    if (status !== 'available' && truth === 'available') blocked += dt;
    last = now;
    e.fn();
  }

  return {
    result: {
      scenario: spec.name,
      seed,
      design,
      horizon_s: H,
      requests,
      verification_requests: verifyRequests,
      catalog_or_periodic_requests: catalogRequests,
      pushes,
      stale_or_obsolete_rejections: rejects,
      max_verification_loops: maxLoops,
      incorrectly_enabled_s: unsafe,
      incorrectly_disabled_s: blocked,
      status_mismatch_s: mismatch,
      observed_transitions: latencies.length,
      total_transitions: pending.length,
      max_observed_convergence_s: latencies.length ? Math.max(...latencies) : null,
      unobserved_transitions: pending.filter((p) => !p.done).length,
      final_correct: status === truth,
    },
    log,
  };
}

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function mean(a, k) {
  return a.reduce((s, x) => s + x[k], 0) / a.length;
}
function std(a, k) {
  const m = mean(a, k);
  return Math.sqrt(a.reduce((s, x) => s + (x[k] - m) ** 2, 0) / a.length);
}
function percentile(a, k, p) {
  const vals = a.map((x) => x[k]).sort((x, y) => x - y);
  const i = Math.min(vals.length - 1, Math.max(0, Math.ceil((p / 100) * vals.length) - 1));
  return vals[i];
}

const rows = [],
  traces = {};
for (const s of scenarios)
  for (const d of designs) {
    const { result, log } = simulate(s, d);
    rows.push(result);
    traces[s.name + '/' + d] = log;
  }

for (let seed = 1; seed <= 100; seed++) {
  const r = rng(seed),
    changes = [];
  for (let i = 0; i < 10; i++)
    changes.push({
      t: 100 + i * 140,
      s: i % 2 ? 'available' : 'offline',
      drop: r() < 0.2,
      delay: 1 + Math.floor(r() * 180),
      copies: r() < 0.2 ? 2 : 1,
    });
  for (const d of designs)
    rows.push(simulate({ name: 'seeded_loss_delay', changes }, d, seed).result);
}

const get = (s, d) => rows.find((x) => x.scenario === s && x.design === d && x.seed === 0);

// Directed oracles (backward-compatible names: polling_only == polling_60)
assert.equal(get('missed_outage', 'push_only').incorrectly_enabled_s, 600);
assert.equal(get('missed_outage', 'polling_60').incorrectly_enabled_s, 22);
assert.equal(get('missed_outage', 'proposed').incorrectly_enabled_s, 202);
assert.equal(get('missed_recovery', 'proposed').incorrectly_disabled_s, 11);
assert.equal(get('planned_maintenance', 'proposed').verification_requests, 0);
assert.equal(get('duplicate_outage', 'proposed').max_verification_loops, 1);
for (const row of rows) assert.ok(row.max_verification_loops <= 1);

const single = simulate(
  { name: 'single_outage', changes: [{ t: 100, s: 'offline' }, { t: 700, s: 'available' }] },
  'proposed',
).result;
assert.equal(single.requests, get('duplicate_outage', 'proposed').requests);
assert.equal(single.status_mismatch_s, get('duplicate_outage', 'proposed').status_mismatch_s);
assert.ok(get('stale_observations', 'proposed').stale_or_obsolete_rejections >= 1);

const keys = Object.keys(rows[0]);
fs.writeFileSync(
  'results.csv',
  keys.join(',') +
    '\n' +
    rows.map((r) => keys.map((k) => r[k] ?? '').join(',')).join('\n') +
    '\n',
);
fs.writeFileSync('traces.json', JSON.stringify(traces, null, 2));

const summary = designs.map((design) => {
  const a = rows.filter((x) => x.design === design && x.seed > 0);
  return {
    design,
    runs: a.length,
    mean_requests: +mean(a, 'requests').toFixed(2),
    std_requests: +std(a, 'requests').toFixed(2),
    p50_requests: percentile(a, 'requests', 50),
    mean_incorrectly_enabled_s: +mean(a, 'incorrectly_enabled_s').toFixed(2),
    std_incorrectly_enabled_s: +std(a, 'incorrectly_enabled_s').toFixed(2),
    p50_incorrectly_enabled_s: percentile(a, 'incorrectly_enabled_s', 50),
    mean_incorrectly_disabled_s: +mean(a, 'incorrectly_disabled_s').toFixed(2),
    std_incorrectly_disabled_s: +std(a, 'incorrectly_disabled_s').toFixed(2),
    p50_incorrectly_disabled_s: percentile(a, 'incorrectly_disabled_s', 50),
    mean_status_mismatch_s: +mean(a, 'status_mismatch_s').toFixed(2),
    mean_unobserved_transitions: +mean(a, 'unobserved_transitions').toFixed(2),
    final_correct_runs: a.filter((x) => x.final_correct).length,
  };
});

const by = Object.fromEntries(summary.map((s) => [s.design, s]));
const tradeoff = {
  claim:
    'Under lossy/delayed push delivery, proposed keeps final correctness at 100/100 like polling while using fewer requests than polling_60; incorrectly-enabled time is worse than continuous polling and can exceed push-only because reconciliation delay dominates missed outages.',
  vs_polling_60: {
    request_ratio: +(by.proposed.mean_requests / by.polling_60.mean_requests).toFixed(3),
    incorrectly_enabled_ratio: +(
      by.proposed.mean_incorrectly_enabled_s / by.polling_60.mean_incorrectly_enabled_s
    ).toFixed(3),
    incorrectly_disabled_ratio: +(
      by.proposed.mean_incorrectly_disabled_s / by.polling_60.mean_incorrectly_disabled_s
    ).toFixed(3),
  },
  vs_polling_300: {
    request_ratio: +(by.proposed.mean_requests / by.polling_300.mean_requests).toFixed(3),
    incorrectly_enabled_ratio: +(
      by.proposed.mean_incorrectly_enabled_s / by.polling_300.mean_incorrectly_enabled_s
    ).toFixed(3),
    incorrectly_disabled_ratio: +(
      by.proposed.mean_incorrectly_disabled_s / by.polling_300.mean_incorrectly_disabled_s
    ).toFixed(3),
  },
  vs_push_only: {
    final_correct_delta:
      by.proposed.final_correct_runs - by.push_only.final_correct_runs,
    incorrectly_disabled_ratio: +(
      by.proposed.mean_incorrectly_disabled_s / by.push_only.mean_incorrectly_disabled_s
    ).toFixed(3),
  },
};

fs.writeFileSync(
  'summary.json',
  JSON.stringify({ node: process.version, rows: rows.length, summary, tradeoff }, null, 2),
);
console.log(JSON.stringify({ directed: rows.filter((x) => x.seed === 0), summary, tradeoff }, null, 2));
