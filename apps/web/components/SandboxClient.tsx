'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Boxes,
  Database,
  Layers,
  Loader2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { evaluateAll, type FlagConfig } from '@flagforge/evaluator';
import { ControlPlane } from '@/components/ControlPlane';
import { ConsumerApp, type CohortEvaluation } from '@/components/ConsumerApp';
import { Chip, TelemetryBadge } from '@/components/ui';
import { useEnvironmentStream } from '@/hooks/useEnvironmentStream';
import { useUserFlags } from '@/hooks/useUserFlags';
import { API_URL, api, type AuditLogView, type CompileResponse, type FlagView, type SandboxResponse } from '@/lib/api';
import { COHORT, toContext } from '@/lib/cohort';

export function SandboxClient() {
  const [sandbox, setSandbox] = useState<SandboxResponse | null>(null);
  const [envId, setEnvId] = useState<string | null>(null);
  const [flags, setFlags] = useState<FlagView[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogView[]>([]);
  const [selectedFlagKey, setSelectedFlagKey] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState(COHORT[0]!.userId);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [aiMode, setAiMode] = useState<string | null>(null);

  // ── Bootstrap the seeded demo project ─────────────────────────────────────
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await api.sandbox();
        if (!active) return;
        setSandbox(data);
        const prod =
          data.environments.find((environment) => environment.name === 'prod') ??
          data.environments[0];
        if (prod) setEnvId(prod.id);

        const status = await api.aiStatus().catch(() => null);
        if (active && status) setAiMode(status.mode);
      } catch (err) {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : 'failed to load the sandbox',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // ── Load flags + audit whenever the environment changes ───────────────────
  useEffect(() => {
    if (!envId) return;
    let active = true;
    void (async () => {
      try {
        const [flagsResponse, auditResponse] = await Promise.all([
          api.environmentFlags(envId),
          api.auditLogs(envId),
        ]);
        if (!active) return;
        setFlags(flagsResponse.flags);
        setAuditLogs(auditResponse.auditLogs);
        setSelectedFlagKey((previous) =>
          previous && flagsResponse.flags.some((flag) => flag.key === previous)
            ? previous
            : (flagsResponse.flags[0]?.key ?? null),
        );
        setCompileResult(null);
      } catch (err) {
        if (active) {
          setActionError(
            err instanceof Error ? err.message : 'failed to load environment',
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [envId]);

  const activeEnvironment = sandbox?.environments.find((e) => e.id === envId);
  const sdkKey =
    sandbox && activeEnvironment
      ? sandbox.demoKeys[activeEnvironment.name === 'dev' ? 'dev' : 'prod']
      : null;

  // ── Live data planes ──────────────────────────────────────────────────────
  const { flags: configFlags, telemetry, error: streamError } =
    useEnvironmentStream(sdkKey);

  const selectedUser =
    COHORT.find((user) => user.userId === selectedUserId) ?? COHORT[0]!;
  const { snapshot: heroSnapshot, connected: heroConnected } = useUserFlags(
    sdkKey,
    selectedUser,
  );

  const evaluations: CohortEvaluation[] = useMemo(
    () =>
      COHORT.map((user) => ({
        user,
        results: evaluateAll(
          configFlags as Record<string, FlagConfig>,
          toContext(user),
        ),
      })),
    [configFlags],
  );

  const selectedFlag =
    flags.find((flag) => flag.key === selectedFlagKey) ?? null;

  // ── Mutations (control plane) ─────────────────────────────────────────────
  const applyPatch = async (
    flag: FlagView,
    patch: Partial<Pick<FlagView, 'enabled' | 'rules' | 'overrides'>>,
  ): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      const { flag: updated } = await api.patchFlag(flag.id, patch);
      setFlags((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (envId) {
        const { auditLogs: fresh } = await api.auditLogs(envId);
        setAuditLogs(fresh);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = (flag: FlagView): void => {
    void applyPatch(flag, { enabled: !flag.enabled });
  };

  const handleRollout = (
    flag: FlagView,
    ruleId: string | null,
    percentage: number,
  ): void => {
    let nextRules = flag.rules;
    if (ruleId === null) {
      if (flag.rules.length === 0) {
        nextRules = [
          {
            id: 'rule_all_users',
            description: 'All users (catch-all)',
            conditions: [],
            matchType: 'AND',
            rolloutPercentage: percentage,
            serveValue: true,
          },
        ];
      } else {
        const lastIndex = flag.rules.length - 1;
        nextRules = flag.rules.map((rule, index) =>
          index === lastIndex ? { ...rule, rolloutPercentage: percentage } : rule,
        );
      }
    } else {
      nextRules = flag.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, rolloutPercentage: percentage } : rule,
      );
    }
    void applyPatch(flag, { rules: nextRules });
  };

  const handleOverrides = (
    flag: FlagView,
    overrides: { allowlist: string[]; blocklist: string[] },
  ): void => {
    void applyPatch(flag, { overrides });
  };

  const handleCompile = async (prompt: string): Promise<void> => {
    if (!selectedFlag) return;
    setCompiling(true);
    setActionError(null);
    try {
      const result = await api.compileRule(
        prompt,
        selectedFlag.key,
        selectedFlag.rules[0],
      );
      setCompileResult(result);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'compilation failed');
    } finally {
      setCompiling(false);
    }
  };

  const handleApprove = async (): Promise<void> => {
    if (!selectedFlag || !compileResult || publishing) return;
    setPublishing(true);
    setActionError(null);
    try {
      const rule = compileResult.compiledRule;
      const nextRules = [
        rule,
        ...selectedFlag.rules.filter((existing) => existing.id !== rule.id),
      ];
      await applyPatch(selectedFlag, { enabled: true, rules: nextRules });
      setCompileResult(null);
    } finally {
      setPublishing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-zinc-900 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-zinc-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>

          <div className="mx-1 h-5 w-px bg-zinc-800" />

          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg border border-emerald-400/25 bg-emerald-400/10">
              <Boxes className="h-4 w-4 text-emerald-300" />
            </div>
            <span className="text-sm font-semibold text-zinc-100">FlagForge</span>
            <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-500">
              live sandbox
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {sandbox && (
              <>
                <span className="hidden text-[11px] text-zinc-500 sm:inline">
                  {sandbox.project.name}
                </span>
                <select
                  value={envId ?? ''}
                  onChange={(event) => setEnvId(event.target.value)}
                  className="rounded-md border border-zinc-800 bg-ink-900 px-2 py-1 font-mono text-[11px] text-zinc-300 focus:border-emerald-400/40 focus:outline-none"
                >
                  {sandbox.environments.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <TelemetryBadge
              cacheStatus={telemetry.cacheStatus}
              evalMs={telemetry.evalMs}
              version={telemetry.version}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-4">
        {loading && (
          <div className="grid place-items-center py-32 text-sm text-zinc-500">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading seeded demo project…
            </div>
          </div>
        )}

        {!loading && loadError && (
          <div className="mx-auto max-w-xl rounded-2xl border border-rose-400/25 bg-rose-400/[0.05] p-6 text-center">
            <h2 className="text-sm font-semibold text-rose-200">
              Could not load the sandbox
            </h2>
            <p className="mt-2 text-xs text-rose-200/70">{loadError}</p>
            <p className="mt-3 font-mono text-[10px] text-zinc-500">
              {API_URL}/api/sandbox
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/20"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <div className="grid gap-4 xl:grid-cols-2">
            {/* Left pane — control plane */}
            <section className="rounded-2xl border border-zinc-800/80 bg-ink-900/50">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <h1 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                  Control Plane
                </h1>
                <span className="font-mono text-[9px] text-zinc-600">
                  writes → postgres → audit → redis → pub/sub
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Chip tone="green">/api</Chip>
                  {busy && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />
                  )}
                </div>
              </div>

              <div className="p-4 lg:max-h-[calc(100vh-11.5rem)] lg:overflow-y-auto">
                <ControlPlane
                  flags={flags}
                  selectedFlagKey={selectedFlagKey}
                  onSelectFlag={setSelectedFlagKey}
                  onToggle={handleToggle}
                  onRollout={handleRollout}
                  onOverrides={handleOverrides}
                  onCompile={handleCompile}
                  onApprove={() => void handleApprove()}
                  onDismissCompile={() => setCompileResult(null)}
                  compileResult={compileResult}
                  compiling={compiling}
                  publishing={publishing}
                  auditLogs={auditLogs}
                  busy={busy}
                  aiMode={aiMode}
                  error={actionError}
                />
              </div>
            </section>

            {/* Right pane — data plane */}
            <section className="rounded-2xl border border-zinc-800/80 bg-ink-900/50">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
                <Radio className="h-4 w-4 text-cyan-300" />
                <h1 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                  Data Plane
                </h1>
                <span className="font-mono text-[9px] text-zinc-600">
                  reads ← L1 → L2 → SSE
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <Chip tone="cyan">/v1</Chip>
                  <Chip tone="neutral">
                    <Layers className="h-2.5 w-2.5" /> 2-tier
                  </Chip>
                  <Chip tone="neutral">
                    <Database className="h-2.5 w-2.5" /> cold fallback
                  </Chip>
                </div>
              </div>

              <div className="p-4 lg:max-h-[calc(100vh-11.5rem)] lg:overflow-y-auto">
                <ConsumerApp
                  evaluations={evaluations}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  heroResults={heroSnapshot.results}
                  heroConnected={heroConnected}
                  telemetry={telemetry}
                  error={streamError}
                />
              </div>
            </section>
          </div>
        )}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-900 pt-4 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1.5">
            <Zap className="h-3 w-3" />
            Flip a kill switch, drag a rollout, or approve an AI rule — the right
            pane updates over SSE with no page refresh.
          </span>
          <span className="font-mono">
            demo keys: guest mode · seeded {(sandbox?.flagsByEnvironment[envId ?? ''] ?? []).length}{' '}
            flags
          </span>
        </footer>
      </main>
    </div>
  );
}