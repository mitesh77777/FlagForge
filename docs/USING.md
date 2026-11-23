# Using & testing FlagForge

## What it is

A **feature flag service**. You deploy it once, then your applications ask it
"should this user see this feature?" instead of hardcoding the answer.

Three things it gives you that `if (process.env.NEW_CHECKOUT === 'on')` does not:

| Capability | What it means for you |
| --- | --- |
| **Per-user targeting** | "25% of Pro users in India on v2.4+" — deterministic, sticky, no redeploy |
| **Instant changes** | Flip a flag and every running client updates in milliseconds over SSE |
| **An audit trail** | Every change records who did it and the exact before/after |

Plus a cached read path that answers in well under 5 ms without touching the
database, and an AI compiler that turns plain English into a validated,
dry-run targeting rule.

---

## 1. What you need

### To try it locally (nothing exotic)

| Requirement | Why |
| --- | --- |
| **Node 20+** | API, web app, SDK, example |
| **pnpm 9** (`corepack enable`) | Workspace manager |
| ~500 MB disk | `node_modules` |

No database, no Docker, no accounts, no API keys. The preview harness runs the
whole product from memory while using the *real* rule engine, AI compiler and
blast-radius simulator.

### To run the real stack

Add: **Docker Desktop** (for PostgreSQL 16 + Redis 7), or your own PostgreSQL and
Redis connection strings.

### To deploy it for other people

| Service | Free tier? | Purpose |
| --- | --- | --- |
| **Neon** | yes | PostgreSQL |
| **Redis Cloud** | yes | L2 cache + Pub/Sub invalidation |
| **Fly.io** | pay-as-you-go | API container (must be always-on) |
| **Vercel** | yes | Web app |

Optional: an **OpenAI-compatible API key** (OpenAI, DeepSeek, Groq…) to make the
AI compiler use a real model. Without one it uses a deterministic parser.

---

## 2. Run it

### Option A — preview harness (fastest, no infrastructure)

```bash
pnpm install
pnpm build        # the harness imports the compiled evaluator/compiler
pnpm preview      # API on :8080, web on :3000 — Ctrl+C stops both
```

Open <http://localhost:3000>. Sign in with **Try Interactive Demo**, or:

```
demo@flagforge.dev / demo1234
```

> Preview caveat: data lives in memory and resets on restart, and passwords are
> not verified. It is for clicking through the product, not for load or security
> testing. The real API is `apps/api`.

### Option B — real stack

```bash
cp .env.example .env
docker compose up --build
```

The API container migrates, seeds the demo workspace, then serves. Web on
`:3000`, API on `:8080`, health at `/health/ready`.

---

## 3. Use it as a real user

Sign in (or sign up at `/signup` — you get your own project with `development`
and `production` environments and real SDK keys shown **once**).

| Page | What you do |
| --- | --- |
| **Feature Flags** | Create a flag (`new_checkout_flow`), toggle the kill switch, open a flag to edit its rules |
| **Flag editor** | Build rules visually: attribute · operator · value, AND/OR, rollout slider. `{ } View JSON` shows the AST. The **AI assistant** compiles plain English, shows an impact meter over 1,000 synthetic users, then **Apply rule** |
| **SDK & Keys** | Copy your SDK key (rotate to reveal a fresh one — the old key keeps working for 24 h), grab the quickstart snippets |
| **Audit Log** | Human-readable history: `enabled: on → off`, `rules: 1 → 2`, with the actor |
| **Live Playground** | Pick your flag, set a `userId` + attributes, press Evaluate — see the real value, reason, MurmurHash3 bucket, cache tier and latency |

---

## 4. Test it as a real user (outside the dashboard)

This is the part that proves it is a service, not a dashboard. A separate
process, with no knowledge of FlagForge internals, watches a flag.

```bash
node examples/quickstart.mjs            # watch for live changes
node examples/quickstart.mjs --once     # evaluate once and exit
```

Real verified output:

```
FlagForge consumer example
  api        http://localhost:8080
  key        ff_live_demo_7f3…

── initial evaluation (bootstrap call) · config v1 ──────
  flag       new-checkout-flow
  user       user_demo_001 (pro, IN)
  value      true
  reason     EXPLICIT_ALLOWLIST

Listening on the SSE stream. Flip this flag in the dashboard…

── LIVE UPDATE — pushed over SSE · config v2 ──────
  value      false
  reason     KILL_SWITCH_OFF
```

Leave that process running and toggle the flag in the dashboard. **The value
changes there, live, with no polling and no restart.**

Point it at your own flag or user:

```bash
FLAGFORGE_FLAG=my_flag FLAGFORGE_USER=user_4821 node examples/quickstart.mjs
```

### Raw HTTP (no SDK at all)

```bash
curl -s http://localhost:8080/v1/evaluate \
  -H 'content-type: application/json' \
  -H 'x-sdk-key: ff_live_demo_7f3a91c4e8b25d60' \
  -d '{"key":"new-checkout-flow","userId":"user_123","attributes":{"plan":"pro","country":"IN"}}' \
  -i | grep -iE '^(HTTP/|x-cache-status|x-eval-time-ms)|value|reason'
```

Call it twice: the first response reports `X-Cache-Status: DB-FALLBACK`, the
second `L1-HIT`. That difference *is* the architecture.

### In a browser / React app

```tsx
import { FlagForgeProvider, useFlag } from '@flagforge/sdk/react';

<FlagForgeProvider client={client}>
  <Checkout />
</FlagForgeProvider>;

function Checkout() {
  const enabled = useFlag('new_checkout_flow', false);
  return enabled ? <CheckoutV2 /> : <CheckoutLegacy />;
}
```

---

## 5. Worth verifying deliberately

| Behaviour | How to see it |
| --- | --- |
| **Sticky bucketing** | In the playground, evaluate `user_123` at a 50% rollout, then drag the slider. The same user stays on the same side; the bucket number never changes |
| **Kill switch beats everything** | Turn a flag off, evaluate — reason is `KILL_SWITCH_OFF` even if the user is allowlisted |
| **Cache tiers** | Watch `L1-HIT` vs `DB-FALLBACK` in the playground header |
| **Invalidation** | Keep a flag open in the playground with live polling on, toggle it elsewhere — the decision changes within ~2 s |
| **Audit immutability** | Every toggle/rule change appears in Audit Log with the previous and new value |
| **Key rotation** | Rotate in SDK & Keys, then keep using the *old* key — it still authenticates for 24 h |
| **Tenant isolation** | Sign up a second account; it sees none of the first account's projects, and requesting their flag ids returns `404` |

---

## 6. Deploy so others can use it

1. **Neon** → project → copy the direct connection string with `?sslmode=require`
2. **Redis Cloud** → free database → copy the `rediss://…` URL
3. **Fly.io**

   ```bash
   fly auth login
   fly apps create flagforge-api-<unique>   # then set `app` + `primary_region` in fly.toml
   fly secrets set \
     DATABASE_URL='postgresql://…?sslmode=require' \
     REDIS_URL='rediss://…' \
     CORS_ORIGINS='https://<your-app>.vercel.app' \
     SESSION_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" \
     DEFAULT_ACTOR_EMAIL='you@example.com'
   fly deploy
   ```

4. **Vercel** → import the repo, **Root Directory `apps/web`**, env
   `NEXT_PUBLIC_API_URL=https://<your-app>.fly.dev` → deploy
5. Close the loop: `fly secrets set CORS_ORIGINS='https://<your-vercel-domain>'`

`SESSION_SECRET` is **required** in production — sessions are HMAC-signed with
it, and the built-in default is deliberately obvious.

Once deployed, the demo button at `/` gives any visitor a working workspace, and
your own apps can point at the real API URL with their own SDK key.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Landing page shows **API unreachable** | The API isn't running on `:8080`, or `NEXT_PUBLIC_API_URL` is wrong. Note it is inlined at **build** time — rebuild the web app after changing it |
| `pnpm demo` fails to import modules | Run `pnpm build` first; the harness imports from `dist/` |
| Sandbox page redirects to the dashboard | Expected — the old single-project sandbox was replaced by the product |
| SSE never updates in the example | The process needs a writable stream; check the API log for the toggle line |
| `401` from `/api/*` | Session expired (7 days) — sign in again |
| `404` for a flag you know exists | It belongs to another account; ids are intentionally indistinguishable from missing ones |
