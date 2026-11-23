# Integrating FlagForge into your own project

## The mental model (read this first)

**FlagForge stores no users.** You never create accounts here for the people who
use your app.

Your app already knows who the user is (`user.id`, an email, an integer — anything
stable). You pass that id when you ask about a flag, and FlagForge derives the
answer from it:

```
bucket = hash("new_checkout_flow:user_123") % 100
```

Because the hash is deterministic, **the same user always gets the same answer**
and different users scatter across 0–99. So if you set a 50% rollout, roughly half
of your accounts get the feature and half don't — automatically, for free, with no
user list to maintain:

| Your user id | Bucket | 50% rule | Result |
| --- | --- | --- | --- |
| `user_123` | 7 | 7 < 50 | ✅ sees it |
| `user_456` | 71 | 71 ≥ 50 | ❌ doesn't |
| `user_123` next week | 7 | 7 < 50 | ✅ still sees it |

That property is called **sticky bucketing**, and it's the thing that makes a demo
convincing: *this account sees it, that account doesn't* — reproducibly.

---

## 1. Get a key

In the dashboard: **SDK & Keys → Rotate key** on the environment you want
(`development` or `production`). Copy the raw key — it's shown once.

Keys are per environment on purpose: your dev and prod apps get different keys, so
turning a flag on in dev can never affect production.

## 2. Install the SDK

```bash
pnpm add @flagforge/sdk
# or: npm install @flagforge/sdk
```

> If you're consuming it from a local checkout instead of a registry, build it once
> (`pnpm --filter @flagforge/sdk build`) and point your package.json at the folder.

## 3. Ask about a flag

Three shapes, pick the one that matches your app.

### Server-side (Node, Next.js route handler, Express, a worker)

```ts
import { FlagForgeClient } from '@flagforge/sdk';

const client = new FlagForgeClient({
  apiUrl: process.env.FLAGFORGE_API_URL!,
  sdkKey: process.env.FLAGFORGE_SDK_KEY!,
  userContext: {
    userId: user.id,                     // ← YOUR user id
    attributes: { plan: user.plan, country: user.country },
  },
});

await client.ready;                       // one call, then a live stream

if (client.get('new_checkout_flow', false)) {
  return renderNewCheckout();
}
return renderOldCheckout();
```

### Browser / React

```tsx
import { FlagForgeProvider, useFlag } from '@flagforge/sdk/react';

<FlagForgeProvider client={client}>
  <App />
</FlagForgeProvider>;

function Checkout() {
  const enabled = useFlag('new_checkout_flow', false);
  return enabled ? <CheckoutV2 /> : <CheckoutLegacy />;
}
```

### No SDK at all (any language)

```bash
curl -s https://your-api/v1/evaluate \
  -H 'content-type: application/json' \
  -H 'x-sdk-key: ff_live_…' \
  -d '{"key":"new_checkout_flow","userId":"user_123","attributes":{"plan":"pro"}}'
```

```json
{ "key": "new_checkout_flow", "value": true, "reason": "RULE_MATCH",
  "ruleId": "pro_geo", "bucket": 37, "version": 4 }
```

**Always pass a fallback.** `client.get('x', false)` means "if FlagForge is
unreachable, assume off". A flag service must never be able to take your app down.

## 4. Make accounts differ

In the dashboard, on your flag:

| Goal | Configure |
| --- | --- |
| Show to ~half of everyone | One rule, no conditions, **rollout 50%** |
| Only Pro users in India | Rule: `plan = pro` **AND** `country = in [IN]`, rollout 100% |
| 25% of Pro users, v2.4+ | Rule: `plan = pro` AND `appVersion semver≥ 2.4.0`, rollout 25% |
| Always on for staff | Add their user ids to the **allow list** |
| Never on for a customer | Add their user id to the **block list** |

Order matters and is fixed: **kill switch → block list → allow list → rules in
order → default value.** The kill switch beats everything, which is what makes it a
kill switch.

Add custom attributes freely — `region`, `seats`, `signupDate` — they're just
key/value pairs you pass in `attributes`.

## 5. Prove it (what to actually show someone)

Open **`/demo`** in this repo. It is an ordinary web app with two versions of
several features, driven by the real SDK. It gives you:

1. A **10-account comparison table** — who gets what, with the bucket for each
2. A **user switcher** — click any account and watch the storefront change
3. A **decision panel** per flag, explaining *why* ("matched rule `pro_geo`, bucket 37")

Then flip a switch in the dashboard: the store, the panel and the table all update
**without a reload**.

To prove it against *your own* code, keep a terminal open:

```bash
node examples/quickstart.mjs
```

It prints your flag's value, and reprints it the instant you flip the switch —
no polling, no restart.

## 6. Test checklist

| Check | Expected |
| --- | --- |
| Kill switch off | Every user gets the fallback, reason `KILL_SWITCH_OFF` |
| Same user twice | Identical value and bucket (stickiness) |
| Ten different users at 50% | Roughly half get it; the split is stable across restarts |
| Flip while your app runs | Value changes within a second, no restart |
| Stop the API | Your app keeps working using the fallback value |
| Rotate the key | The old key still works for 24 h, so a rolling deploy survives |
| Wrong/unknown key | `401` — fail closed, don't fall back to "on" |

---

## Gotchas

- **Never hardcode the key in client code that ships publicly unless you mean to.**
  Browser SDK keys are visible to users by nature; that's why the data plane is
  read-only and scoped to one environment.
- **One key per environment.** Don't reuse the production key in dev.
- **Cache invalidation is automatic** — you don't need to restart or clear anything
  after changing a flag.
- **Attributes are not stored.** Every request sends them; nothing is persisted
  about your users.
- **`NEXT_PUBLIC_*` / build-time values.** If your web app reads the API URL from a
  public env var, it's baked in at build time — redeploy after changing it.
- **The playground's "live polling" is not the SDK path.** Real apps use SSE; the
  playground polls because SDK keys are hashed and can't be re-read from the
  dashboard.
