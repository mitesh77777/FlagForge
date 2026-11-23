'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  CreditCard,
  Crown,
  Loader2,
  Moon,
  Search,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react';
import { API_URL } from '@/lib/api';
import { Badge, StatusDot } from '@/components/ui';
import {
  DEMO_USERS,
  useCohort,
  useFlagSnapshot,
  type DemoUser,
} from '@/hooks/useFlagSnapshot';

/** The flags this page reacts to, in display order. */
const WATCHED = [
  'new-checkout-flow',
  'pricing-page-v2',
  'ai-search-beta',
  'dark-mode-default',
] as const;

const NICE_NAME: Record<string, string> = {
  'new-checkout-flow': 'New checkout',
  'pricing-page-v2': 'Pricing page v2',
  'ai-search-beta': 'AI search',
  'dark-mode-default': 'Dark mode by default',
};

interface SandboxResponse {
  demoKeys: { prod: string; dev: string };
  project: { name: string } | null;
}

/** Turn an evaluation reason into a sentence a non-engineer can follow. */
function explain(reason: string | undefined, ruleId: string | null | undefined, bucket: number | null | undefined): string {
  switch (reason) {
    case 'KILL_SWITCH_OFF':
      return 'The switch is turned OFF for everyone in this environment.';
    case 'EXPLICIT_ALLOWLIST':
      return 'This user is on the allow list, so they always get it.';
    case 'EXPLICIT_BLOCKLIST':
      return 'This user is on the block list, so they never get it.';
    case 'RULE_MATCH':
      return `Matched the rule “${ruleId ?? 'unnamed'}”, then landed in bucket ${bucket} — inside the rollout.`;
    case 'DEFAULT_FALLBACK':
      return 'No rule matched this user, so the flag fell back to its default value.';
    default:
      return 'Waiting for the first answer…';
  }
}

function FlagLabel({ flagKey }: { flagKey: string }) {
  return (
    <span className="font-mono text-2xs text-ink-faint">
      controlled by <span className="text-ink-muted">{flagKey}</span>
    </span>
  );
}

export default function DemoStorePage() {
  const [sdkKey, setSdkKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>(DEMO_USERS[0]!.id);

  const user: DemoUser =
    DEMO_USERS.find((candidate) => candidate.id === userId) ?? DEMO_USERS[0]!;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/api/sandbox`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`sandbox bootstrap failed (${res.status})`);
        const body = (await res.json()) as SandboxResponse;
        if (!cancelled) setSdkKey(body.demoKeys.prod);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'failed to load demo');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { snapshot, connected } = useFlagSnapshot(sdkKey, user);
  const cohort = useCohort(sdkKey, DEMO_USERS, snapshot.version);

  const on = (key: string): boolean => snapshot.results[key]?.value === true;
  const ready = Object.keys(snapshot.results).length > 0;

  const dark = on('dark-mode-default');
  const aiSearch = on('ai-search-beta');
  const pricingV2 = on('pricing-page-v2');
  const checkout = on('new-checkout-flow');

  return (
    <div className="min-h-screen bg-canvas">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs text-ink-muted transition hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <rect x="2.5" y="3.5" width="19" height="3.2" rx="1.6" fill="#FAFAFA" />
              <rect x="2.5" y="10.4" width="12" height="3.2" rx="1.6" fill="#10B981" />
              <rect x="2.5" y="17.3" width="6.5" height="3.2" rx="1.6" fill="#FAFAFA" fillOpacity="0.35" />
            </svg>
            FlagForge
          </Link>

          <span className="h-5 w-px bg-line" aria-hidden="true" />

          <span className="text-xs font-medium text-ink">
            Live demo store
          </span>
          <Badge>real SDK · real flags</Badge>
          <Badge tone={connected ? 'emerald' : 'neutral'}>
            <StatusDot tone={connected ? 'emerald' : 'neutral'} pulse={connected} />
            {connected ? 'connected' : 'connecting'}
          </Badge>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="font-mono text-2xs text-ink-faint">You are</span>
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              className="max-w-[22rem] rounded border border-line bg-panel px-2 py-1.5 font-mono text-2xs text-ink focus:border-emerald-500/50 focus:outline-none"
            >
              {DEMO_USERS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <Link
              href="/dashboard/flags"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-2xs text-ink-muted transition hover:border-line-strong hover:text-ink"
            >
              Flip the switches
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 py-5">
        <p className="mb-5 max-w-3xl text-2xs leading-relaxed text-ink-muted">
          This is an ordinary web app. It contains <strong className="text-ink">two
          versions of several features</strong> and asks FlagForge which one to show
          you. Pick a different user above to watch the same page decide
          differently — then flip a switch in the dashboard and watch it change
          live.
        </p>

        {loadError && (
          <p className="mb-4 rounded border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-2xs text-red-400">
            {loadError} — is the API running at {API_URL}?
          </p>
        )}

        {!ready && !loadError && (
          <div className="flex items-center gap-2 py-16 text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-mono text-2xs">asking FlagForge…</span>
          </div>
        )}

        {ready && (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            {/* ── The app ─────────────────────────────────────────────────── */}
            <div
              className={`overflow-hidden rounded-lg border transition-colors ${
                dark ? 'border-line bg-[#0c0c0c]' : 'border-zinc-300 bg-zinc-100 text-zinc-900'
              }`}
            >
              <div
                className={`flex items-center justify-between border-b px-4 py-3 ${
                  dark ? 'border-line' : 'border-zinc-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Acme Cloud</span>
                  <Badge tone={dark ? 'emerald' : 'neutral'}>
                    {dark ? 'dark theme' : 'light theme'}
                  </Badge>
                </span>
                <span className="flex items-center gap-1.5">
                  {dark ? (
                    <Moon className="h-3.5 w-3.5 opacity-60" />
                  ) : (
                    <Sun className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <FlagLabel flagKey="dark-mode-default" />
                </span>
              </div>

              <div className="space-y-5 p-4">
                {/* Search */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-2xs uppercase tracking-[0.14em] opacity-60">
                      Search
                    </span>
                    <FlagLabel flagKey="ai-search-beta" />
                  </div>
                  <div
                    className={`flex items-center gap-2 rounded border px-3 py-2.5 ${
                      dark ? 'border-line bg-black' : 'border-zinc-300 bg-white'
                    }`}
                  >
                    {aiSearch ? (
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs opacity-70">
                      {aiSearch
                        ? 'Ask AI: “which plan fits a 40-person team?”'
                        : 'Search products…'}
                    </span>
                    {aiSearch && (
                      <Badge tone="emerald" className="shrink-0">
                        AI
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Pricing */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-2xs uppercase tracking-[0.14em] opacity-60">
                      Pricing page
                    </span>
                    <FlagLabel flagKey="pricing-page-v2" />
                  </div>

                  {pricingV2 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { name: 'Starter', price: '$0', icon: Zap },
                        { name: 'Pro', price: '$24', icon: CreditCard },
                        { name: 'Scale', price: '$99', icon: Crown },
                      ].map((tier, index) => {
                        const highlighted = index === 1;
                        return (
                          <div
                            key={tier.name}
                            className={`rounded border p-3 ${
                              highlighted
                                ? dark
                                  ? 'border-emerald-500/40 bg-emerald-500/[0.07]'
                                  : 'border-emerald-500 bg-emerald-50'
                                : dark
                                  ? 'border-line bg-black/50'
                                  : 'border-zinc-300 bg-white'
                            }`}
                          >
                            <tier.icon
                              className={`h-3.5 w-3.5 ${highlighted ? 'text-emerald-500' : 'opacity-50'}`}
                            />
                            <div className="mt-1.5 text-xs font-medium">{tier.name}</div>
                            <div className="font-mono text-sm">
                              {tier.price}
                              <span className="text-2xs opacity-60">/mo</span>
                            </div>
                          </div>
                        );
                      })}
                      <p className="col-span-3 text-2xs opacity-60">
                        New usage-based layout — the Pro tier is the recommended one.
                      </p>
                    </div>
                  ) : (
                    <div
                      className={`rounded border p-4 ${
                        dark ? 'border-line bg-black/50' : 'border-zinc-300 bg-white'
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs opacity-70">Starter</span>
                        <span className="font-mono text-sm">$0/mo</span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-xs opacity-70">Everything else</span>
                        <span className="font-mono text-sm">$24/mo</span>
                      </div>
                      <p className="mt-2 text-2xs opacity-60">
                        Classic price list.
                      </p>
                    </div>
                  )}
                </div>

                {/* Checkout */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-2xs uppercase tracking-[0.14em] opacity-60">
                      Checkout
                    </span>
                    <FlagLabel flagKey="new-checkout-flow" />
                  </div>

                  {checkout ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 rounded border border-emerald-500 bg-emerald-500 px-4 py-3 text-xs font-semibold text-black"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Complete purchase — $24/mo · one page
                    </button>
                  ) : (
                    <div
                      className={`rounded border p-3 ${
                        dark ? 'border-line bg-black/50' : 'border-zinc-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-2xs opacity-70">
                        <span className="rounded border border-current px-1.5 py-0.5">
                          Step 1 of 3
                        </span>
                        <span>Cart</span>
                        <span className="opacity-40">→</span>
                        <span>Address</span>
                        <span className="opacity-40">→</span>
                        <span>Payment</span>
                      </div>
                      <button
                        type="button"
                        className={`mt-2.5 w-full rounded border px-4 py-2.5 text-xs ${
                          dark ? 'border-line bg-card' : 'border-zinc-300 bg-zinc-200'
                        }`}
                      >
                        Continue to address
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── What FlagForge decided ──────────────────────────────────── */}
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <div className="rounded-lg border border-line bg-panel">
                <div className="border-b border-line px-3.5 py-2.5">
                  <h2 className="text-2xs font-medium uppercase tracking-[0.16em] text-ink">
                    What FlagForge decided
                  </h2>
                  <p className="mt-1 font-mono text-2xs text-ink-faint">
                    for {user.id}
                  </p>
                </div>

                <div className="divide-y divide-line">
                  {WATCHED.map((flagKey) => {
                    const result = snapshot.results[flagKey];
                    const value = result?.value === true;
                    return (
                      <div key={flagKey} className="px-3.5 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-ink">
                            {NICE_NAME[flagKey] ?? flagKey}
                          </span>
                          <Badge tone={value ? 'emerald' : 'red'}>
                            {value ? 'NEW' : 'OLD'}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">
                          {explain(result?.reason, result?.ruleId, result?.bucket)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-2xs text-ink-faint">
                          <span className="rounded border border-line bg-black/40 px-1.5 py-0.5">
                            {result?.reason ?? '—'}
                          </span>
                          {result?.bucket !== null && result?.bucket !== undefined && (
                            <span className="rounded border border-line bg-black/40 px-1.5 py-0.5">
                              bucket {result.bucket}/100
                            </span>
                          )}
                          <span className="rounded border border-line bg-black/40 px-1.5 py-0.5">
                            v{result?.version ?? '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-line px-3.5 py-3">
                  <p className="text-2xs leading-relaxed text-ink-faint">
                    Change the user above — the same rules produce different
                    answers because each user id hashes to a different bucket.
                    Flip a switch in the dashboard and this panel updates
                    instantly.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ── The point: same rules, different accounts ────────────────────── */}
        {ready && (
          <section className="mt-4 overflow-hidden rounded-lg border border-line bg-panel">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-2xs font-medium uppercase tracking-[0.16em] text-ink">
                All 10 accounts · same rules · different answers
              </h2>
              <p className="mt-1 max-w-3xl text-2xs leading-relaxed text-ink-muted">
                FlagForge stores no users. Your app sends whatever id it already
                has, and the answer is derived from it — which is why one account
                gets the new feature and another does not. Click a row to sign in
                as that account.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-2xs uppercase tracking-[0.14em] text-ink-faint">
                    <th className="px-4 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium">Plan · country</th>
                    <th className="px-3 py-2 font-medium">Bucket</th>
                    {WATCHED.map((flagKey) => (
                      <th key={flagKey} className="px-3 py-2 font-medium">
                        {NICE_NAME[flagKey]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DEMO_USERS.map((candidate) => {
                    const row = cohort[candidate.id] ?? {};
                    const active = candidate.id === userId;
                    const bucket = row['new-checkout-flow']?.bucket;
                    return (
                      <tr
                        key={candidate.id}
                        onClick={() => setUserId(candidate.id)}
                        className={`cursor-pointer border-b border-line last:border-b-0 transition ${
                          active ? 'bg-emerald-500/[0.06]' : 'hover:bg-card/40'
                        }`}
                      >
                        <td className="px-4 py-2">
                          <span className="flex items-baseline gap-2">
                            <span className="text-xs text-ink">{candidate.name}</span>
                            <span className="font-mono text-2xs text-ink-faint">
                              {candidate.id.replace('user_demo_', '#')}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-2xs text-ink-muted">
                          {candidate.plan}
                          <span className="text-ink-faint"> · {candidate.country}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-2xs text-ink-muted">
                          {bucket ?? '—'}
                        </td>
                        {WATCHED.map((flagKey) => {
                          const result = row[flagKey];
                          const on = result?.value === true;
                          return (
                            <td key={flagKey} className="px-3 py-2">
                              <span
                                className={`inline-flex items-center gap-1.5 font-mono text-2xs ${
                                  on ? 'text-emerald-400' : 'text-ink-faint'
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    on ? 'bg-emerald-500' : 'bg-line-strong'
                                  }`}
                                />
                                {on ? 'NEW' : 'OLD'}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
              <span className="rounded border border-line bg-black/40 px-1.5 py-0.5 font-mono text-2xs text-ink-muted">
                new-checkout-flow:{' '}
                {
                  DEMO_USERS.filter(
                    (candidate) =>
                      cohort[candidate.id]?.['new-checkout-flow']?.value === true,
                  ).length
                }
                /10 accounts
              </span>
              <span className="text-2xs text-ink-faint">
                computed by the server on every change — not a browser guess
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}