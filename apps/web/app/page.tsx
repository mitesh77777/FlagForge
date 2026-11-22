import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  GitBranch,
  Radio,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Zap,
    title: 'Two-tier hot path',
    body: 'L1 in-process Map, L2 Redis, PostgreSQL only on a cold miss. Evaluation never touches the database on a cache hit.',
  },
  {
    icon: Radio,
    title: 'Instant invalidation',
    body: 'Redis Pub/Sub purges every instance’s L1 and pushes fresh, per-user evaluated results over SSE. Zero polling.',
  },
  {
    icon: GitBranch,
    title: 'Sticky bucketing',
    body: 'MurmurHash3 salted with the flag key gives uniform, independent, deterministic rollouts. No DB-backed assignment table.',
  },
  {
    icon: Sparkles,
    title: 'AI rule compiler',
    body: 'Natural language → strict Zod-validated rule AST, dry-run against 1,000 synthetic users, then human approval.',
  },
  {
    icon: ShieldCheck,
    title: 'Immutable audit trail',
    body: 'Every mutation and its before/after JSON is written in the same transaction as the flag change.',
  },
  {
    icon: Boxes,
    title: 'Control / data split',
    body: 'Low-frequency management writes are isolated from high-throughput reads, so traffic spikes never contend with edits.',
  },
];

export default function LandingPage() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-radial-fade" />

      <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-16">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-400/30 bg-emerald-400/10">
              <Boxes className="h-5 w-5 text-emerald-300" />
            </div>
            <span className="text-sm font-semibold tracking-wide text-zinc-100">
              FlagForge
            </span>
          </div>
          <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
            Data plane healthy
          </div>
        </header>

        <section className="mx-auto mt-20 max-w-3xl text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400">
            <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
            Lean LaunchDarkly alternative · control plane / data plane
          </div>

          <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Ship features safely,
            <span className="block bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text text-transparent">
              at production speed.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg">
            Feature flags with deterministic percentage rollouts, instant Redis
            invalidation, live SSE streaming, and an AI rule compiler that proves
            its blast radius before anyone clicks publish.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/sandbox"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-emerald-950 shadow-[0_0_32px_-6px_rgba(52,211,153,0.55)] transition hover:bg-emerald-300 sm:w-auto"
            >
              Launch Live Sandbox
              <span className="text-xs font-normal opacity-70">No login required</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#architecture"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white sm:w-auto"
            >
              See the architecture
            </a>
          </div>
        </section>

        <section className="mx-auto mt-14 max-w-4xl overflow-hidden rounded-2xl border border-zinc-800/80 bg-ink-900/70 shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-zinc-800/70 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-3 font-mono text-xs text-zinc-500">
              POST /v1/evaluate
            </span>
            <span className="ml-auto rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              L1-HIT · 0.18ms
            </span>
          </div>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-zinc-400">
{`{
  "key": "new-checkout-flow",
  "value": true,
  "reason": "RULE_MATCH",
  "ruleId": "rule_pro_geo",
  "bucket": 37,
  "version": 4
}`}
          </pre>
        </section>

        <section id="architecture" className="mt-24">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                Built like a reliability product
              </h2>
              <p className="mt-2 text-sm text-zinc-500">
                Strict planes, bounded staleness, deterministic results.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-zinc-800/80 bg-ink-900/60 p-5 transition hover:border-zinc-700"
              >
                <feature.icon className="h-5 w-5 text-emerald-300" />
                <h3 className="mt-3 text-sm font-semibold text-zinc-100">
                  {feature.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-24 flex flex-col items-center justify-between gap-3 border-t border-zinc-900 pt-6 text-xs text-zinc-600 sm:flex-row">
          <span>FlagForge · demo instance · all data is synthetic</span>
          <span className="font-mono">v1.0.0</span>
        </footer>
      </div>
    </main>
  );
}