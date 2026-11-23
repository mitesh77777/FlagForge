'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlaskConical,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { api, type ApiFlag, type PlaygroundResult } from '@/lib/api';
import {
  Badge,
  Button,
  CacheStatusBadge,
  CopyButton,
  LatencyBadge,
  StatusDot,
} from '@/components/ui';
import { useWorkspace } from '@/components/dashboard/WorkspaceProvider';

interface AttributeRow {
  id: number;
  key: string;
  value: string;
}

const FIELD =
  'w-full min-w-0 rounded border border-line bg-black px-2 py-1.5 font-mono text-2xs text-ink placeholder:text-ink-faint focus:border-emerald-500/50 focus:outline-none';

function coerce(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}

const REASON_TONE: Record<string, 'emerald' | 'amber' | 'red' | 'neutral'> = {
  RULE_MATCH: 'emerald',
  EXPLICIT_ALLOWLIST: 'emerald',
  DEFAULT_FALLBACK: 'neutral',
  EXPLICIT_BLOCKLIST: 'red',
  KILL_SWITCH_OFF: 'red',
};

export default function PlaygroundPage() {
  const { environment, project, environment: activeEnvironment } = useWorkspace();

  const [flags, setFlags] = useState<ApiFlag[]>([]);
  const [flagKey, setFlagKey] = useState('');
  const [userId, setUserId] = useState('user_demo_001');
  const [rows, setRows] = useState<AttributeRow[]>([
    { id: 1, key: 'plan', value: 'pro' },
    { id: 2, key: 'country', value: 'IN' },
    { id: 3, key: 'appVersion', value: '2.4.1' },
  ]);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [running, setRunning] = useState(false);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextRowId = useRef(4);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!environment) return;
      try {
        const { flags: list } = await api.flags.list(environment.id);
        if (cancelled) return;
        setFlags(list);
        setFlagKey((current) =>
          current && list.some((flag) => flag.key === current)
            ? current
            : (list[0]?.key ?? ''),
        );
      } catch {
        if (!cancelled) setFlags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environment]);

  const attributes = useMemo(() => {
    const out: Record<string, string | number | boolean> = {};
    for (const row of rows) {
      if (row.key.trim().length > 0) out[row.key.trim()] = coerce(row.value);
    }
    return out;
  }, [rows]);

  const evaluate = useCallback(async () => {
    if (!activeEnvironment || !flagKey) return;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await api.playground(activeEnvironment.id, {
          key: flagKey,
          userId,
          attributes,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'evaluation failed');
    } finally {
      setRunning(false);
    }
  }, [activeEnvironment, flagKey, userId, attributes]);

  useEffect(() => {
    if (!auto) return;
    void evaluate();
    const timer = setInterval(() => void evaluate(), 2000);
    return () => clearInterval(timer);
  }, [auto, evaluate]);

  const selectedFlag = flags.find((flag) => flag.key === flagKey);

  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Live Playground
          </h1>
          <p className="mt-1 text-2xs text-ink-muted">
            Evaluate your own flags through the same engine the data plane uses ·{' '}
            <span className="font-mono">{environment?.name}</span>
          </p>
        </div>
        <Button onClick={() => setAuto((value) => !value)}>
          {auto ? (
            <StatusDot tone="emerald" pulse />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {auto ? 'Live polling on' : 'Live polling off'}
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Inputs */}
        <section className="rounded border border-line bg-panel p-4">
          <div className="space-y-4">
            <div>
              <label htmlFor="pg-flag" className="mb-1.5 block text-2xs text-ink-muted">
                Flag
              </label>
              <select
                id="pg-flag"
                value={flagKey}
                onChange={(event) => setFlagKey(event.target.value)}
                className="w-full rounded border border-line bg-black px-2.5 py-2 font-mono text-xs text-ink focus:border-emerald-500/50 focus:outline-none"
              >
                {flags.length === 0 && <option value="">No flags</option>}
                {flags.map((flag) => (
                  <option key={flag.id} value={flag.key}>
                    {flag.key}
                  </option>
                ))}
              </select>
              {selectedFlag && (
                <p className="mt-1 font-mono text-2xs text-ink-faint">
                  v{selectedFlag.version} · {selectedFlag.enabled ? 'enabled' : 'kill-switched'} ·{' '}
                  {selectedFlag.rules.length} rule
                  {selectedFlag.rules.length === 1 ? '' : 's'}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="pg-user" className="mb-1.5 block text-2xs text-ink-muted">
                User ID
              </label>
              <input
                id="pg-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                className={FIELD}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-2xs text-ink-muted">Attributes</span>
                <button
                  type="button"
                  onClick={() => {
                    const id = nextRowId.current++;
                    setRows((current) => [
                      ...current,
                      { id, key: 'betaOptIn', value: 'true' },
                    ]);
                  }}
                  className="flex items-center gap-1 text-2xs text-ink-muted transition hover:text-ink"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>

              <div className="space-y-1.5">
                {rows.map((row) => (
                  <div key={row.id} className="flex gap-1.5">
                    <input
                      value={row.key}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item) =>
                            item.id === row.id
                              ? { ...item, key: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="attribute"
                      className={`${FIELD} w-28 flex-none`}
                    />
                    <input
                      value={row.value}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item) =>
                            item.id === row.id
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="value"
                      className={`${FIELD} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((item) => item.id !== row.id),
                        )
                      }
                      aria-label="remove attribute"
                      className="px-1 text-ink-faint transition hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <Button
              variant="primary"
              className="w-full"
              onClick={() => void evaluate()}
              disabled={running || !flagKey}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Evaluate
            </Button>
          </div>
        </section>

        {/* Result */}
        <section className="rounded border border-line bg-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted">
              Decision
            </span>
            {result && (
              <span className="ml-auto flex items-center gap-1.5">
                <CacheStatusBadge status={result.cacheStatus} />
                <LatencyBadge ms={result.evalMs} />
              </span>
            )}
          </div>

          {!result ? (
            <div className="grid place-items-center rounded border border-dashed border-line py-14 text-center">
              <Zap className="h-5 w-5 text-ink-faint" />
              <p className="mt-2 text-2xs text-ink-muted">
                Run an evaluation to see the real decision.
              </p>
            </div>
          ) : (
            <div className="animate-fade-up space-y-3">
              <div className="rounded border border-line bg-black p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-2xs text-ink-faint">
                    {result.key}
                  </span>
                  <Badge tone={REASON_TONE[result.reason] ?? 'neutral'}>
                    {result.reason}
                  </Badge>
                </div>
                <div className="mt-2 flex items-end gap-3">
                  <span
                    className={`font-mono text-3xl font-semibold leading-none ${
                      result.value === true ? 'text-emerald-400' : 'text-ink'
                    }`}
                  >
                    {String(result.value)}
                  </span>
                  <CopyButton
                    text={JSON.stringify({ key: result.key, value: result.value })}
                    label="Copy result"
                    className="mb-1"
                  />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2">
                <div className="rounded border border-line bg-black/40 px-2.5 py-2">
                  <dt className="text-2xs uppercase tracking-wide text-ink-faint">
                    MurmurHash bucket
                  </dt>
                  <dd className="font-mono text-sm text-ink">
                    {result.bucket === null ? '—' : `${result.bucket}`}
                    {result.bucket !== null && (
                      <span className="text-2xs text-ink-faint"> / 100</span>
                    )}
                  </dd>
                </div>
                <div className="rounded border border-line bg-black/40 px-2.5 py-2">
                  <dt className="text-2xs uppercase tracking-wide text-ink-faint">
                    Rule
                  </dt>
                  <dd className="truncate font-mono text-2xs text-ink">
                    {result.ruleId ?? '—'}
                  </dd>
                </div>
                <div className="rounded border border-line bg-black/40 px-2.5 py-2">
                  <dt className="text-2xs uppercase tracking-wide text-ink-faint">
                    Version
                  </dt>
                  <dd className="font-mono text-sm text-ink">v{result.version}</dd>
                </div>
                <div className="rounded border border-line bg-black/40 px-2.5 py-2">
                  <dt className="text-2xs uppercase tracking-wide text-ink-faint">
                    Latency
                  </dt>
                  <dd className="font-mono text-sm text-ink">
                    {result.evalMs}
                    <span className="text-2xs text-ink-faint">ms</span>
                  </dd>
                </div>
              </dl>

              <p className="text-2xs leading-relaxed text-ink-faint">
                Change the user or attributes and evaluate again — the bucket is
                derived from{' '}
                <span className="font-mono text-ink-muted">
                  murmur3({result.key}:{userId}) % 100
                </span>
                , so the same user is always in the same cohort.
              </p>
            </div>
          )}

          <p className="mt-3 border-t border-line pt-3 text-2xs leading-relaxed text-ink-faint">
            Tip: turn on live polling, then toggle this flag in Feature Flags — the
            decision updates without reloading, because the toggle invalidates the
            cache. {project?.name} stays scoped to your account.
          </p>
        </section>
      </div>
    </div>
  );
}