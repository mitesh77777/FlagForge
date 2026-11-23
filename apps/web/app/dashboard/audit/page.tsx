'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, History, Loader2, RefreshCw } from 'lucide-react';
import { api, type ApiAuditLog } from '@/lib/api';
import { Badge, Button, StatusDot } from '@/components/ui';
import { useWorkspace } from '@/components/dashboard/WorkspaceProvider';

function formatValue(value: unknown): string {
  if (value === true) return 'on';
  if (value === false) return 'off';
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'changed';
  return String(value);
}

/** Turn a before/after pair into human-readable lines (no raw JSON). */
function summarize(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const lines: string[] = [];

  for (const key of keys) {
    const beforeValue = b[key];
    const afterValue = a[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    if (
      (Array.isArray(beforeValue) || Array.isArray(afterValue)) &&
      key === 'rules'
    ) {
      const from = Array.isArray(beforeValue) ? beforeValue.length : 0;
      const to = Array.isArray(afterValue) ? afterValue.length : 0;
      lines.push(`rules: ${from} → ${to}`);
    } else {
      lines.push(`${key}: ${formatValue(beforeValue)} → ${formatValue(afterValue)}`);
    }
  }

  return lines.slice(0, 4);
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function actionTone(action: string): 'emerald' | 'red' | 'amber' | 'neutral' {
  if (action.includes('created')) return 'emerald';
  if (action.includes('deleted')) return 'red';
  if (action.includes('toggled')) return 'amber';
  return 'neutral';
}

export default function AuditPage() {
  const { environment, project } = useWorkspace();
  const [logs, setLogs] = useState<ApiAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!environment) {
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { auditLogs } = await api.audit.list(environment.id, 100);
      setLogs(auditLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Audit Log</h1>
          <p className="mt-1 text-2xs text-ink-muted">
            Every mutation in {project?.name} ·{' '}
            <span className="font-mono">{environment?.name}</span>
          </p>
        </div>
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-10 text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-mono text-2xs">loading history…</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded border border-dashed border-line px-4 py-14 text-center">
          <History className="mx-auto h-5 w-5 text-ink-faint" />
          <p className="mt-3 text-sm text-ink">No changes yet</p>
          <p className="mt-1 text-2xs text-ink-muted">
            Toggle a flag and it will appear here immediately.
          </p>
        </div>
      ) : (
        <ol className="overflow-hidden rounded border border-line bg-panel">
          {logs.map((log, index) => {
            const changes = summarize(log.beforeJson, log.afterJson);
            return (
              <li
                key={log.id}
                className="relative flex gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <span className="relative flex w-3 shrink-0 justify-center">
                  {index < logs.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-3 h-full w-px bg-line"
                    />
                  )}
                  <StatusDot
                    tone={
                      actionTone(log.action) === 'emerald'
                        ? 'emerald'
                        : actionTone(log.action) === 'red'
                          ? 'red'
                          : actionTone(log.action) === 'amber'
                            ? 'amber'
                            : 'neutral'
                    }
                    className="mt-1.5"
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={actionTone(log.action)}>{log.action}</Badge>
                    <span className="truncate font-mono text-2xs text-ink">
                      {log.flagKey}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-2xs text-ink-faint">
                      <Clock className="h-2.5 w-2.5" />
                      {timeAgo(log.createdAt)}
                    </span>
                  </div>

                  {changes.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {changes.map((change) => (
                        <span
                          key={change}
                          className="rounded border border-line bg-black/40 px-1.5 py-0.5 font-mono text-2xs text-ink-muted"
                        >
                          {change}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="mt-1.5 truncate font-mono text-2xs text-ink-faint">
                    {log.actorEmail}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}