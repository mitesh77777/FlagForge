'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag as FlagIcon,
  History,
  Loader2,
  Plus,
  ShieldBan,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import type { Condition, TargetingRule } from '@flagforge/evaluator';
import type {
  AuditLogView,
  CompileResponse,
  FlagView,
} from '@/lib/api';
import {
  Chip,
  JsonBlock,
  RolloutSlider,
  SectionTitle,
  Switch,
} from './ui';

export interface ControlPlaneProps {
  flags: FlagView[];
  selectedFlagKey: string | null;
  onSelectFlag: (key: string) => void;
  onToggle: (flag: FlagView) => void;
  onRollout: (flag: FlagView, ruleId: string | null, pct: number) => void;
  onOverrides: (
    flag: FlagView,
    overrides: { allowlist: string[]; blocklist: string[] },
  ) => void;
  onCompile: (prompt: string) => Promise<void>;
  onApprove: () => void;
  onDismissCompile: () => void;
  compileResult: CompileResponse | null;
  compiling: boolean;
  publishing: boolean;
  auditLogs: AuditLogView[];
  busy: boolean;
  aiMode: string | null;
  error: string | null;
}

function conditionText(condition: Condition): string {
  const value = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : String(condition.value);
  return `${condition.attribute} ${condition.operator} ${value}`;
}

function ruleLabel(rule: TargetingRule): string {
  return rule.description ?? rule.id;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function actionTone(action: string): string {
  if (action.includes('created')) return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20';
  if (action.includes('deleted')) return 'text-rose-300 bg-rose-400/10 border-rose-400/20';
  if (action.includes('toggled')) return 'text-amber-300 bg-amber-400/10 border-amber-400/20';
  return 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20';
}

// ── Flag card ─────────────────────────────────────────────────────────────────

function FlagCard({
  flag,
  selected,
  busy,
  onSelect,
  onToggle,
  onRollout,
  onOverrides,
}: {
  flag: FlagView;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRollout: (ruleId: string | null, pct: number) => void;
  onOverrides: (overrides: {
    allowlist: string[];
    blocklist: string[];
  }) => void;
}) {
  const [open, setOpen] = useState(selected);
  const [allowInput, setAllowInput] = useState('');
  const [blockInput, setBlockInput] = useState('');

  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);

  const addOverride = (kind: 'allow' | 'block') => {
    const raw = (kind === 'allow' ? allowInput : blockInput).trim();
    if (!raw) return;
    const current = flag.overrides;
    if (kind === 'allow') {
      if (current.allowlist.includes(raw)) return;
      onOverrides({
        allowlist: [...current.allowlist, raw],
        blocklist: current.blocklist.filter((id) => id !== raw),
      });
      setAllowInput('');
    } else {
      if (current.blocklist.includes(raw)) return;
      onOverrides({
        allowlist: current.allowlist.filter((id) => id !== raw),
        blocklist: [...current.blocklist, raw],
      });
      setBlockInput('');
    }
  };

  return (
    <div
      className={`rounded-xl border transition ${
        selected
          ? 'border-emerald-400/35 bg-emerald-400/[0.04]'
          : 'border-zinc-800 bg-ink-850/80 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <button
          type="button"
          onClick={onSelect}
          className="mt-0.5 text-zinc-600 hover:text-zinc-300"
          aria-label="expand flag"
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-100">
              {flag.name}
            </span>
            {flag.enabled ? (
              <span className="rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-300">
                on
              </span>
            ) : (
              <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-zinc-500">
                off
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-zinc-500">
            <span className="truncate">{flag.key}</span>
            <span className="text-zinc-700">·</span>
            <span>v{flag.version}</span>
            <span className="text-zinc-700">·</span>
            <span>
              {flag.rules.length} rule{flag.rules.length === 1 ? '' : 's'}
            </span>
          </div>
        </button>

        <Switch
          checked={flag.enabled}
          onChange={onToggle}
          disabled={busy}
          label={`toggle ${flag.key}`}
        />
      </div>

      {open && (
        <div className="space-y-4 border-t border-zinc-800/80 px-4 pb-4 pt-3.5">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            {flag.description || 'No description.'}
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Gradual rollout
              </span>
              <span className="font-mono text-[10px] text-zinc-600">
                murmur3({flag.key}:userId) % 100
              </span>
            </div>

            {flag.rules.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400">
                    All users (catch-all)
                  </span>
                </div>
                <RolloutSlider
                  value={0}
                  disabled={busy}
                  onCommit={(pct) => onRollout(null, pct)}
                />
              </div>
            )}

            {flag.rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-lg border border-zinc-800/80 bg-black/20 px-3 py-2.5"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-zinc-300">
                    {ruleLabel(rule)}
                  </span>
                  <span className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                    {rule.matchType}
                  </span>
                </div>
                {rule.conditions.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {rule.conditions.map((condition, i) => (
                      <span
                        key={`${rule.id}-${i}`}
                        className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400"
                      >
                        {conditionText(condition)}
                      </span>
                    ))}
                  </div>
                )}
                <RolloutSlider
                  value={rule.rolloutPercentage}
                  disabled={busy}
                  onCommit={(pct) => onRollout(rule.id, pct)}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              User overrides
            </span>

            <div className="flex flex-wrap gap-1">
              {flag.overrides.allowlist.map((id) => (
                <Chip
                  key={`allow-${id}`}
                  tone="green"
                  onRemove={() =>
                    onOverrides({
                      ...flag.overrides,
                      allowlist: flag.overrides.allowlist.filter((x) => x !== id),
                    })
                  }
                >
                  <ShieldCheck className="h-2.5 w-2.5" /> {id}
                </Chip>
              ))}
              {flag.overrides.blocklist.map((id) => (
                <Chip
                  key={`block-${id}`}
                  tone="red"
                  onRemove={() =>
                    onOverrides({
                      ...flag.overrides,
                      blocklist: flag.overrides.blocklist.filter((x) => x !== id),
                    })
                  }
                >
                  <ShieldBan className="h-2.5 w-2.5" /> {id}
                </Chip>
              ))}
              {flag.overrides.allowlist.length === 0 &&
                flag.overrides.blocklist.length === 0 && (
                  <span className="text-[10px] text-zinc-600">No overrides</span>
                )}
            </div>

            <div className="flex gap-2">
              <div className="flex flex-1 items-center gap-1 rounded-lg border border-zinc-800 bg-black/30 px-2">
                <ShieldCheck className="h-3 w-3 text-emerald-400/70" />
                <input
                  value={allowInput}
                  onChange={(e) => setAllowInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addOverride('allow')}
                  placeholder="allow userId"
                  className="w-full bg-transparent py-1.5 font-mono text-[10px] text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => addOverride('allow')}
                  className="text-zinc-500 hover:text-emerald-300"
                  aria-label="add allowlist override"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex flex-1 items-center gap-1 rounded-lg border border-zinc-800 bg-black/30 px-2">
                <ShieldBan className="h-3 w-3 text-rose-400/70" />
                <input
                  value={blockInput}
                  onChange={(e) => setBlockInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addOverride('block')}
                  placeholder="block userId"
                  className="w-full bg-transparent py-1.5 font-mono text-[10px] text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => addOverride('block')}
                  className="text-zinc-500 hover:text-rose-300"
                  aria-label="add blocklist override"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI rule compiler ──────────────────────────────────────────────────────────

function AiPanel({
  result,
  publishing,
  onApprove,
  onDismiss,
}: {
  result: CompileResponse;
  publishing: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const { simulation } = result;
  return (
    <div className="animate-fade-in space-y-4 rounded-xl border border-violet-400/25 bg-violet-400/[0.04] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg border border-violet-400/25 bg-violet-400/10">
            <Wand2 className="h-3.5 w-3.5 text-violet-300" />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-100">
              Compiled targeting rule
            </div>
            <div className="font-mono text-[9px] text-zinc-500">
              {result.source === 'llm'
                ? `LLM · ${result.model}`
                : 'deterministic offline parser'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-zinc-600 hover:text-zinc-300"
          aria-label="dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {result.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-2.5">
          {result.warnings.map((warning, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-200/90">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Blast radius */}
      <div className="rounded-lg border border-zinc-800 bg-black/30 p-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Blast radius
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-emerald-300">
                {simulation.percentage}%
              </span>
              <span className="font-mono text-[10px] text-zinc-500">
                {simulation.matchedUsers}/{simulation.totalUsers} users
              </span>
            </div>
          </div>
          <Sparkles className="h-4 w-4 text-emerald-300/70" />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all"
            style={{ width: `${simulation.percentage}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {simulation.breakdown.byPlan.map((entry) => (
            <div
              key={entry.key}
              className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5"
            >
              <div className="text-[9px] uppercase tracking-wide text-zinc-500">
                {entry.key}
              </div>
              <div className="font-mono text-[11px] text-zinc-300">
                {entry.matched}
                <span className="text-zinc-600">/{entry.total}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Diff */}
      <div className="space-y-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Rule diff
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 font-mono text-[9px] text-rose-300/80">before</div>
            <JsonBlock value={result.diff.before ?? null} />
          </div>
          <div>
            <div className="mb-1 font-mono text-[9px] text-emerald-300/80">after</div>
            <JsonBlock value={result.diff.after} />
          </div>
        </div>
      </div>

      {simulation.sampleMatchedUsers.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Sample matched
          </div>
          <div className="flex flex-wrap gap-1">
            {simulation.sampleMatchedUsers.slice(0, 6).map((user) => (
              <Chip key={user.userId} tone="cyan">
                {user.userId} · {user.plan} · {user.country}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onApprove}
        disabled={publishing}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {publishing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Approve &amp; Publish
      </button>
    </div>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function AuditList({ logs }: { logs: AuditLogView[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
        No audit entries yet.
      </p>
    );
  }

  return (
    <div className="max-h-72 space-y-1.5 overflow-auto pr-1">
      {logs.map((log) => {
        const isOpen = expanded === log.id;
        return (
          <div
            key={log.id}
            className="rounded-lg border border-zinc-800/80 bg-ink-850/60"
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : log.id)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${actionTone(log.action)}`}
              >
                {log.action}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                {log.flagKey}
              </span>
              <span className="hidden shrink-0 text-[9px] text-zinc-600 sm:inline">
                {log.actorEmail}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[9px] text-zinc-600">
                <Clock className="h-2.5 w-2.5" />
                {timeAgo(log.createdAt)}
              </span>
              {isOpen ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-zinc-600" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
              )}
            </button>
            {isOpen && (
              <div className="grid gap-2 border-t border-zinc-800/80 p-2.5 sm:grid-cols-2">
                <div>
                  <div className="mb-1 font-mono text-[9px] text-rose-300/80">
                    before
                  </div>
                  <JsonBlock value={log.beforeJson ?? null} />
                </div>
                <div>
                  <div className="mb-1 font-mono text-[9px] text-emerald-300/80">
                    after
                  </div>
                  <JsonBlock value={log.afterJson ?? null} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Control plane ─────────────────────────────────────────────────────────────

export function ControlPlane(props: ControlPlaneProps) {
  const {
    flags,
    selectedFlagKey,
    onSelectFlag,
    onToggle,
    onRollout,
    onOverrides,
    onCompile,
    onApprove,
    onDismissCompile,
    compileResult,
    compiling,
    publishing,
    auditLogs,
    busy,
    aiMode,
    error,
  } = props;

  const [prompt, setPrompt] = useState(
    'Enable for 25% of Pro users in India on app version 2.4.0 or higher',
  );

  const selectedFlag = flags.find((flag) => flag.key === selectedFlagKey) ?? null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFlag || compiling || prompt.trim().length < 3) return;
    await onCompile(prompt.trim());
  };

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Flags */}
      <section>
        <SectionTitle
          icon={FlagIcon}
          action={
            <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              {flags.length}
            </span>
          }
        >
          Flags
        </SectionTitle>
        <div className="space-y-2.5">
          {flags.map((flag) => (
            <FlagCard
              key={flag.id}
              flag={flag}
              selected={flag.key === selectedFlagKey}
              busy={busy}
              onSelect={() => onSelectFlag(flag.key)}
              onToggle={() => onToggle(flag)}
              onRollout={(ruleId, pct) => onRollout(flag, ruleId, pct)}
              onOverrides={(overrides) => onOverrides(flag, overrides)}
            />
          ))}
        </div>
      </section>

      {/* AI */}
      <section>
        <SectionTitle
          icon={Bot}
          action={
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                aiMode === 'llm'
                  ? 'border-violet-400/25 bg-violet-400/10 text-violet-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500'
              }`}
            >
              {aiMode ?? 'offline parser'}
            </span>
          }
        >
          AI rule compiler
        </SectionTitle>

        <form onSubmit={submit} className="space-y-2">
          <div className="rounded-xl border border-zinc-800 bg-ink-850/80 p-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Describe the rollout in plain English…"
              className="w-full resize-none bg-transparent px-1 py-1 text-[12px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <span className="font-mono text-[9px] text-zinc-600">
                target:{' '}
                <span className="text-zinc-400">
                  {selectedFlag?.key ?? 'select a flag'}
                </span>
              </span>
              <button
                type="submit"
                disabled={!selectedFlag || compiling || prompt.trim().length < 3}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-2.5 py-1.5 text-[11px] font-medium text-violet-200 transition hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {compiling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Compile
              </button>
            </div>
          </div>
        </form>

        {error && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-2.5 py-2 text-[10px] text-rose-200">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {error}
          </div>
        )}

        {compileResult && (
          <div className="mt-3">
            <AiPanel
              result={compileResult}
              publishing={publishing}
              onApprove={onApprove}
              onDismiss={onDismissCompile}
            />
          </div>
        )}
      </section>

      {/* Audit */}
      <section>
        <SectionTitle
          icon={History}
          action={
            <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              {auditLogs.length}
            </span>
          }
        >
          Audit log
        </SectionTitle>
        <AuditList logs={auditLogs} />
      </section>
    </div>
  );
}