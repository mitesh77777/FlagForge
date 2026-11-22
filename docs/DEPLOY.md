# Deploying FlagForge end to end

This is the provisioning checklist for the chosen stack:

| Component | Platform |
| --- | --- |
| PostgreSQL | **Neon** |
| Redis (L2 + Pub/Sub) | **Redis Cloud** (Upstash also works — see §2) |
| API | **Fly.io** (`Dockerfile.api`, config committed in `fly.toml`) |
| Web | **Vercel** (`apps/web` + `apps/web/vercel.json`) |

Everything that can be done ahead of time is already in the repository:
`fly.toml`, `apps/web/vercel.json`, the `PORT` fallback, and the deploy-safe seed.

## Your steps (the only ones that need your credentials)

Total: ~10 minutes. Nothing below can be automated from my side because it
requires your accounts.

1. **Create a Neon project** → copy the connection string. (§1)
2. **Create a Redis Cloud database** → copy the `rediss://` URL. (§2)
3. **Generate an admin token** — run one command. (§3)
4. **Create a Fly app** and set 4 secrets, then `fly deploy`. (§4)
5. **Import the repo into Vercel**, set Root Directory `apps/web` + one env var,
   then deploy. (§5)
6. **Paste the two public URLs back to me** so I can finish CORS and run the
   end-to-end verification. (§6–§8)

---

## 0. Client-side vs server-side values

Know which values are inlined into the browser bundle and which stay private:

| Value | Visibility | When it is read |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **public** (shipped to the browser) | **build time** — changing it requires a redeploy |
| `DATABASE_URL` | secret | runtime |
| `REDIS_URL` | secret | runtime |
| `ADMIN_API_TOKEN` | secret | runtime |
| `LLM_API_KEY` | secret | runtime |
| `CORS_ORIGINS` | public | runtime |

---

## 1. PostgreSQL — Neon

1. Create a project at <https://console.neon.tech> in the region closest to where
   you will run the API.
2. Open **Connection Details** and copy the connection string. Keep
   `sslmode=require` on the end.
3. **Use the *direct* endpoint for migrations/seed and for the API pool.** Neon
   also offers a `-pooler` (PgBouncer) endpoint; transaction-mode pooling can
   interfere with DDL and prepared statements. The direct endpoint is the safe
   default for a long-lived container with a small `pg.Pool`.

```
DATABASE_URL=postgresql://<user>:<password>@ep-xxxx.<region>.aws.neon.tech/<db>?sslmode=require
```

> The project's `db/client.ts` passes this string straight to `pg` with no
> explicit TLS config, so the `sslmode=require` suffix is mandatory.
>
> Neon's free tier **auto-suspends** idle databases. The API only reads Postgres
> on a cold cache, so this is mostly harmless — but the very first boot
> (`migrate` → `seed`) may need a moment to wake the database.

---

## 2. Redis — Redis Cloud or Upstash

Create a database and copy the URL. **Use the TLS scheme (`rediss://`) when the
provider offers it.**

```
REDIS_URL=rediss://default:<password>@<host>:<port>
```

**Provider note.** This engine uses Redis for two things: the L2 cache **and** the
`flag_invalidation` Pub/Sub channel.

- **Redis Cloud** — full Redis, Pub/Sub works, invalidation is instant.
  Recommended.
- **Upstash** — its REST API has no Pub/Sub, and Pub/Sub over the Redis protocol
  is plan/feature dependent. **Verify on your plan.** It is not fatal:
  `InvalidationBus.start()` catches a failed subscription and boots in degraded
  mode, so invalidation still happens — just bounded by
  `L2_CACHE_TTL_SECONDS` instead of instantly.

---

## 3. Generate the secrets you own

Run these locally (Node is already installed). **Do not paste the output into a
chat — paste it into the hosting dashboard.**

```bash
# 32-byte admin bearer token (only if you lock the control plane down)
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# A cache namespace that forces a cold start when changed (any string works)
echo "flagforge-prod"
```

Your LLM key (optional) comes from your model provider — OpenAI, DeepSeek, Groq,
or any OpenAI-compatible endpoint. **Leave `LLM_API_KEY` unset** to run the
deterministic offline rule parser instead.

---

## 4. API — Fly.io

`fly.toml` is already committed at the repository root. It builds
`Dockerfile.api`, pins `internal_port = 8080`, keeps at least one machine always
running (`auto_stop_machines = false`), runs migrations as a release command, and
health-checks `/health`.

```bash
# one-time
fly auth login
fly apps create flagforge-api-<something-unique>   # names are global on Fly
# then edit one line in fly.toml:  app = "flagforge-api-<something-unique>"
# and set primary_region to a region near your Neon database.

# secrets (never committed)
fly secrets set \
  DATABASE_URL='postgresql://…?sslmode=require' \
  REDIS_URL='rediss://default:…' \
  CORS_ORIGINS='https://<your-web-domain>' \
  DEFAULT_ACTOR_EMAIL='you@example.com'

# deploy
fly deploy
```

The commit already contains the graceful-degradation behaviour, so **Redis being
temporarily unavailable never fails a request** — it just falls back to L1 +
PostgreSQL.

> **`PORT` is handled.** `config.ts` honours an explicit `API_PORT`, then the
> platform-injected `PORT`, then `8080`. `fly.toml` also pins `PORT=8080` so the
> app and `internal_port` can never disagree.

> **`ADMIN_API_TOKEN` — leave it unset for this deployment.** The sandbox is a
> deliberately public, writable demo. Setting the token would make every sandbox
> write return `401`, because the browser sends no bearer token. A server-side
> token proxy would not fix that either — the sandbox is a shared,
> unauthenticated playground, so real lockdown requires user auth at the web
> layer, which is out of scope here. The control plane is therefore intentionally
> open on this public demo.

Alternative hosts work identically (Railway, Render, Cloud Run with
`min-instances=1`); only `fly.toml` would be replaced. The one requirement is a
long-lived container that never scales to zero, because the L1 cache, the SSE hub
and the Redis subscriber all live in process memory.

### Environment variables

| Variable | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | from step 1 | secret |
| `REDIS_URL` | from step 2 | secret |
| `API_PORT` / `PORT` | provided by the host | see the `PORT` note below |
| `CORS_ORIGINS` | `https://<your-web-domain>` | must match the browser origin exactly |
| `CACHE_NAMESPACE` | `flagforge-prod` | |
| `L2_CACHE_TTL_SECONDS` | `300` | staleness bound if Pub/Sub is down |
| `ADMIN_API_TOKEN` | token from step 3 | **see the trade-off below** |
| `DEFAULT_ACTOR_EMAIL` | your email | shown in the audit log |
| `SEED_DEMO` | `true` | only after fix #2 below |
| `LLM_API_KEY` | optional | unset ⇒ offline parser |

> **`PORT` note.** `config.ts` currently reads `API_PORT` (default 8080). Most
> hosts inject `PORT` instead, so either set `API_PORT` explicitly or apply
> fix #1 below.

The container's `CMD` runs `migrate → seed → serve`. If you ever run more than one
replica, move `migrate` to a pre-deploy/release step so replicas don't race.

> **`ADMIN_API_TOKEN` trade-off.** The web sandbox sends only `x-actor-email`, not
> a bearer token. Setting this variable makes every sandbox write return `401`.
> Choose deliberately:
> - **Public demo** → leave it unset (control-plane writes are open).
> - **Locked down** → set it, and accept that the sandbox UI becomes read-only
>   until token pass-through is added to the web app (fix #3).

---

## 5. Web — Vercel

1. Import the repository at <https://vercel.com/new>.
2. Set **Root Directory** to `apps/web`.
3. Set the environment variable:

```
NEXT_PUBLIC_API_URL=https://<your-api-host>
```

4. Deploy.

> **Monorepo build is already pinned** in `apps/web/vercel.json`, because
> `apps/web` imports the workspace packages `@flagforge/sdk` and
> `@flagforge/evaluator`, whose entry points resolve to `dist/index.js` and must
> be built **before** `next build`:

```json
"installCommand": "cd ../.. && pnpm install --frozen-lockfile",
"buildCommand": "cd ../.. && pnpm turbo run build --filter @flagforge/web"
```

> So the only Vercel UI setting you must change is **Root Directory =
> `apps/web`** (that one cannot come from `vercel.json`). If the build ever fails
> to resolve `@flagforge/sdk`, the fallback is to clear the Root Directory and set
> the output directory to `apps/web/.next`.

---

## 6. Wire CORS

After the web URL exists, set the API's `CORS_ORIGINS` to it **without a trailing
slash** and redeploy the API:

```
CORS_ORIGINS=https://your-app.vercel.app
```

Vercel **preview** deployments get a unique `*.vercel.app` URL per commit. The SSE
route echoes the request `Origin`, so the live stream works from previews, but the
regular `/v1/*` and `/api/*` fetches are restricted to `CORS_ORIGINS` — add the
preview origin if you need it, or test previews against the API from the same
origin list.

---

## 7. Verify end to end

Replace `$API` with your API host and `$KEY` with `ff_live_demo_7f3a91c4e8b25d60`
(or your own key).

```bash
# 1. Liveness
curl -s $API/health

# 2. Cold read → DB-FALLBACK
curl -si -X POST $API/v1/evaluate \
  -H 'content-type: application/json' -H "x-sdk-key: $KEY" \
  -d '{"key":"new-checkout-flow","userId":"user_demo_001","attributes":{"plan":"enterprise"}}' \
  | grep -iE '^(HTTP/|x-cache-status|x-eval-time-ms)'

# 3. Warm read → L1-HIT  (same command again)
curl -si -X POST $API/v1/evaluate \
  -H 'content-type: application/json' -H "x-sdk-key: $KEY" \
  -d '{"key":"new-checkout-flow","userId":"user_demo_001","attributes":{"plan":"enterprise"}}' \
  | grep -iE '^(HTTP/|x-cache-status|x-eval-time-ms)'

# 4. Cross-instance invalidation: flip a flag and re-read (should be L1-HIT with a new version)
curl -s -X PATCH $API/api/flags/<flag-id> \
  -H 'content-type: application/json' -H 'x-actor-email: you@example.com' \
  -d '{"enabled":false}'

# 5. AI compiler (works with no LLM key)
curl -s -X POST $API/api/ai/compile-rule -H 'content-type: application/json' \
  -d '{"prompt":"25% of Pro users in India on version 2.4.0+","flagKey":"new-checkout-flow"}'
```

Then in the **browser**: open the site → **Launch Live Sandbox** → flip a kill
switch → the right-hand pane must update **without a page refresh**. That single
observation proves SSE + Pub/Sub + L2 across the whole stack.

Optional load test against the live API:

```bash
k6 run -e BASE_URL=$API -e SDK_KEY=$KEY benchmarks/load-test.js
```

---

## 8. What I need back from you

**Non-secret values only** — safe to paste here:

| # | Value | Example |
| --- | --- | --- |
| 1 | Chosen API host | `fly.io` / `railway` / `render` |
| 2 | API public URL (after first deploy) | `https://flagforge-api.fly.dev` |
| 3 | Web public URL (after first deploy) | `https://flagforge.vercel.app` |
| 4 | Demo or locked down? | `open demo` / `ADMIN_API_TOKEN set` |
| 5 | LLM key available? | `yes` / `no — use fallback` |

**Secrets** go directly into the hosting dashboards, not to me:

- `DATABASE_URL` → API host
- `REDIS_URL` → API host
- `ADMIN_API_TOKEN` → API host (optional)
- `LLM_API_KEY` → API host (optional)
- `NEXT_PUBLIC_API_URL` → Vercel

**Access I'd need beyond that** (read-only is fine):

- the API host's dashboard or team, if you want me to set env vars myself
- the ability to run one-off commands on the API service (`migrate`, `seed`,
  logs) — or you run my exact commands and paste the output
- GitHub push access if you want continuous deployment wired up

I do **not** need your database password, Redis password, or LLM key.

---

## 9. Code changes already applied

These were required before the first deploy and are already committed:

1. **`PORT` fallback** — `config.ts` now resolves the bind port as
   `API_PORT ?? PORT ?? 8080`, so the container listens where the host routes.
2. **Deploy-safe seed** — `seed.ts` takes `{ force }` and the container runs it
   with `--if-missing`, so a redeploy no longer wipes flag state or audit history.
   `SEED_DEMO=force` resets, `SEED_DEMO=false` never seeds, and a manual
   `pnpm db:seed` still resets for local work.
3. **Admin token** — decided to stay unset (public demo); see §4.

Deploy configuration is also committed: `fly.toml`, `apps/web/vercel.json`, and
the updated `Dockerfile.api` command.

---

## Appendix A — Generating and verifying each value

### A.1 `DATABASE_URL` (Neon)

1. <https://console.neon.tech> → **New Project** → name it, pick the region
   closest to your API host.
2. In the project, click **Connect** (or **Connection Details**).
3. Select branch `main`, database `neondb`, role — choose the **direct**
   (non-`-pooler`) host.
4. Copy the full string. It looks like:

```
postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

5. Verify it before deploying:

```bash
cd apps/api
export DATABASE_URL='postgresql://...'
node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('select 1 as ok').then(r=>console.log('DB OK',r.rows[0])).catch(e=>{console.error('DB FAIL',e.message);process.exitCode=1}).finally(()=>p.end())"
```

PowerShell: set it with `$env:DATABASE_URL="postgresql://..."` first.

### A.2 `REDIS_URL` (Redis Cloud or Upstash)

**Redis Cloud:** <https://redis.io/cloud> → create a free database → open it →
copy **Public endpoint** and **Default user password** → assemble:

```
rediss://default:<password>@<host>:<port>
```

**Upstash:** <https://console.upstash.com> → Create Database → enable **TLS** →
copy the connection URL from the *Connect → ioredis* tab.

Verify the connection **and whether Pub/Sub actually works** (this answers the
Upstash question definitively):

```bash
cd apps/api
export REDIS_URL='rediss://...'

# 1. connectivity
node -e "const R=require('ioredis');const r=new R(process.env.REDIS_URL);r.ping().then(x=>console.log('PING',x)).catch(e=>{console.error('FAIL',e.message);process.exitCode=1}).finally(()=>r.disconnect())"

# 2. Pub/Sub support (the invalidation bus depends on this)
node -e "const R=require('ioredis');const s=new R(process.env.REDIS_URL);s.subscribe('flag_invalidation',(e)=>{if(e){console.error('PUBSUB FAIL',e.message)}else{console.log('PUBSUB OK')}process.exit(e?1:0)});setTimeout(()=>{console.error('PUBSUB TIMEOUT');process.exit(1)},8000)"
```

If the Pub/Sub check fails, the API still runs — invalidation just degrades to the
`L2_CACHE_TTL_SECONDS` bound. Prefer Redis Cloud if you want instant flips.

### A.3 `ADMIN_API_TOKEN`

Generate 32 random bytes as hex. Pick the equivalent for your shell:

```bash
# Git Bash / WSL / macOS / Linux
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

# PowerShell (same thing)
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Output is 64 hex characters, e.g.
`9f2c...`. Paste it into the API host's env var `ADMIN_API_TOKEN`.

Verify it once the API is deployed:

```bash
curl.exe -s -o NUL -w "%{http_code}\n" -X PATCH "$API/api/flags/<id>" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
# 200/422 => token accepted; 401 => token wrong
```

### A.4 `CACHE_NAMESPACE`

Not a secret — any string. Use `flagforge-prod` for the API. Changing it later
invalidates every L2 entry at once (a controlled cold start).

### A.5 `LLM_API_KEY` (optional)

Get a key from your provider and pair it with the matching base URL:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` example |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |

Leave `LLM_API_KEY` unset to use the deterministic offline parser — the AI
endpoint still returns valid rules.

### A.6 `NEXT_PUBLIC_API_URL`

This is just your API host's public URL (`https://…`), available after the first
API deploy. It is **not** generated — you read it off the host's dashboard. Set it
in Vercel and redeploy.

### A.7 SDK keys (`ff_live_…` / `ff_test_…`)

Format: `ff_<live|test>_<32 hex chars>`. Only the SHA-256 hash is stored; the raw
key is shown **exactly once** at creation.

**Path 1 — use the seeded demo keys** (public, printed by the seed on boot):

```
prod  ff_live_demo_7f3a91c4e8b25d60
dev   ff_test_demo_2b6d08fe1439ac75
```

**Path 2 — generate your own** through the running API (recommended for anything
non-demo). The server generates and hashes the key for you:

```bash
# 1. create a project → note the returned project id
curl.exe -s -X POST "$API/api/projects" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"My Product","slug":"my-product"}'

# 2. create an environment → the response's `sdkKey` is the raw key, shown once
curl.exe -s -X POST "$API/api/environments" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"projectId":"<project-uuid>","name":"prod","tier":"live"}'
```

Response shape:

```json
{
  "environment": { "id": "…", "projectId": "…", "name": "prod", "sdkKeyPrefix": "ff_live_a1b2c3d4", "createdAt": "…" },
  "sdkKey": "ff_live_4f8b2c9d3e7a1b6f0c5d8e2a9b4f7c31"
}
```

Rotate an existing key the same way, at any time:

```bash
curl.exe -s -X POST "$API/api/environments/<env-id>/rotate-key" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"tier":"live"}'
```

(Omit the `authorization` header when `ADMIN_API_TOKEN` is unset.)

**Path 3 — craft a key offline** and insert its hash directly (advanced; useful if
you must pre-provision a key without calling the API):

```bash
KEY="ff_live_$(node -e "process.stdout.write(require('node:crypto').randomBytes(16).toString('hex'))")"
node -e "const c=require('node:crypto');const k=process.argv[1];console.log('key   :',k);console.log('hash  :',c.createHash('sha256').update(k).digest('hex'));console.log('prefix:',k.slice(0,16))" "$KEY"
```

Then insert using the printed `hash` and `prefix`:

```sql
INSERT INTO environments (project_id, name, sdk_key_hash, sdk_key_prefix)
VALUES ('<project-uuid>', 'prod', '<hash>', '<prefix>');
```

### A.8 Platform tokens (only if you want CI to deploy for you)

| Platform | How to generate | Used for |
| --- | --- | --- |
| Fly.io | `fly tokens create deploy -x 999999h` | `FLY_API_TOKEN` GitHub secret |
| Render | Account Settings → API Keys → Create | `RENDER_API_KEY` |
| Railway | Account → Tokens → Create Token | `RAILWAY_TOKEN` |
| Vercel | <https://vercel.com/account/tokens> → Create | `VERCEL_TOKEN` |

These are only needed for continuous deployment. The default `ci.yml` runs
typecheck/lint/test/build and needs **no** secrets.
