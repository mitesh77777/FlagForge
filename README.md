# FlagForge

A production-grade **feature flag & gradual rollout engine** — a lean LaunchDarkly alternative built as a TypeScript monorepo.

Control plane and data plane are strictly separated, the read path is served from a two-tier cache (`L1` in-process → `L2` Redis → PostgreSQL only on a cold miss), changes propagate over Redis Pub/Sub and reach clients over Server-Sent Events, and an **AI rule compiler** turns plain English into a validated targeting AST — dry-running its blast radius against 1,000 synthetic users before a human clicks **Approve & Publish**.

> **Zero-login demo:** `docker compose up --build`, then open <http://localhost:3000> and hit **Launch Live Sandbox**.

---

## Table of contents

- [Architecture](#architecture)
- [Monorepo layout](#monorepo-layout)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Evaluation semantics](#evaluation-semantics)
- [Caching & invalidation](#caching--invalidation)
- [SDK](#sdk)
- [AI rule compiler](#ai-rule-compiler)
- [Testing](#testing)
- [Load testing](#load-testing)
- [CI](#ci)
- [Deployment](#deployment)
- [Design decisions](#design-decisions)

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
      Admin / Sandbox    │  apps/web — Next.js App Router + Tailwind     │
      (browser)          │  split-screen control plane / data plane UI   │
                         └───────────────┬──────────────────────────────┘
                                         │  /api/*  (writes)
                                         │  /v1/*   (reads, SSE)
                                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ apps/api — Fastify                                                        │
│                                                                           │
│  CONTROL PLANE  /api/*                     DATA PLANE  /v1/*              │
│  ┌────────────────────────────┐            ┌───────────────────────────┐  │
│  │ flag-service               │            │ EvaluationService         │  │
│  │  • BEGIN                  │            │  L1 Map ──► L2 Redis ──►  │  │
│  │  • UPDATE flag + version  │            │  PostgreSQL (cold only)   │  │
│  │  • INSERT audit_logs      │            │  • evaluate / batch       │  │
│  │  • COMMIT                 │            │  • SSE hub (per user)     │  │
│  │  • after commit:          │            └───────────▲───────────────┘  │
│  │      SET L2 env:{id}:flags│                        │ refresh L1        │
│  │      PUBLISH invalidation │────────┬───────────────┘                   │
│  └────────────────────────────┘        │  Redis Pub/Sub                  │
│                                        │  channel: flag_invalidation     │
└────────────────────────────────────────┼──────────────────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    │  PostgreSQL (source of truth)            │
                    │  projects · environments · flags ·       │
                    │  audit_logs (append-only)                │
                    └─────────────────────────────────────────┘
```

**Request path (warm):** `POST /v1/evaluate` → L1 hit → evaluate in memory → `200` with `X-Cache-Status: L1-HIT` and `X-Eval-Time-Ms`. **No PostgreSQL, no Redis round-trip.**

**Mutation path:** transaction writes the flag, increments `version`, appends the audit row → commit → refresh L2 → publish invalidation → every API instance drops its L1 entry, re-reads L2, and broadcasts fresh **per-user evaluated results** to its SSE clients.

---

## Monorepo layout

```
.
├── apps/
│   ├── api/                    # Fastify control plane + data plane + AI compiler
│   │   ├── drizzle/            # hand-authored SQL migrations + journal
│   │   └── src/
│   │       ├── control-plane/  # flag CRUD, audit log, versioning, sandbox bootstrap
│   │       ├── data-plane/     # two-tier cache, evaluation service, SSE hub, routes
│   │       ├── ai/             # LLM client, deterministic parser, blast-radius sim
│   │       └── db/             # Drizzle schema, migrate, seed, reset
│   └── web/                    # Next.js dashboard + split-screen live sandbox
├── packages/
│   ├── evaluator/              # pure, dependency-free rule engine (single source of truth)
│   └── sdk/                    # ~250-line browser SDK + React `useFlag` hook
├── benchmarks/load-test.js     # k6 cached vs direct-PostgreSQL comparison
├── .github/workflows/ci.yml    # typecheck · lint · test · build · migrate/seed smoke
├── Dockerfile.api              # multi-stage API image (migrate → seed → serve)
├── Dockerfile.web              # multi-stage Next.js image
└── docker-compose.yml          # postgres · redis · api · web
```

| Package | Description |
| --- | --- |
| `@flagforge/evaluator` | MurmurHash3 bucketing, SemVer precedence, and the evaluation engine. Zero dependencies, used by the API, the SDK's tests and the web UI. |
| `@flagforge/api` | Fastify server exposing `/api/*` (control) and `/v1/*` (data), backed by PostgreSQL + Redis. |
| `@flagforge/sdk` | Dependency-free client with SSE live updates and an optional React hook. |
| `@flagforge/web` | Next.js App Router dashboard and the zero-login split-screen sandbox. |

---

## Quick start

### 1. Docker (one command)

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL |
| --- | --- |
| Web (dashboard + sandbox) | <http://localhost:3000> |
| API | <http://localhost:8080> |
| Health | <http://localhost:8080/health> |

The API container runs migrations and an idempotent seed on boot, creating the `flagforge-demo` project, `prod`/`dev` environments and four flags.

### 2. Local (host processes, Docker for infra)

```bash
pnpm install
docker compose up -d postgres redis     # or point DATABASE_URL/REDIS_URL at your own

pnpm --filter @flagforge/evaluator build
pnpm db:migrate
pnpm db:seed

pnpm dev                                # API on :8080, web on :3000
```

### Requirements

- Node.js ≥ 20.10
- pnpm 9 (`corepack enable`)
- PostgreSQL 16, Redis 7 (or Docker)

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Log verbosity / production guards |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `8080` | API bind address |
| `DATABASE_URL` | `postgres://flagforge:flagforge@localhost:5432/flagforge` | PostgreSQL (source of truth) |
| `REDIS_URL` | `redis://localhost:6379` | L2 cache + Pub/Sub |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins (also applied to SSE) |
| `CACHE_NAMESPACE` | `flagforge` | Redis key prefix; bump to force a global cold start |
| `L2_CACHE_TTL_SECONDS` | `300` | Defensive TTL bounding staleness if Pub/Sub is down |
| `ADMIN_API_TOKEN` | _unset_ | When set, `/api/*` writes require `Authorization: Bearer …`; unset = open demo mode |
| `DEFAULT_ACTOR_EMAIL` | `admin@flagforge.dev` | Audit actor when `x-actor-email` is absent |
| `LLM_API_KEY` | _unset_ | OpenAI-compatible key; unset = deterministic offline parser |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint (DeepSeek, Groq, Gemini, …) |
| `LLM_MODEL` | `gpt-4o-mini` | Model used by the rule compiler |
| `LLM_TIMEOUT_MS` | `20000` | LLM request timeout before falling back |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Browser-reachable API origin (**build-time** for Next.js) |

The demo ships two intentionally public SDK keys:

```
prod  ff_live_demo_7f3a91c4e8b25d60
dev   ff_test_demo_2b6d08fe1439ac75
```

Only their SHA-256 hashes are stored in PostgreSQL.

---

## API reference

### Control plane — `/api/*`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health`, `/api/health` | Liveness + L1/SSE counts |
| `GET` | `/api/sandbox` | Zero-login bootstrap: project, environments, flags, audit logs, demo keys |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/environments?projectId=` | List environments |
| `POST` | `/api/environments` | Create environment (returns the raw SDK key **once**) |
| `POST` | `/api/environments/:id/rotate-key` | Rotate the SDK key for a tier |
| `GET` | `/api/environments/:id/flags` | List flags (reads PostgreSQL) |
| `POST` | `/api/environments/:id/flags` | Create flag |
| `GET` | `/api/flags/:id` | Get one flag |
| `PATCH` | `/api/flags/:id` | Update `enabled` / `rules` / `overrides` / `name` / `description` |
| `DELETE` | `/api/flags/:id` | Delete flag |
| `GET` | `/api/environments/:id/audit-logs?limit=` | Immutable audit trail (before/after JSON) |
| `GET` | `/api/ai/status` | Whether an LLM is configured |
| `POST` | `/api/ai/compile-rule` | Compile + validate + dry-run a rule (never persists) |

### Data plane — `/v1/*`

Authenticated with the `x-sdk-key` header. Responses expose `X-Cache-Status` (`L1-HIT` \| `L2-HIT` \| `DB-FALLBACK`) and `X-Eval-Time-Ms`.

```http
POST /v1/evaluate
x-sdk-key: ff_live_demo_7f3a91c4e8b25d60
content-type: application/json

{ "key": "new-checkout-flow", "userId": "user_demo_001", "attributes": { "plan": "enterprise" } }
```

```json
{
  "key": "new-checkout-flow",
  "value": true,
  "reason": "EXPLICIT_ALLOWLIST",
  "ruleId": null,
  "bucket": null,
  "version": 4,
  "environment": "prod"
}
```

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/evaluate` | Evaluate one flag for one user |
| `POST` | `/v1/evaluate/batch` | Evaluate all (or `keys[]`) flags for one user |
| `GET` | `/v1/config` | Raw flag configs for client-side evaluation |
| `GET` | `/v1/stream` | SSE. With `?userId=&attributes=` the server pushes **pre-evaluated** results; without, raw config |

---

## Evaluation semantics

Precedence is strict and short-circuits top to bottom:

```
1. enabled === false        → defaultValue     reason: KILL_SWITCH_OFF
2. userId ∈ blocklist       → false            reason: EXPLICIT_BLOCKLIST
3. userId ∈ allowlist       → true             reason: EXPLICIT_ALLOWLIST
4. rules, in order          → serveValue       reason: RULE_MATCH
5. otherwise                → defaultValue     reason: DEFAULT_FALLBACK
```

Inside a rule, `conditions` are combined with `matchType` (`AND` / `OR`). When they match, the user is bucketed:

```
bucket = MurmurHash3_32(`${flag.key}:${userId}`) % 100
serveValue  when bucket < rolloutPercentage
```

Salted with the **flag key**, so two flags at 10% target *independent* 10% cohorts, and the same user always lands in the same bucket (sticky, no assignment table).

**Operators:** `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `semver_gte`, `semver_lt`.

`semver_gte` / `semver_lt` implement full SemVer 2.0 precedence (numeric identifiers, pre-release ordering, build-metadata ignored).

---

## Caching & invalidation

| Tier | Storage | Scope | Role |
| --- | --- | --- | --- |
| **L1** | in-process `Map` | per instance | sub-millisecond hot path |
| **L2** | Redis JSON at `{ns}:env:{envId}:flags` | shared | survives restarts, warms cold instances |
| **DB** | PostgreSQL | global | cold fallback only |

Guarantees:

- **No PostgreSQL on a cache hit.** A warm `/v1/evaluate` performs zero DB and zero Redis I/O.
- **Cache propagation happens after commit.** Writing Redis inside the transaction could advertise a snapshot that then rolls back.
- **L1 is purged before publishing**, so a racing read can't serve stale data.
- **Redis is never a dependency.** L2 errors degrade to L1+DB; a failed subscription starts the process in degraded mode and the defensive TTL bounds staleness.
- **SSE is push-only.** Invalidation → refresh L1 → fan out per-client evaluated results. No polling from the SDK.

---

## SDK

```ts
import { FlagForgeClient } from '@flagforge/sdk';

const client = new FlagForgeClient({
  apiUrl: 'http://localhost:8080',
  sdkKey: 'ff_live_demo_7f3a91c4e8b25d60',
  userContext: { userId: 'user_demo_001', attributes: { plan: 'pro', country: 'US' } },
});

await client.ready;                       // never rejects
client.getFlag('new-checkout-flow');      // true | false | variant
client.get('ai-search-beta', false);      // typed with fallback
client.onChange((snapshot) => { /* … */ });
```

React:

```tsx
import { FlagForgeProvider, useFlag } from '@flagforge/sdk/react';

<FlagForgeProvider client={client}>
  <Checkout />
</FlagForgeProvider>;

function Checkout() {
  const enabled = useFlag('new-checkout-flow', false);
  return enabled ? <CheckoutV2 /> : <CheckoutLegacy />;
}
```

The SSE connection is opened with the user's context, so the server streams **already-evaluated** results — the browser never ships the rule engine, and flags flip without a refetch.

---

## AI rule compiler

`POST /api/ai/compile-rule` is a *proposal* endpoint. It never persists a flag.

1. **Compile** — the prompt goes to any OpenAI-compatible model. The output is parsed and validated against the **same strict Zod AST** used by the control plane, so an LLM can never introduce a shape the engine can't run.
2. **Fallback** — with no key (or on timeout / invalid output) a deterministic heuristic parser still produces a valid rule. The demo is fully functional offline.
3. **Simulate** — the candidate rule is evaluated against 1,000 deterministic synthetic users, returning match rate plus plan/country breakdowns and sample matched IDs.
4. **Approve** — the UI shows the before/after rule diff and blast radius; only an explicit **Approve & Publish** triggers a normal audited `PATCH`.

---

## Testing

```bash
pnpm turbo run typecheck lint test     # everything
pnpm --filter @flagforge/evaluator test
pnpm --filter @flagforge/api test
pnpm --filter @flagforge/sdk test
```

- `packages/evaluator` — hash vectors (canonical MurmurHash3), SemVer precedence, full precedence matrix.
- `apps/api` — request validation, cache-hit telemetry, transactional writes/audit, AI compile + simulate.
- `apps/api/src/data-plane/invalidation.test.ts` — real Redis integration test: two instances share L2 + Pub/Sub, a write on A invalidates B's L1 **without** a second DB read. Skipped locally unless `REDIS_TEST_URL` is set; runs in CI.

---

## Load testing

```bash
# warm data plane (L1/L2)
k6 run benchmarks/load-test.js

# direct-PostgreSQL baseline, for comparison
k6 run -e MODE=direct benchmarks/load-test.js

# tune the load
k6 run -e RATE=2000 -e DURATION=60s -e PRE_VUS=100 -e MAX_VUS=1000 benchmarks/load-test.js
```

Custom metrics report the cache mix (`flag_cache_l1_hit` / `l2_hit` / `db_fallback`) and the server-reported `server_eval_ms`, so the cache's contribution is measured rather than assumed.

---

## CI

`.github/workflows/ci.yml` runs two jobs with PostgreSQL 16 and Redis 7 service containers:

1. **Typecheck · Lint · Test** — full Turbo pipeline; `REDIS_TEST_URL` enables the Pub/Sub integration test.
2. **Build · Migrate · Seed · Smoke** — production build of all packages, then `migrate → seed → boot`, and real HTTP assertions across both planes (`X-Cache-Status` cold then warm), `/v1/evaluate/batch` and both AI endpoints.

---

## Deployment

Reference stack: **Fly.io** (API) · **Neon** (PostgreSQL) · **Redis Cloud**
(L2 cache + Pub/Sub) · **Vercel** (web). All deploy configuration is committed —
`fly.toml`, `apps/web/vercel.json`, `Dockerfile.api`, `Dockerfile.web`.

Full runbook: [`docs/DEPLOY.md`](./docs/DEPLOY.md). In short:

```bash
fly auth login
fly apps create flagforge-api-<unique>     # then set `app` + `primary_region` in fly.toml
fly secrets set \
  DATABASE_URL='postgresql://…?sslmode=require' \
  REDIS_URL='rediss://default:…' \
  CORS_ORIGINS='https://<your-web-domain>' \
  DEFAULT_ACTOR_EMAIL='you@example.com'
fly deploy
```

Then import the repo into Vercel with **Root Directory = `apps/web`** and set
`NEXT_PUBLIC_API_URL=https://<your-api-host>`.

Two requirements shape the hosting choice:

- **The API must be a long-lived container that never scales to zero.** The L1
  cache, the SSE hub and the Redis subscriber all live in process memory; a
  serverless or scale-to-zero host would silently destroy them.
- **`NEXT_PUBLIC_API_URL` is inlined at build time**, so changing it requires a
  Vercel redeploy.

The API container's `CMD` runs `migrate → seed (only if absent) → serve`; on Fly,
migrations also run as a **release command** so a bad migration fails the deploy
before traffic shifts.

---

## Design decisions

See [`DECISIONS.md`](./DECISIONS.md) for the reasoning behind the control/data split, hand-authored migrations, post-commit propagation, hashed keys, deterministic simulation and the offline AI fallback.

---

**License:** MIT (demo project — all seeded data is synthetic).