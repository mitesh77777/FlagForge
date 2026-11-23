import Link from 'next/link';
import {
  ArrowRight,
  Database,
  GitBranch,
  Github,
  Layers,
  Radio,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { ApiStatusPill } from '@/components/ApiStatusPill';
import { CodeSample } from '@/components/CodeSample';
import { DemoButton } from '@/components/DemoButton';
import { Badge } from '@/components/ui';

const REPO_URL = 'https://github.com/mitesh77777/FlagForge';

const SPECS = [
  {
    icon: Layers,
    title: 'Two-Tier Cache',
    body: 'L1 in-process Map, L2 Redis. PostgreSQL is only touched on a cold miss.',
  },
  {
    icon: GitBranch,
    title: 'Sticky Bucketing',
    body: 'Salted MurmurHash3 (0–99). No assignment table, no drift on ramp.',
  },
  {
    icon: Radio,
    title: 'Instant Fan-Out',
    body: 'Redis Pub/Sub purges every L1 and streams fresh results over SSE.',
  },
  {
    icon: ShieldCheck,
    title: 'Safe AI Rules',
    body: 'Zod-validated AST, then a 1,000-user dry run before anyone publishes.',
  },
] as const;

const WRITE_PATH = [
  { label: 'PostgreSQL', body: 'flag row + version bump, single transaction' },
  { label: 'audit_logs', body: 'before/after appended inside the same transaction' },
  { label: 'Redis Pub/Sub', body: 'flag_invalidation published after commit' },
  { label: 'L1 purge', body: 'every instance drops its snapshot immediately' },
  { label: 'SSE', body: 'per-user evaluated results pushed to every client' },
] as const;

const READ_PATH = [
  { label: 'L1 Map', body: 'sub-millisecond, zero I/O, per instance' },
  { label: 'L2 Redis', body: 'shared snapshot, survives restarts' },
  { label: 'PostgreSQL', body: 'cold fallback only — never on a cache hit' },
  { label: 'MurmurHash3', body: 'hash(flagKey:userId) % 100 → sticky bucket' },
] as const;

const SNIPPET = `import { FlagForgeClient } from '@flagforge/sdk';

const client = new FlagForgeClient({
  apiUrl: 'https://flagforge-api.fly.dev',
  sdkKey: 'ff_live_...',
  userContext: { userId: 'u_4821', attributes: { plan: 'pro', country: 'IN' } },
});

await client.ready;                       // one batch call, then SSE
client.get('new-checkout-flow', false);   // sticks for this user, forever
client.onChange(() => render());          // ~0ms after a flag flip`;

const STACK = [
  'TypeScript',
  'Fastify',
  'PostgreSQL',
  'Redis',
  'Drizzle',
  'Next.js',
  'Docker',
  'Fly.io',
  'Vercel',
];

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect x="2.5" y="3.5" width="19" height="3.2" rx="1.6" fill="#FAFAFA" />
        <rect x="2.5" y="10.4" width="12" height="3.2" rx="1.6" fill="#10B981" />
        <rect
          x="2.5"
          y="17.3"
          width="6.5"
          height="3.2"
          rx="1.6"
          fill="#FAFAFA"
          fillOpacity="0.35"
        />
      </svg>
      <span className="text-sm font-semibold tracking-tight text-ink">
        FlagForge
      </span>
    </span>
  );
}

function PathColumn({
  title,
  steps,
  tone,
}: {
  title: string;
  steps: readonly { label: string; body: string }[];
  tone: 'emerald' | 'neutral';
}) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={tone === 'emerald' ? 'emerald' : 'neutral'}>{title}</Badge>
      </div>
      <ol className="space-y-0">
        {steps.map((step, index) => (
          <li key={step.label} className="relative flex gap-3 pb-3.5 last:pb-0">
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[7px] top-4 h-full w-px bg-line"
              />
            )}
            <span
              className={`relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border ${
                tone === 'emerald'
                  ? 'border-emerald-500/40 bg-emerald-500/15'
                  : 'border-line-strong bg-card'
              }`}
            />
            <span className="min-w-0">
              <span className="block font-mono text-xs text-ink">{step.label}</span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-ink-muted">
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="relative min-h-screen">
      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
          <Link href="/" className="shrink-0">
            <Logo />
          </Link>

          <div className="ml-4 hidden items-center gap-1 md:flex">
            <Link
              href="/login"
              className="rounded px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-card hover:text-ink"
            >
              Sign in
            </Link>
            <a
              href="#architecture"
              className="rounded px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-card hover:text-ink"
            >
              Architecture
            </a>
            <a
              href="#sdk"
              className="rounded px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-card hover:text-ink"
            >
              SDK
            </a>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ApiStatusPill />
            <Link
              href="/signup"
              className="inline-flex h-8 items-center rounded-md border border-ink bg-ink px-3 text-xs font-medium text-black transition hover:bg-white/90"
            >
              Start Free
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="FlagForge on GitHub"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink"
            >
              <Github className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0 ff-grid opacity-70" />
        <div className="pointer-events-none absolute inset-0 ff-halo" />

        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-20 text-center sm:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">
            <Zap className="h-3 w-3 text-emerald-500" />
            Control Plane / Data Plane • Sub-5ms Evaluation
          </span>

          <h1 className="mx-auto mt-7 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Ship behind flags.
            <br />
            Evaluate in under 5ms.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-sm leading-relaxed text-ink-muted sm:text-base">
            A deterministic feature flag engine powered by two-tier L1/Redis
            caching, Pub/Sub invalidation, and real-time SSE streaming.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex h-11 items-center justify-center gap-2 rounded-md border border-ink bg-ink px-5 text-sm font-medium text-black transition hover:bg-white/90"
            >
              Start Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <DemoButton />
          </div>

          <p className="mt-4 text-2xs text-ink-muted">
            or{' '}
            <Link
              href="/demo"
              className="text-ink underline underline-offset-4 transition hover:text-emerald-400"
            >
              see a real app where one account gets a feature and another doesn&apos;t
            </Link>
          </p>

          <p className="mt-4 font-mono text-2xs text-ink-faint">
            No signup. A seeded demo project boots with the sandbox.
          </p>
        </div>

        {/* ── Engineering spec strip ───────────────────────────────────────── */}
        <div className="relative mx-auto max-w-6xl px-5 pb-16">
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {SPECS.map((spec) => (
              <div key={spec.title} className="bg-panel p-5 text-left">
                <spec.icon className="h-4 w-4 text-emerald-500" />
                <h2 className="mt-3 text-sm font-medium text-ink">
                  {spec.title}
                </h2>
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-muted">
                  {spec.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Architecture ───────────────────────────────────────────────────── */}
      <section id="architecture" className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="mb-8 max-w-2xl">
            <Badge>Architecture</Badge>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Writes are transactional. Reads never touch the database.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Cache propagation happens strictly after commit, L1 is purged before
              the invalidation is published, and the data plane resolves snapshots
              from memory on every cache hit.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-4">
              <PathColumn title="Write Path" steps={WRITE_PATH} tone="emerald" />
              <PathColumn title="Read Path" steps={READ_PATH} tone="neutral" />
            </div>

            <div id="sdk" className="min-w-0 space-y-4">
              <CodeSample code={SNIPPET} filename="app.ts" />

              <div className="rounded-lg border border-line bg-panel p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-xs font-medium text-ink">
                    One SDK, no rule engine in the browser
                  </span>
                </div>
                <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
                  The stream is opened with the user&apos;s context, so the server
                  pushes <span className="font-mono text-ink">already-evaluated</span>{' '}
                  results. The client never ships the evaluator, and a flag flip
                  arrives in one frame with no refetch.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="emerald">
                    <Zap className="h-3 w-3" /> L1-HIT
                  </Badge>
                  <Badge tone="amber">
                    <Layers className="h-3 w-3" /> L2-HIT
                  </Badge>
                  <Badge tone="red">
                    <Database className="h-3 w-3" /> DB-FALLBACK
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Flip a flag. Watch the cache fan out.
          </h2>
          <p className="max-w-xl text-sm text-ink-muted">
            The sandbox runs a real control plane against a real data plane. Every
            toggle, slider and AI-compiled rule goes through PostgreSQL, the audit
            log, Redis Pub/Sub and SSE.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-ink bg-ink px-5 text-sm font-medium text-black transition hover:bg-white/90"
            >
              Start Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <DemoButton />
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-md text-2xs leading-relaxed text-ink-muted">
              Production evaluation engine running on a seeded demo dataset. All
              flag keys, users and audit entries shown here are synthetic.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5 sm:max-w-md sm:justify-end">
            {STACK.map((item) => (
              <span
                key={item}
                className="rounded border border-line bg-card px-2 py-0.5 font-mono text-2xs text-ink-faint"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-line pt-5 font-mono text-2xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <span>v1.0.0 · MIT</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-ink"
          >
            <Github className="h-3 w-3" />
            mitesh77777/FlagForge
          </a>
        </div>
      </footer>
    </div>
  );
}
