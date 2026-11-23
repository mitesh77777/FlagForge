'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Braces,
  Code2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  api,
  type ApiFlag,
  type ApiRule,
  type CompileResponse,
} from '@/lib/api';
import {
  Badge,
  Button,
  JsonBlock,
  RolloutSlider,
  SectionLabel,
} from '@/components/ui';
import { Modal } from './Modal';

const OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is none of' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'semver_gte', label: 'version ≥' },
  { value: 'semver_lt', label: 'version <' },
] as const;

const ATTRIBUTES = [
  'plan',
  'country',
  'appVersion',
  'betaOptIn',
  'emailDomain',
  'seats',
] as const;

const FIELD =
  'w-full min-w-0 rounded border border-line bg-black px-2 py-1.5 text-2xs text-ink placeholder:text-ink-faint focus:border-emerald-500/50 focus:outline-none';

function conditionValueToInput(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null) return '';
  return String(value);
}

function conditionInputToValue(raw: string, operator: string): unknown {
  if (operator === 'in' || operator === 'not_in') {
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function ruleId(): string {
  return `rule_${Math.random().toString(36).slice(2, 8)}`;
}

function RuleCard({
  rule,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  rule: ApiRule;
  index: number;
  disabled: boolean;
  onChange: (rule: ApiRule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded border border-line bg-black/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge>rule {index + 1}</Badge>
        <select
          value={rule.matchType}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...rule, matchType: event.target.value as 'AND' | 'OR' })
          }
          className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-2xs text-ink-muted focus:outline-none"
        >
          <option value="AND">match ALL</option>
          <option value="OR">match ANY</option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="remove rule"
          className="ml-auto text-ink-faint transition hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5">
        {rule.conditions.map((condition, conditionIndex) => (
          <div key={conditionIndex} className="flex flex-wrap gap-1.5">
            <select
              value={condition.attribute}
              disabled={disabled}
              onChange={(event) => {
                const conditions = [...rule.conditions];
                conditions[conditionIndex] = {
                  ...condition,
                  attribute: event.target.value,
                };
                onChange({ ...rule, conditions });
              }}
              className={`${FIELD} w-24 flex-none`}
            >
              {ATTRIBUTES.map((attribute) => (
                <option key={attribute} value={attribute}>
                  {attribute}
                </option>
              ))}
            </select>
            <select
              value={condition.operator}
              disabled={disabled}
              onChange={(event) => {
                const conditions = [...rule.conditions];
                conditions[conditionIndex] = {
                  ...condition,
                  operator: event.target.value,
                };
                onChange({ ...rule, conditions });
              }}
              className={`${FIELD} w-28 flex-none`}
            >
              {OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </select>
            <input
              value={conditionValueToInput(condition.value)}
              disabled={disabled}
              onChange={(event) => {
                const conditions = [...rule.conditions];
                conditions[conditionIndex] = {
                  ...condition,
                  value: conditionInputToValue(
                    event.target.value,
                    condition.operator,
                  ),
                };
                onChange({ ...rule, conditions });
              }}
              placeholder={
                condition.operator === 'in' || condition.operator === 'not_in'
                  ? 'IN, US, DE'
                  : 'value'
              }
              className={`${FIELD} flex-1`}
            />
            <button
              type="button"
              disabled={disabled || rule.conditions.length === 1}
              onClick={() =>
                onChange({
                  ...rule,
                  conditions: rule.conditions.filter(
                    (_, i) => i !== conditionIndex,
                  ),
                })
              }
              aria-label="remove condition"
              className="px-1 text-ink-faint transition hover:text-red-400 disabled:opacity-30"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...rule,
              conditions: [
                ...rule.conditions,
                { attribute: 'plan', operator: 'eq', value: 'pro' },
              ],
            })
          }
          className="flex items-center gap-1 text-2xs text-ink-muted transition hover:text-ink"
        >
          <Plus className="h-3 w-3" />
          Add condition
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-ink-muted">Rollout</span>
          <span className="flex items-center gap-2 text-2xs text-ink-muted">
            serve
            <select
              value={String(rule.serveValue)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...rule,
                  serveValue: event.target.value === 'true',
                })
              }
              className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-2xs text-ink focus:outline-none"
            >
              <option value="true">on</option>
              <option value="false">off</option>
            </select>
          </span>
        </div>
        <RolloutSlider
          value={rule.rolloutPercentage}
          disabled={disabled}
          onCommit={(percentage) =>
            onChange({ ...rule, rolloutPercentage: percentage })
          }
        />
      </div>
    </div>
  );
}

export function FlagEditor({
  flag,
  open,
  onClose,
  onSaved,
  onDeleted,
}: {
  flag: ApiFlag | null;
  open: boolean;
  onClose: () => void;
  onSaved: (flag: ApiFlag) => void;
  onDeleted: (id: string) => void;
}) {
  const [rules, setRules] = useState<ApiRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [prompt, setPrompt] = useState(
    '25% of Pro users in India on app version 2.4.0 or higher',
  );
  const [compile, setCompile] = useState<CompileResponse | null>(null);
  const [compiling, setCompiling] = useState(false);

  useEffect(() => {
    if (!open || !flag) return;
    setRules(structuredClone(flag.rules));
    setError(null);
    setCompile(null);
    setConfirmDelete(false);
    setShowJson(false);
  }, [open, flag]);

  const dirty = useMemo(() => {
    if (!flag) return false;
    return JSON.stringify(rules) !== JSON.stringify(flag.rules);
  }, [rules, flag]);

  if (!open || !flag) return null;

  const saveRules = async (next: ApiRule[]) => {
    setBusy(true);
    setError(null);
    try {
      const { flag: updated } = await api.flags.update(flag.id, { rules: next });
      setRules(updated.rules);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save rules');
    } finally {
      setBusy(false);
    }
  };

  const runCompile = async () => {
    if (prompt.trim().length < 3) return;
    setCompiling(true);
    setError(null);
    try {
      setCompile(
        await api.ai.compile(prompt.trim(), flag.key, rules[0]),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'compilation failed');
    } finally {
      setCompiling(false);
    }
  };

  const applyCompiled = async () => {
    if (!compile) return;
    const next = [
      compile.compiledRule,
      ...rules.filter((rule) => rule.id !== compile.compiledRule.id),
    ];
    await saveRules(next);
    setCompile(null);
  };

  const removeFlag = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.flags.remove(flag.id);
      onDeleted(flag.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to delete flag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${flag.name}`}
        onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-panel"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-medium text-ink">
                {flag.name}
              </h2>
              <Badge tone={flag.enabled ? 'emerald' : 'red'}>
                {flag.enabled ? 'on' : 'off'}
              </Badge>
            </div>
            <p className="mt-0.5 truncate font-mono text-2xs text-ink-faint">
              {flag.key} · v{flag.version}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="close editor"
            className="text-ink-faint transition hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-4 py-4">
          {error && (
            <p className="rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
              {error}
            </p>
          )}

          {/* Targeting */}
          <section>
            <SectionLabel
              icon={Code2}
              action={
                <button
                  type="button"
                  onClick={() => setShowJson((value) => !value)}
                  className="flex items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 font-mono text-2xs text-ink-muted transition hover:text-ink"
                >
                  <Braces className="h-3 w-3" />
                  {showJson ? 'Hide JSON' : 'View JSON'}
                </button>
              }
            >
              Targeting rules
            </SectionLabel>

            {showJson ? (
              <JsonBlock value={rules} />
            ) : (
              <div className="space-y-2">
                {rules.length === 0 && (
                  <p className="rounded border border-dashed border-line px-3 py-4 text-center text-2xs text-ink-faint">
                    No rules yet — every request falls through to{' '}
                    <span className="font-mono text-ink-muted">
                      {String(flag.defaultValue)}
                    </span>
                    .
                  </p>
                )}

                {rules.map((rule, index) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    index={index}
                    disabled={busy}
                    onChange={(next) =>
                      setRules((current) =>
                        current.map((item, i) => (i === index ? next : item)),
                      )
                    }
                    onRemove={() =>
                      setRules((current) => current.filter((_, i) => i !== index))
                    }
                  />
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setRules((current) => [
                        ...current,
                        {
                          id: ruleId(),
                          description: '',
                          conditions: [
                            { attribute: 'plan', operator: 'eq', value: 'pro' },
                          ],
                          matchType: 'AND',
                          rolloutPercentage: 100,
                          serveValue: true,
                        },
                      ])
                    }
                    className="flex items-center gap-1 rounded border border-dashed border-line px-2 py-1 text-2xs text-ink-muted transition hover:border-line-strong hover:text-ink"
                  >
                    <Plus className="h-3 w-3" />
                    Add rule
                  </button>

                  <Button
                    size="sm"
                    variant="primary"
                    className="ml-auto"
                    disabled={busy || !dirty}
                    onClick={() => void saveRules(rules)}
                  >
                    {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                    Save rules
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* AI assistant */}
          <section>
            <SectionLabel icon={Sparkles}>AI rule assistant</SectionLabel>

            <div className="rounded border border-line bg-black/40 p-2.5">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={2}
                placeholder="Describe who should see this feature…"
                className="w-full resize-none bg-transparent text-xs leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  onClick={() => void runCompile()}
                  disabled={compiling || prompt.trim().length < 3}
                >
                  {compiling ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  Compile
                </Button>
              </div>
            </div>

            {compile && (
              <div className="mt-2 animate-fade-up space-y-3 rounded border border-emerald-500/25 bg-emerald-500/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="emerald">
                    {compile.source === 'llm' ? 'llm' : 'deterministic parser'}
                  </Badge>
                  <span className="font-mono text-2xs text-ink-faint">
                    {compile.simulation.matchedUsers}/
                    {compile.simulation.totalUsers} users
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {compile.compiledRule.conditions.length === 0 ? (
                    <Badge>all users</Badge>
                  ) : (
                    compile.compiledRule.conditions.map((condition, index) => (
                      <span
                        key={index}
                        className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-2xs text-ink-muted"
                      >
                        {condition.attribute} {condition.operator}{' '}
                        {Array.isArray(condition.value)
                          ? condition.value.join('|')
                          : String(condition.value)}
                      </span>
                    ))
                  )}
                  <Badge tone="amber">
                    {compile.compiledRule.rolloutPercentage}% rollout
                  </Badge>
                </div>

                <div>
                  <div className="flex items-center justify-between text-2xs text-ink-muted">
                    <span>Blast radius</span>
                    <span className="font-mono text-emerald-400">
                      {compile.simulation.percentage}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${compile.simulation.percentage}%` }}
                    />
                  </div>
                </div>

                {compile.warnings.length > 0 && (
                  <p className="flex items-start gap-1.5 text-2xs text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {compile.warnings[0]}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => setCompile(null)}>
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void applyCompiled()}
                    disabled={busy}
                  >
                    Apply rule
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Danger zone */}
          <section className="border-t border-line pt-4">
            <SectionLabel icon={Trash2}>Danger zone</SectionLabel>
            <div className="flex items-center justify-between gap-3 rounded border border-red-500/25 bg-red-500/[0.04] px-3 py-2.5">
              <p className="text-2xs leading-relaxed text-ink-muted">
                Deleting a flag removes it from every SDK immediately and writes an
                audit entry.
              </p>
              <Button
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                Delete
              </Button>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${flag.name}”?`}
        description="This cannot be undone. Clients evaluating the flag will fall back to their own default."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="primary"
              className="border-red-500 bg-red-500 text-black hover:bg-red-400"
              onClick={() => void removeFlag()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete flag
            </Button>
          </>
        }
      >
        <p className="font-mono text-2xs text-ink-muted">{flag.key}</p>
      </Modal>
    </div>
  );
}