# Status: what FlagForge is, what works, and how it compares to LaunchDarkly

**Written to be honest rather than flattering.** Where something is unverified,
it says so.

---

## 1. What it is, in one paragraph

FlagForge is a self-hosted **feature flag service**. An application asks it
"should this user see this feature?", and it answers in well under a millisecond
from memory, with per-user targeting, percentage rollouts that stay sticky, an
audit trail for every change, and live push updates so apps react to a flag flip
without redeploying. It ships as four packages in a monorepo: a pure rule engine,
a TypeScript SDK, a Fastify API, and a Next.js dashboard.

Scale of the codebase: ~13,000 lines, 4 packages, 3 database migrations,
~122 automated tests.

---

## 2. What is built

### `@flagforge/evaluator` — the rule engine (zero dependencies)

- MurmurHash3 (x86, 32-bit) implemented from the algorithm, verified against
  canonical test vectors
- SemVer 2.0 precedence (numeric identifiers, pre-release ordering, build
  metadata ignored)
- 10 operators: `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`,
  `semver_gte`, `semver_lt`
- Strict precedence: kill switch → block list → allow list → ordered rules
  (AND/OR) → percentage rollout → default value
- Sticky bucketing: `hash(flagKey:userId) % 100`, so the salt is per flag and a
  user never moves buckets

### `@flagforge/sdk` — client library

- Dependency-free core; bootstrap via one batch call, then live Server-Sent
  Events
- Typed getters with fallbacks (`get(key, false)`), `subscribe` / `onChange`
- Optional React bindings (`FlagForgeProvider`, `useFlag`, `useFlags`)
- Injectable `fetch` and `EventSource` for testing and non-browser runtimes

### `@flagforge/api` — Fastify server

**Control plane (`/api/*`)** — authenticated:

- Accounts: `signup`, `login`, `demo` (one-click), `logout`, `me`
  — scrypt password hashing, HMAC-signed stateless bearer sessions
- Multi-tenancy: `users` + `projects.owner_id`; every query scoped to the owner,
  cross-tenant ids return **404** (not 403) so existence isn't leaked
- Projects (auto-provision `development` + `production` with real SDK keys
  returned once), environments, flag CRUD, SDK key rotation with a 24-hour grace
  window, audit logs, playground evaluation, `/metrics`
- AI rule compiler: OpenAI-compatible LLM call, **strict Zod validation of the
  output**, graceful deterministic regex fallback, and a 1,000-user deterministic
  blast-radius simulation ("Approve & apply" is a separate human action)

**Data plane (`/v1/*`)** — authenticated by SDK key only:

- `POST /evaluate`, `POST /evaluate/batch`, `GET /config`, `GET /stream` (SSE)
- Response headers expose `X-Cache-Status` (`L1-HIT` / `L2-HIT` / `DB-FALLBACK`)
  and `X-Eval-Time-Ms`

**Infrastructure behaviours:**

- Two-tier cache: in-process L1 `Map` → Redis L2 JSON → PostgreSQL on cold miss
  only. Cache population and Pub/Sub publish happen **after commit**, and L1 is
  purged before publishing
- Redis Pub/Sub (`flag_invalidation`) so multiple instances stay coherent
- Singleflight so a cold-start stampede costs one query per environment
- Graceful degradation: a Redis outage falls back to L1 + PostgreSQL and the
  process still serves correct results
- Liveness vs readiness split (PostgreSQL required → 503; Redis optional →
  `200 degraded`)
- Prometheus metrics, per-SDK-key and per-IP rate limiting, helmet headers, CORS
  with preflight caching
- Zod validation on every input; bounded AST (≤50 rules, ≤32 conditions, ≤10k
  overrides)

### `@flagforge/web` — dashboard

- Landing page with a live API health probe
- `/login`, `/signup` with a demo button and one-time SDK key reveal
- `/dashboard` — project switcher (+ create project), environment switcher
- `/dashboard/flags` — search, create with slug validation, kill switches,
  slide-over editor with a **visual rule builder**, `{ } View JSON`, AI assistant
  with blast radius, delete with confirmation
- `/dashboard/audit` — human-readable change feed (`enabled: on → off`)
- `/dashboard/keys` — masked prefixes, rotation, one-time reveal, curl / Node /
  React quickstart
- `/dashboard/playground` — pick a flag, set `userId` + attributes, see the real
  value, reason, bucket, cache tier and latency
- `/demo` — a public demo storefront with two versions of several features, a
  **10-account comparison table** and a per-flag decision panel

### Tooling, tests, deployment

- `tools/demo-server.mjs` — in-memory preview harness that reuses the real
  evaluator, compiler and simulator
- `examples/quickstart.mjs` — a consumer app that watches a flag over SSE
- 122 tests; k6 load test; GitHub Actions CI with real PostgreSQL + Redis
  service containers; Dockerfile + docker-compose; `fly.toml`; Vercel config
- Docs: README, 23 ADRs in `DECISIONS.md`, `DEPLOY.md`, `USING.md`,
  `INTEGRATING.md`

---

## 3. What is verified working

Verified by execution, not by inspection.

| Area | Evidence |
| --- | --- |
| Rule engine | 47 tests, canonical MurmurHash vectors, SemVer precedence matrix |
| SDK | 4 tests (bootstrap, live SSE apply, close, error path) |
| API units | 68 tests: config pruning, scrypt, session signing/tampering/expiry, singleflight, rotation maths, AI heuristic + simulator |
| API HTTP surface | 16 integration tests against the composed app: readiness semantics, metrics exposition, 429 behaviour, 401s, 404s, helmet headers |
| Web build | `next build` clean, all routes emitted |
| Demo login → dashboard | Landed on `/dashboard/flags`, 4 flags, 0 console errors |
| Flag create + kill switch | Created via UI (key auto-derived `holiday_banner`), 4→5 switches, toggle flipped |
| Playground | Real decision `EXPLICIT_ALLOWLIST` for an allow-listed user |
| Audit log | 6 entries incl. `flag.created`, `flag.toggled`, correct actor |
| SDK key rotation | New key issued, previous key retained in the grace window |
| Signup flow | New account → both raw keys shown once → empty workspace |
| **Consumer SSE push** | A separate Node process printed `value true → false` within ~1s of a flag flip, with no polling or restart |
| **10-account rollout** | `/demo` table showed **6/10 accounts** on `new-checkout-flow`, server-computed |
| Tenant isolation | Asserted as a test — cross-tenant ids return `404` |
| **Migrations on real PostgreSQL 16** | **Verified in CI** — `migrate` then `seed` succeed in the `build` job |
| **Journey test** | **Verified in CI** — signup → project → SDK key → flag → evaluate → cache invalidation → cross-tenant 404s |
| **Redis Pub/Sub invalidation** | **Verified in CI** — two cache instances converge on a new version without a second database read |
| **End-to-end smoke** | **Verified in CI** — boot, readiness `200`, `flagforge_*` metrics series, SDK key rotation grace, batch evaluation, both AI endpoints, and `401`s for anonymous, forged and unknown-key calls |

Pipeline is green at commit `d3dc4d6`: both `Typecheck · Lint · Test` and `Build · Migrate · Seed · Smoke` pass.

---

## 4. Written but never executed

This is the most important section.

The migrations, the journey test and the Redis invalidation test are now verified
in CI. What genuinely remains unexecuted:

| Thing | Status | Risk |
| --- | --- | --- |
| Multi-machine cache coherence | In-process two-instance invalidation is verified in CI, but no two real API processes have ever shared one Redis. | The remaining gap in the core architectural claim. Medium–high. |
| k6 load test | Script exists, never run at load | Thresholds are unvalidated assertions. Medium. |
| Docker image build (`Dockerfile.api`, `Dockerfile.web`) | Never built — no Docker locally or in CI | A build error would surface only at first deploy. Medium. |
| Any deployment at all | **Never deployed** | Highest. |

---

## 5. What is not built

Grouped by how much it matters.

**Product features LaunchDarkly has and this does not:**

- **Multi-variate flags with weighted variations.** Ours serves one `serveValue`
  per rule (plus a default). There is no "A/B/C at 40/40/20 within one rule", so
  no A/B/n testing.
- **Experimentation.** No exposure events, no metric goals, no significance
  testing, no results view.
- **Reusable segments** (named cohorts referenced by many flags, and nested
  segments).
- **Prerequisites / flag dependencies** (don't evaluate B unless A is on).
- **Scheduled and automated ramps** ("10% → 50% over three days", scheduled
  on/off).
- **Approval workflows / required reviewers** — beyond the AI rule's explicit
  Apply button, there is no change-request process.
- **Flag insights**: stale-flag detection, code references (scanning your repos
  to find flags no longer read), usage analytics per flag.
- **Webhooks and integrations** (Slack, Datadog, Jira…).
- **SDKs in other languages.** One SDK (TypeScript/JavaScript) plus React.
- **Relay proxy / edge / daemon deployment** for local evaluation at scale.
- **Offline bootstrap file** for SDKs.

**Platform / trust features:**

- **Tamper-evident audit.** Rows are mutable and the FK still cascades on
  environment delete, so history can be lost or edited. No hash chain, no
  append-only enforcement.
- **RBAC, teams, SSO/SAML/SCIM, MFA.** Single-user workspaces only. No invites,
  no roles, no per-project permissions.
- **Session revocation.** Tokens are stateless; only the 7-day TTL expires them.
- **Password reset and email verification.** Neither exists.
- **Brute-force protection** on login beyond the general IP rate limit.
- **HA / replication / multi-region / backups / PITR.** Single PostgreSQL, single
  Redis, no failover story.
- **Billing, quotas, usage metering.**
- **Analytics on your own usage** (evaluations per flag, top consumers).

**Engineering hygiene:**

- No ESLint (the `lint` script literally prints "no lint configured").
- Test files are excluded from `tsc`, so tests are not type-checked.
- No coverage thresholds, no Playwright E2E, no dependency/container scanning.
- Web↔API types are hand-written, not generated, so they can drift.

---

## 6. Head-to-head

| Capability | FlagForge | LaunchDarkly |
| --- | --- | --- |
| Boolean / string / number / JSON flag values | ✅ | ✅ |
| Named variations with weighted splits (A/B/n) | ❌ | ✅ |
| Targeting rules (attribute + operator) | ✅ 10 operators | ✅ ~20+, incl. regex, dates, segment match |
| Reusable / nested segments | ❌ | ✅ |
| Sticky percentage rollout | ✅ (hash of `flagKey:userId`) | ✅ (multiple bucketing modes) |
| Individual allow / block lists | ✅ | ✅ (with per-user variation overrides) |
| Environments with separate SDK keys | ✅ (2 auto-created) | ✅ (unlimited, per-env config) |
| Instant propagation to running apps | ✅ SSE | ✅ streaming |
| **Server SDK evaluates locally from a downloaded ruleset** | ❌ **every evaluation is an HTTP round trip to the API** | ✅ (the core of their server SDK design) |
| SDK languages | 1 (+ React) | 20+ |
| Edge / relay / offline bootstrap | ❌ | ✅ |
| Audit log (actor, before/after) | ✅ | ✅ (richer, exportable) |
| Tamper-evident audit | ❌ | ✅ |
| Approvals / required reviewers | ❌ | ✅ |
| Scheduled & automated ramps | ❌ | ✅ |
| Experimentation & metrics | ❌ | ✅ |
| Code references / stale flag detection | ❌ | ✅ |
| Webhooks / integrations | ❌ | ✅ (large ecosystem) |
| Teams, RBAC, SSO, MFA | ❌ | ✅ |
| HA, replication, published SLA | ❌ | ✅ enterprise-grade |
| Self-hostable | ✅ (it's all yours) | ❌ SaaS (Relay Proxy is the closest) |
| Readable/explainable end-to-end | ✅ ~13k lines | ❌ far larger |
| AI rule authoring with a dry-run blast radius | ✅ distinctive flow | ✅ AI-assisted, different shape |
| Proven at production scale | ❌ 0 users | ✅ thousands of customers |

---

## 7. The architectural difference that matters most

This is the single biggest divergence, and it's worth understanding before
comparing anything else.

**LaunchDarkly's server SDKs** download the entire ruleset for an environment
once, keep it in memory, and evaluate **in your process** for every request. They
receive rule updates over a stream, but evaluation never leaves your machine.

**FlagForge evaluates centrally.** Your app calls `POST /v1/evaluate`, or
subscribes to SSE and receives results that were already evaluated on the server.

Consequences:

- **Good:** the rule engine is in one place, so there's no per-language drift; all
  the caching intelligence applies to everyone; the dashboard can show real
  decisions.
- **Bad:** every evaluation from a server-side caller is a **network hop**. A
  server handling 5,000 requests/second would have to either call the API 5,000
  times, or open one SSE stream per user context — which is not how that API is
  meant to be used.
- **Also worth naming:** the `X-Eval-Time-Ms` header measures *our* server's
  internal evaluation time (cache lookup + hash). It is **not** end-to-end latency
  from your app's perspective. My own measurements over localhost HTTP showed p95
  of tens of milliseconds once network and CORS preflight were included. The
  "sub-5ms" claim is about the internal read path, and should always be stated
  that way.

`GET /v1/config` does return the raw ruleset, and the evaluator is a
dependency-free package, so local evaluation is *possible* — it's just not
implemented in the SDK. That would be the first thing to fix for realistic
server-side use.

---

## 8. What would break first

In rough order, if you put real traffic on this tomorrow:

1. **The Docker image build** — never built; a container failure would surface
   only at first deploy.
2. **Multi-machine cache coherence** — in-process two-instance invalidation is
   verified, but no two real API processes have shared one Redis. The design is
   sound; it is unexercised.
3. **Per-evaluation round trips under server-side load** — see §7.
4. **The SSE hub** — every connected client lives in one process's memory map,
   with no cap on connections and no cross-instance client fan-out beyond Redis
   invalidation.
5. **PostgreSQL as a single point of failure** — no replica, no failover, no
   documented backup/restore.
6. **The audit log** — it can be edited, and deleting an environment takes its
   history with it.

---

## 9. What it is and isn't good for

**Good for:** learning and demonstrating real systems engineering (caching,
invalidation, consistent hashing, multi-tenancy, graceful degradation); a
portfolio piece you can explain end to end; a self-hosted flag service for a
small team's non-critical flags; a base to extend.

**Not good for:** replacing LaunchDarkly for a company that needs SSO, RBAC,
approvals, experimentation, compliance-grade audit, an SLA, or SDKs in five
languages. It is not a product; it is a well-built system.

**Compared to how it was described to you earlier:** the *engineering* is
genuinely substantial — 122 tests, real migrations, CI, a working product with
auth and tenancy. The *product surface* is a meaningful subset of LaunchDarkly's
core, missing most of the enterprise and experimentation layers. And the one
claim that matters most for a portfolio — "people can use it" — is currently
false, because it has never been deployed.
