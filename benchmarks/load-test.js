/**
 * FlagForge data-plane load test (k6).
 * ────────────────────────────────────────────────────────────────────────────
 * Compares the hot read path against a direct-PostgreSQL baseline so the value
 * of the two-tier cache is measurable, not asserted.
 *
 *   MODE=cached  → POST /v1/evaluate        (L1 → L2 → DB, warm after first call)
 *   MODE=direct  → GET  /api/environments/:id/flags  (control-plane DB read, no cache)
 *
 * Usage
 *   k6 run benchmarks/load-test.js
 *   k6 run -e RATE=2000 -e DURATION=60s benchmarks/load-test.js
 *   k6 run -e MODE=direct benchmarks/load-test.js
 *
 * Notable env vars
 *   BASE_URL   (default http://localhost:8080)
 *   SDK_KEY    (default the public demo prod key)
 *   MODE       cached | direct        (default cached)
 *   RATE       requests/second        (default 500)
 *   DURATION   k6 duration string     (default 30s)
 *   PRE_VUS    pre-allocated VUs      (default 50)
 *   MAX_VUS    max VUs                (default 500)
 *   FLAG_KEY   flag to evaluate       (default new-checkout-flow)
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const SDK_KEY = __ENV.SDK_KEY || 'ff_live_demo_7f3a91c4e8b25d60';
const MODE = (__ENV.MODE || 'cached').toLowerCase() === 'direct' ? 'direct' : 'cached';
const RATE = Number(__ENV.RATE || 500);
const DURATION = __ENV.DURATION || '30s';
const PRE_VUS = Number(__ENV.PRE_VUS || 50);
const MAX_VUS = Number(__ENV.MAX_VUS || 500);
const FLAG_KEY = __ENV.FLAG_KEY || 'new-checkout-flow';

// ── Custom metrics ──────────────────────────────────────────────────────────
const cacheL1 = new Counter('flag_cache_l1_hit');
const cacheL2 = new Counter('flag_cache_l2_hit');
const cacheDb = new Counter('flag_cache_db_fallback');
const serverEvalMs = new Trend('server_eval_ms', true);
const missingFlag = new Counter('flag_missing');

// ── A stable synthetic user population ──────────────────────────────────────
const PLANS = ['free', 'pro', 'enterprise'];
const COUNTRIES = ['US', 'IN', 'DE', 'GB', 'BR', 'JP', 'CA', 'AU', 'FR', 'SG'];
const VERSIONS = ['1.9.0', '2.0.0', '2.4.0', '2.4.1', '2.5.0', '3.0.0-beta.1'];
const EMAIL_DOMAINS = ['acme.io', 'gmail.com', 'outlook.com', 'flagforge.dev', 'proton.me'];

function userFor(iteration) {
  const n = iteration % 100_000;
  return {
    userId: `bench_user_${n}`,
    attributes: {
      plan: PLANS[n % PLANS.length],
      country: COUNTRIES[n % COUNTRIES.length],
      appVersion: VERSIONS[n % VERSIONS.length],
      betaOptIn: n % 3 === 0,
      emailDomain: EMAIL_DOMAINS[n % EMAIL_DOMAINS.length],
      seats: (n % 50) + 1,
    },
  };
}

// ── k6 options ──────────────────────────────────────────────────────────────
export const options = {
  discardResponseBodies: false,
  scenarios: {
    hot_path: {
      executor: 'constant-arrival-rate',
      exec: 'hotPath',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // Cached reads must stay sub-millisecond-ish at the server and tight end to
    // end; the direct-PostgreSQL baseline is expected to be materially slower.
    http_req_failed: ['rate<0.01'],
    http_req_duration:
      MODE === 'cached'
        ? ['p(95)<25', 'p(99)<75', 'avg<8']
        : ['p(95)<80', 'p(99)<200', 'avg<25'],
    checks: ['rate>0.99'],
  },
};

// ── setup: warm the cache / resolve the environment id for the DB baseline ──
export function setup() {
  if (MODE === 'direct') {
    const res = http.get(`${BASE_URL}/api/sandbox`);
    if (res.status !== 200) {
      throw new Error(`sandbox bootstrap failed with HTTP ${res.status}`);
    }
    const body = res.json();
    const prod =
      (body.environments || []).find((environment) => environment.name === 'prod') ||
      (body.environments || [])[0];
    if (!prod) throw new Error('no environments returned by /api/sandbox');
    return { environmentId: prod.id };
  }

  // Warm both cache tiers once so the measured run is a pure warm-path test.
  const warm = http.post(
    `${BASE_URL}/v1/evaluate`,
    JSON.stringify({ userId: 'bench_warmup', attributes: { plan: 'pro' } }),
    { headers: { 'content-type': 'application/json', 'x-sdk-key': SDK_KEY } },
  );
  if (warm.status !== 200) {
    throw new Error(
      `warm-up evaluate failed with HTTP ${warm.status} — is the API seeded and reachable at ${BASE_URL}?`,
    );
  }
  return { environmentId: null };
}

// ── the measured request ────────────────────────────────────────────────────
export function hotPath(data) {
  if (MODE === 'direct') {
    const res = http.get(`${BASE_URL}/api/environments/${data.environmentId}/flags`, {
      tags: { endpoint: 'control-plane-db' },
    });
    check(res, {
      'status is 200': (r) => r.status === 200,
      'returns flags': (r) => {
        try {
          return Array.isArray(r.json('flags')) && r.json('flags').length > 0;
        } catch (_e) {
          return false;
        }
      },
    });
    return;
  }

  const user = userFor(__ITER);
  const res = http.post(
    `${BASE_URL}/v1/evaluate`,
    JSON.stringify({ userId: user.userId, attributes: user.attributes, key: FLAG_KEY }),
    {
      headers: { 'content-type': 'application/json', 'x-sdk-key': SDK_KEY },
      tags: { endpoint: 'data-plane-evaluate' },
    },
  );

  const cacheStatus = res.headers['X-Cache-Status'] || res.headers['x-cache-status'];
  if (cacheStatus === 'L1-HIT') cacheL1.add(1);
  else if (cacheStatus === 'L2-HIT') cacheL2.add(1);
  else if (cacheStatus === 'DB-FALLBACK') cacheDb.add(1);

  const evalMs = Number(res.headers['X-Eval-Time-Ms'] || res.headers['x-eval-time-ms']);
  if (Number.isFinite(evalMs)) serverEvalMs.add(evalMs);

  if (res.status === 404) missingFlag.add(1);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'served from cache': () => cacheStatus === 'L1-HIT' || cacheStatus === 'L2-HIT',
    'has a resolution reason': (r) => {
      try {
        return typeof r.json('reason') === 'string';
      } catch (_e) {
        return false;
      }
    },
  });
}

// ── compact text summary ────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;
  const pick = (name, key) => (m[name] && m[name].values && m[name].values[key] !== undefined
    ? m[name].values[key]
    : 0);
  const counts = (name) => pick(name, 'count');

  const totalSamples =
    counts('flag_cache_l1_hit') + counts('flag_cache_l2_hit') + counts('flag_cache_db_fallback');
  const pct = (part) => (totalSamples === 0 ? 0 : (part / totalSamples) * 100).toFixed(1);

  const failedPct = (pick('http_req_failed', 'rate') * 100).toFixed(2);
  const lines = [
    '',
    `FlagForge load test — mode=${MODE} rate=${RATE}/s duration=${DURATION}`,
    '─'.repeat(64),
    `requests           : ${counts('http_reqs')}  (${failedPct}% failed)`,
    `latency avg/p95/p99: ${pick('http_req_duration', 'avg').toFixed(2)}ms / ${pick('http_req_duration', 'p(95)').toFixed(2)}ms / ${pick('http_req_duration', 'p(99)').toFixed(2)}ms`,
  ];

  if (MODE === 'cached') {
    lines.push(
      `cache mix          : L1 ${pct(counts('flag_cache_l1_hit'))}% · L2 ${pct(counts('flag_cache_l2_hit'))}% · DB ${pct(counts('flag_cache_db_fallback'))}%`,
      `server eval time   : avg ${pick('server_eval_ms', 'avg').toFixed(3)}ms · p95 ${pick('server_eval_ms', 'p(95)').toFixed(3)}ms`,
    );
  }
  lines.push('─'.repeat(64), '');
  return { stdout: lines.join('\n') + '\n' };
}
