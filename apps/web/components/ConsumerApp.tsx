'use client';

import {
  Building2,
  Check,
  CreditCard,
  Crown,
  Moon,
  Radio,
  Search,
  Sparkles,
  Sun,
  Users,
  Zap,
} from 'lucide-react';
import type { EvaluationResult } from '@flagforge/evaluator';
import type { FlagResult } from '@flagforge/sdk';
import type { CohortUser } from '@/lib/cohort';
import type { Telemetry } from '@/hooks/useEnvironmentStream';
import { Chip, TelemetryBadge } from './ui';

export interface CohortEvaluation {
  user: CohortUser;
  results: Record<string, EvaluationResult>;
}

const SUMMARY_FLAGS = [
  { key: 'new-checkout-flow', short: 'CHK', label: 'New checkout' },
  { key: 'ai-search-beta', short: 'AI', label: 'AI search' },
  { key: 'pricing-page-v2', short: 'PRC', label: 'Pricing v2' },
  { key: 'dark-mode-default', short: 'DRK', label: 'Dark default' },
] as const;

function isOn(value: unknown): boolean {
  return value === true;
}

export interface ConsumerAppProps {
  evaluations: CohortEvaluation[];
  selectedUserId: string;
  onSelectUser: (id: string) => void;
  heroResults: Record<string, FlagResult>;
  heroConnected: boolean;
  telemetry: Telemetry;
  error: string | null;
}

export function ConsumerApp({
  evaluations,
  selectedUserId,
  onSelectUser,
  heroResults,
  heroConnected,
  telemetry,
  error,
}: ConsumerAppProps) {
  const selected =
    evaluations.find((entry) => entry.user.userId === selectedUserId) ??
    evaluations[0];

  const heroValue = (key: string, fallback = false): unknown => {
    const live = heroResults[key];
    if (live) return live.value;
    return selected?.results[key]?.value ?? fallback;
  };

  const heroReason = (key: string): string | null => {
    const live = heroResults[key];
    if (live) return live.reason;
    return selected?.results[key]?.reason ?? null;
  };

  const pricingV2 = isOn(heroValue('pricing-page-v2'));
  const checkout = isOn(heroValue('new-checkout-flow'));
  const aiSearch = isOn(heroValue('ai-search-beta'));
  const dark = heroValue('dark-mode-default', true) !== false;
  const selectedPlan = selected?.user.plan ?? 'free';

  const counts = SUMMARY_FLAGS.map((flag) => ({
    ...flag,
    count: evaluations.filter((entry) => isOn(entry.results[flag.key]?.value))
      .length,
  }));

  return (
    <div className="flex h-full flex-col gap-5">
      {/* Connection / telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              heroConnected ? 'bg-emerald-400 animate-pulse-soft' : 'bg-zinc-600'
            }`}
          />
          <span className="font-mono text-[10px] text-zinc-500">
            SSE {heroConnected ? 'live' : 'connecting…'}
          </span>
        </div>
        <TelemetryBadge
          cacheStatus={telemetry.cacheStatus}
          evalMs={telemetry.evalMs}
          version={telemetry.version}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1.5 text-[10px] text-amber-200/90">
          {error}
        </div>
      )}

      {/* User selector */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-ink-850/70 p-2.5">
        <Users className="ml-1 h-3.5 w-3.5 text-zinc-500" />
        <span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-500">
          Acting as
        </span>
        <select
          value={selectedUserId}
          onChange={(event) => onSelectUser(event.target.value)}
          className="flex-1 rounded-md border border-zinc-800 bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-200 focus:border-emerald-400/40 focus:outline-none"
        >
          {evaluations.map(({ user }) => (
            <option key={user.userId} value={user.userId}>
              {user.userId} · {user.plan} · {user.country} · v{user.appVersion}
            </option>
          ))}
        </select>
        <Chip tone="cyan">{selectedPlan}</Chip>
      </div>

      {/* ── Simulated pricing / checkout surface ─────────────────────────── */}
      <div
        className={`overflow-hidden rounded-2xl border transition-colors ${
          dark
            ? 'border-zinc-800 bg-ink-900'
            : 'border-zinc-300 bg-zinc-100 text-zinc-900'
        }`}
      >
        <div
          className={`flex items-center justify-between border-b px-4 py-3 ${
            dark ? 'border-zinc-800' : 'border-zinc-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <div
              className={`grid h-7 w-7 place-items-center rounded-lg ${
                dark ? 'bg-emerald-400/10' : 'bg-emerald-500/15'
              }`}
            >
              <Building2
                className={`h-4 w-4 ${dark ? 'text-emerald-300' : 'text-emerald-600'}`}
              />
            </div>
            <div>
              <div className="text-xs font-semibold">Acme Cloud</div>
              <div
                className={`font-mono text-[9px] ${
                  dark ? 'text-zinc-500' : 'text-zinc-500'
                }`}
              >
                {pricingV2 ? 'pricing-v2' : 'pricing-classic'} ·{' '}
                {checkout ? 'checkout-v2' : 'checkout-legacy'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {dark ? (
              <Moon className={`h-3.5 w-3.5 ${dark ? 'text-zinc-400' : ''}`} />
            ) : (
              <Sun className="h-3.5 w-3.5 text-amber-500" />
            )}
            <span
              className={`font-mono text-[9px] ${
                dark ? 'text-zinc-500' : 'text-zinc-500'
              }`}
            >
              {dark ? 'dark' : 'light'}
            </span>
          </div>
        </div>

        <div className="p-4">
          {aiSearch && (
            <div
              className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 ${
                dark
                  ? 'border-violet-400/25 bg-violet-400/[0.06]'
                  : 'border-violet-300 bg-violet-50'
              }`}
            >
              <Search className="h-3.5 w-3.5 text-violet-400" />
              <span
                className={`text-[11px] ${
                  dark ? 'text-violet-200/80' : 'text-violet-700'
                }`}
              >
                Ask AI: “which plan fits a 40-person team?”
              </span>
              <Sparkles className="ml-auto h-3 w-3 text-violet-400" />
            </div>
          )}

          <div className="mb-3 flex items-end justify-between">
            <div>
              <h3 className="text-sm font-semibold">
                {pricingV2 ? 'Simple, usage-based pricing' : 'Plans & pricing'}
              </h3>
              <p
                className={`mt-0.5 text-[10px] ${
                  dark ? 'text-zinc-500' : 'text-zinc-500'
                }`}
              >
                {pricingV2
                  ? 'New information architecture A/B test'
                  : 'Classic pricing page'}
              </p>
            </div>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                pricingV2
                  ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                  : dark
                    ? 'border-zinc-700 text-zinc-500'
                    : 'border-zinc-300 text-zinc-500'
              }`}
            >
              {heroReason('pricing-page-v2') ?? '—'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { name: 'Starter', price: '$0', icon: Zap },
              { name: 'Pro', price: '$24', icon: CreditCard },
              { name: 'Scale', price: '$99', icon: Crown },
            ].map((tier, index) => {
              const highlighted = pricingV2 && index === 1;
              return (
                <div
                  key={tier.name}
                  className={`rounded-lg border p-2.5 ${
                    highlighted
                      ? dark
                        ? 'border-emerald-400/40 bg-emerald-400/[0.07]'
                        : 'border-emerald-500 bg-emerald-50'
                      : dark
                        ? 'border-zinc-800 bg-black/20'
                        : 'border-zinc-300 bg-white'
                  }`}
                >
                  <tier.icon
                    className={`h-3.5 w-3.5 ${
                      highlighted ? 'text-emerald-400' : 'text-zinc-500'
                    }`}
                  />
                  <div className="mt-1.5 text-[11px] font-medium">{tier.name}</div>
                  <div className="font-mono text-sm">
                    {tier.price}
                    <span className="text-[9px] opacity-60">/mo</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${
              checkout
                ? dark
                  ? 'border-emerald-400/25 bg-emerald-400/[0.06]'
                  : 'border-emerald-300 bg-emerald-50'
                : dark
                  ? 'border-zinc-800 bg-black/20'
                  : 'border-zinc-300 bg-white'
            }`}
          >
            <Check
              className={`h-3.5 w-3.5 ${
                checkout ? 'text-emerald-400' : 'text-zinc-500'
              }`}
            />
            <span className="text-[11px]">
              {checkout ? 'One-page checkout enabled' : 'Legacy multi-step checkout'}
            </span>
            <span className="ml-auto font-mono text-[9px] text-zinc-500">
              {heroReason('new-checkout-flow') ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Cohort grid ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            <Radio className="h-3.5 w-3.5" />
            Live cohort · 20 users
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {counts.map((flag) => (
              <span
                key={flag.key}
                title={flag.label}
                className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400"
              >
                {flag.short} {flag.count}/20
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {evaluations.map(({ user, results }) => {
            const active = user.userId === selectedUserId;
            return (
              <button
                key={user.userId}
                type="button"
                onClick={() => onSelectUser(user.userId)}
                className={`rounded-lg border px-2.5 py-2 text-left transition ${
                  active
                    ? 'border-emerald-400/50 bg-emerald-400/[0.06]'
                    : 'border-zinc-800 bg-ink-850/60 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-mono text-[10px] text-zinc-300">
                    {user.userId.replace('user_demo_', '#')}
                  </span>
                  <span
                    className={`rounded px-1 py-0.5 text-[8px] uppercase tracking-wide ${
                      user.plan === 'enterprise'
                        ? 'bg-violet-400/10 text-violet-300'
                        : user.plan === 'pro'
                          ? 'bg-cyan-400/10 text-cyan-300'
                          : 'bg-zinc-700/40 text-zinc-400'
                    }`}
                  >
                    {user.plan}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-zinc-600">
                  {user.country} · v{user.appVersion}
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {SUMMARY_FLAGS.map((flag) => {
                    const on = isOn(results[flag.key]?.value);
                    return (
                      <span
                        key={flag.key}
                        title={`${flag.label}: ${on ? 'on' : 'off'} (${results[flag.key]?.reason ?? 'n/a'})`}
                        className={`h-1.5 rounded-full ${
                          on ? 'bg-emerald-400' : 'bg-zinc-700'
                        }`}
                      />
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}