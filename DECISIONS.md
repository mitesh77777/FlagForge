# Design decisions

Architecture decision records for FlagForge. Each entry states the context, the
decision, and the consequences we accepted.

---

## 1. Separate the control plane from the data plane

**Context.** Flag management (create, edit, audit) is low-frequency and
consistency-sensitive. Flag evaluation is extremely high-frequency and
latency-sensitive. Mixing them lets a traffic spike starve the admin API — or an
admin write contend with the hot path.

**Decision.** Two distinct surfaces in one deployable, sharing a process but never
a code path:

| Plane | Prefix | Optimised for | Auth |
| --- | --- | --- | --- |
| Control | `/api/*` | correctness, auditability, transactions | optional bearer token |
| Data | `/v1/*` | throughput, bounded staleness | SDK key only |

The data plane is allowed to serve a slightly stale (but bounded) snapshot; the
control plane always reads/writes PostgreSQL synchronously.

**Consequences.** The data plane can be scaled horizontally behind a load balancer
with no change to the control plane. Cache invalidation becomes a first-class
concern (see #4). Some duplication of flag-shaped types — solved by #6.

---

## 2. PostgreSQL is the single source of truth; Redis is never authoritative

**Context.** A flag engine that trusts its cache as truth can lose writes on a
Redis eviction or failover.

**Decision.** Every mutation commits to PostgreSQL first. Redis holds only a
derived, disposable snapshot (`{ns}:env:{envId}:flags`) with a defensive TTL.
Redis may be flushed at any time; the next read rebuilds from PostgreSQL.

**Consequences.** Cache and DB can briefly disagree, but only in the direction of
"cache is older", and only until the invalidation lands or the TTL expires. No
write path depends on Redis availability.

---

## 3. Two-tier cache: L1 `Map` → L2 Redis → PostgreSQL

**Context.** The hot path must not do network I/O. A per-request Redis round-trip
is ~0.1–0.5 ms — fine alone, but multiplied across millions of evaluations it
dominates.

**Decision.** L1 is an in-process `Map` keyed by environment id holding the fully
materialised snapshot. L2 is a shared Redis JSON document. PostgreSQL is read
only when both miss. `setL1` is synchronous; L2 reads/writes are awaited but
failure-tolerant.

**Consequences.** Warm evaluations are pure CPU (`X-Cache-Status: L1-HIT`, no DB,
no Redis). Each instance's L1 must be invalidated independently — hence Pub/Sub
(#4). Memory per instance is small because a snapshot is one object per
environment, not per user.

---

## 4. Propagate cache changes *after* commit, and purge L1 before publishing

**Context.** The obvious implementation writes Redis inside the flag transaction.
If that transaction then rolls back, every instance has been told about a version
that never existed.

**Decision.** The mutation transaction only touches `flags` and `audit_logs`.
After `COMMIT`:

1. `SET` the fresh L2 snapshot,
2. `DELETE` this instance's L1 entry,
3. `PUBLISH flag_invalidation`.

Subscribers drop their own L1, re-read L2 (not PostgreSQL), and fan out.
Purging L1 *before* publishing closes the window where a concurrent read could
re-populate L1 from the stale L2 value.

**Consequences.** A crash between commit and publish leaves L2 stale until the TTL
expires — the reason `L2_CACHE_TTL_SECONDS` exists. The invariant "no second DB
read on invalidation" is asserted by an integration test.

---

## 5. Sticky bucketing via MurmurHash3 salted with the flag key

**Context.** Percentage rollouts must be deterministic, uniform, independent per
flag, and require no per-user assignment storage.

**Decision.** `bucket = MurmurHash3_32(`${flag.key}:${userId}`) % 100`, compare
against `rolloutPercentage`. The flag key is part of the hash input.

**Consequences.**

- Same user + same flag ⇒ same bucket forever (sticky, survives restarts).
- Two flags at 10% select *independent* cohorts — salting with the key prevents
  "the same unlucky 10% gets every experiment".
- Raising 10% → 25% is monotonic: the original 10% stays in.
- No assignment table, no write amplification, no migration when a rollout changes.

The trade-off is that re-keying a flag (renaming its `key`) reshuffles its cohort,
so `key` is immutable in the UI after creation.

---

## 6. One AST type module, shared by DB, API and SDK

**Context.** The rule shape lives in JSONB, crosses the control plane, the data
plane, the LLM boundary and the SDK. Four drifting definitions would be a
correctness bug factory.

**Decision.** `packages/evaluator/src/types.ts` is the only definition of
`Condition`, `TargetingRule`, `FlagOverrides`, `FlagConfig`, `EvaluationResult`.
Drizzle JSONB columns are typed against it; Zod schemas in the API validate into
it; the SDK imports it.

**Consequences.** A schema change is a compile error everywhere at once. The types
are deliberately JSON-native (no `Date`, no `Map`) so they persist and travel
without transform code.

---

## 7. Hand-authored SQL migration + journal instead of `drizzle-kit generate`

**Context.** `drizzle-kit generate` needs a schema snapshot directory to diff
against. The container applies migrations at runtime with `migrate()`, which only
needs the SQL files and `meta/_journal.json`.

**Decision.** Commit a single reviewed `0000_init.sql` plus a hand-written
`_journal.json`. No snapshot file, no generate step in the build.

**Consequences.** Migration SQL is code-reviewed like any other code and is
readable in a PR. The cost is that future schema changes must be written by hand
or generated locally and trimmed. Idempotent at the framework level: `migrate()`
tracks applied hashes, so it is safe on every container start.

---

## 8. Store only SHA-256 hashes of SDK keys, but publish the demo keys

**Context.** SDK keys are bearer credentials. A database dump should not leak
them. But the sandbox must work with zero signup.

**Decision.** Environments store `sha256(key)` plus a short display prefix; the
raw key is returned exactly once at creation/rotation. The seeded `flagforge-demo`
project intentionally uses two **public, well-known** keys that are documented in
the README.

**Consequences.** Lookup is a hash of the presented key followed by an indexed
equality check — constant time from the caller's perspective and no key material
at rest. The demo keys are not secrets and must never be used outside the demo.

---

## 9. Optional admin auth, with demo mode as the default

**Context.** A reviewer should be able to open the sandbox and click things
immediately, without provisioning a token. Production must not be wide open.

**Decision.** If `ADMIN_API_TOKEN` is unset, control-plane writes are open
(demo mode). If set, writes require `Authorization: Bearer <token>` with a
constant-time comparison. Reads stay open. The acting identity comes from
`x-actor-email`, defaulting to `DEFAULT_ACTOR_EMAIL`.

**Consequences.** Zero-friction demo, one env var away from being locked down. The
audit log still attributes every change to a named actor even in demo mode, so the
UI can show meaningful history.

---

## 10. The AI compiler proposes; a human publishes

**Context.** LLMs are good at translating intent to structure and bad at being
trusted with production writes. A malformed rule could turn a feature on for 100%
of users.

**Decision.** `POST /api/ai/compile-rule` is read-only. It returns a candidate
rule, a before/after diff, and a 1,000-user blast-radius simulation. Persistence
only happens through a second, explicit `PATCH /api/flags/:id` that the user
triggers via **Approve & Publish**. The candidate is validated by the *same* Zod
`targetingRuleSchema` used by the control plane.

**Consequences.** The worst a bad LLM response can do is fail validation or show a
scary blast radius. Publishing is auditable and attributable like any other write.
The UI never auto-applies.

---

## 11. Deterministic offline fallback for the rule compiler

**Context.** Requiring an API key to demo the marquee feature would make the
project unusable offline and untestable in CI.

**Decision.** If `LLM_API_KEY` is absent, times out, or returns invalid JSON, a
heuristic parser extracts plan/country/semver/percentage from the prompt and emits
a valid rule. Responses carry `source: 'llm' | 'fallback'` so the UI is honest.

**Consequences.** CI runs the AI endpoint with no key and no network. Users with a
key (OpenAI, DeepSeek, Groq, Gemini's OpenAI-compatible endpoint, …) get real
model output with the identical downstream validation.

---

## 12. Fixed, seeded synthetic population for blast-radius simulation

**Context.** A dry-run is only useful if it is reproducible: the same rule must
yield the same percentage on every click, so diffs are meaningful.

**Decision.** 1,000 users generated once with `mulberry32` seeded at a constant,
with weighted plans (~50/35/15) and realistic attribute distributions. The
dataset is frozen at module load.

**Consequences.** Simulation is deterministic and fast (pure CPU, sub-millisecond
per 1,000 evaluations). It is a *model* of the traffic mix, not a live query — we
say so in the UI rather than implying it reflects real users.

---

## 13. Stream pre-evaluated results over SSE instead of raw config

**Context.** A browser SDK that receives raw config would have to bundle the
evaluator, or make a follow-up HTTP request per change. Both are wasteful.

**Decision.** `/v1/stream?userId=&attributes=` binds the SSE connection to a user
context. Every `flags` event carries `results: Record<key, EvaluationResult>`
computed server-side. Connections without a context receive raw config for
server-side SDKs and tooling.

**Consequences.** The shipped SDK is small (~250 lines) and has no rule engine.
Flag flips reach the UI in one frame with no refetch. The cost is one SSE
connection per distinct user context — fine for a dashboard/sandbox, and the hub
already supports per-client payloads if this ever needs batching.

---

## 14. Degrade, never fail, when Redis is unavailable

**Context.** Redis is an optimisation. A flag engine that returns 500s because the
cache is down is worse than one that is momentarily slower.

**Decision.** Every L2 operation is wrapped; errors are logged and treated as a
miss. A failed Pub/Sub subscription logs an error and boots in degraded mode
rather than exiting. L1 and PostgreSQL still serve correct data.

**Consequences.** Availability is bounded by PostgreSQL, not Redis. Staleness is
bounded by `L2_CACHE_TTL_SECONDS` when Pub/Sub is degraded. Operators get a loud
log line instead of an outage.

---

## 15. Turborepo + pnpm workspaces

**Context.** Four inter-dependent packages (evaluator → api/sdk → web) need
ordered builds, shared TypeScript config, and task caching.

**Decision.** pnpm workspaces for linking (`workspace:*`) and Turborepo for the
task graph (`build` depends on `^build`; `typecheck`/`test` depend on upstream
builds). One root `tsconfig.base.json`.

**Consequences.** `pnpm turbo run build` builds the evaluator once and reuses it.
Because the API imports the evaluator's compiled `dist`, local workflows must build
it before type-checking the API — automated by Turbo, documented for manual runs.

---

## 16. Containers migrate and seed on boot; the demo project is reset each start

**Context.** A reviewer should get a working, populated instance from a single
`docker compose up`, with no manual SQL.

**Decision.** The API image's `CMD` is `migrate → seed → serve`. The seed deletes
and recreates the `flagforge-demo` project (cascading to its environments, flags
and audit rows) before inserting known-good data.

**Consequences.** Every boot starts the sandbox from a documented state, so the
"zero-login" demo is always coherent. The trade-off is that demo edits do not
survive a container restart — intentional for a sandbox, and called out in the
README. Migrations themselves are hash-tracked and safe to re-run.

---

## 17. Next.js without `output: 'standalone'`

**Context.** Standalone output produces the smallest runtime image, but Next.js
creates symlinks into `.next/standalone`, which fails with `EPERM` on Windows
without Developer Mode.

**Decision.** Ship the web image as a full workspace copy and start it with
`pnpm --filter @flagforge/web start`. `NEXT_PUBLIC_API_URL` is passed as a **build
arg**, because Next.js inlines `NEXT_PUBLIC_*` at build time.

**Consequences.** A somewhat larger image in exchange for a build that works
identically on Windows and Linux. This is documented in `Dockerfile.web` so the
reason isn't lost.

---

## 18. Resolve the bind port from `PORT`, not only `API_PORT`

**Context.** Managed hosts (Fly, Render, Railway, Cloud Run, Heroku, …) inject a
`PORT` environment variable and route traffic to it. The API originally read only
`API_PORT` with a hardcoded 8080 default, so on those hosts it could bind a port
that nothing forwards to — a container that looks healthy and serves nothing.

**Decision.** `loadConfig` resolves the port as `API_PORT ?? PORT ?? 8080`,
rejecting non-integer or non-positive candidates. `fly.toml` additionally pins
`PORT=8080` so the app and `internal_port` can never disagree.

**Consequences.** One image works on every host with no per-host guards, and a
malformed `PORT` degrades to a safe default instead of crashing at boot.

---

## 19. Seed only when the demo project is absent

**Context.** The seed deleted and recreated the `flagforge-demo` project
unconditionally. Every process start therefore discarded flag state and audit
history — acceptable for a throwaway sandbox, destructive for anything long-lived,
and it silently undid a reviewer's changes on each restart.

**Decision.** `seedDatabase(db, { force })` returns early (writing nothing) when
the demo project already exists unless `force` is set. The container runs it with
`--if-missing`; `SEED_DEMO=force` forces a reset, `SEED_DEMO=false` skips
entirely, and a manual `pnpm db:seed` still resets, because an operator running it
by hand almost always wants a clean slate.

**Consequences.** Deploys and restarts are non-destructive and cheap (the seed is
a single existence query when data is present). CI and `docker compose` still work
against a fresh database, and the demo stays self-healing via `SEED_DEMO=force`.

---

## 20. Treat blank environment values as unset

**Context.** `.env` files and docker-compose define optional variables with no
value (`LLM_API_KEY=`), which reach the process as `''` rather than being absent.
Optional secrets were validated with `.min(1)`, so an empty string failed
validation and crashed the process at boot. Blank `DATABASE_URL`/`REDIS_URL` would
likewise override their defaults with an unusable empty string. Both the shipped
`.env.example` and `docker-compose.yml` define these variables blank, so the
documented one-command start (`docker compose up --build`) would have
crash-looped — a failure that CI could not catch, because CI never sets those
variables at all.

**Decision.** `loadConfig` prunes whitespace-only values from the environment
before parsing, so a blank variable behaves exactly as if it were unset: defaults
apply, optional secrets stay absent, and a blank `PORT` is ignored.

**Consequences.** `.env`-driven, compose-driven and platform-driven starts all
agree, and a blank line in a config file can no longer take the service down.
`apps/api/src/config.test.ts` locks the behaviour in.