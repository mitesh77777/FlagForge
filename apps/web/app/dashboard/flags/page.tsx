'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Flag, Loader2, Plus, Search } from 'lucide-react';
import { api, type ApiFlag } from '@/lib/api';
import {
  Badge,
  Button,
  SectionLabel,
  StatusDot,
  Switch,
} from '@/components/ui';
import { Modal } from '@/components/dashboard/Modal';
import { FlagEditor } from '@/components/dashboard/FlagEditor';
import { useWorkspace } from '@/components/dashboard/WorkspaceProvider';

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const FIELD =
  'w-full rounded border border-line bg-black px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-emerald-500/50 focus:outline-none';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export default function FlagsPage() {
  const { environment, project } = useWorkspace();

  const [flags, setFlags] = useState<ApiFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ApiFlag | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [newDefault, setNewDefault] = useState('false');
  const [newEnabled, setNewEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!environment) {
      setFlags([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { flags: list } = await api.flags.list(environment.id);
      setFlags(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load flags');
    } finally {
      setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return flags;
    return flags.filter(
      (flag) =>
        flag.name.toLowerCase().includes(term) ||
        flag.key.toLowerCase().includes(term),
    );
  }, [flags, query]);

  const toggle = async (flag: ApiFlag) => {
    setBusyId(flag.id);
    setError(null);
    try {
      const { flag: updated } = await api.flags.update(flag.id, {
        enabled: !flag.enabled,
      });
      setFlags((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to toggle flag');
    } finally {
      setBusyId(null);
    }
  };

  const openCreate = () => {
    setNewName('');
    setNewKey('');
    setKeyTouched(false);
    setNewDefault('false');
    setNewEnabled(true);
    setCreateError(null);
    setCreating(true);
  };

  const createFlag = async () => {
    if (!environment) return;
    const key = newKey.trim();
    if (!KEY_PATTERN.test(key)) {
      setCreateError('Key must be lowercase letters, numbers, dots, dashes or underscores');
      return;
    }
    if (newName.trim().length === 0) {
      setCreateError('Give the flag a name');
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      const { flag } = await api.flags.create({
        environmentId: environment.id,
        key,
        name: newName.trim(),
        defaultValue: newDefault === 'true',
        enabled: newEnabled,
      });
      setFlags((current) => [flag, ...current]);
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'failed to create flag');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Feature Flags
          </h1>
          <p className="mt-1 text-2xs text-ink-muted">
            {project?.name} · <span className="font-mono">{environment?.name}</span>{' '}
            environment
          </p>
        </div>
        <Button variant="primary" onClick={openCreate} disabled={!environment}>
          <Plus className="h-3.5 w-3.5" />
          Create Flag
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded border border-line bg-panel px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search flags…"
          className="w-full bg-transparent py-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <span className="shrink-0 font-mono text-2xs text-ink-faint">
          {filtered.length}/{flags.length}
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-10 text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-mono text-2xs">loading flags…</span>
        </div>
      ) : !environment ? (
        <p className="rounded border border-dashed border-line px-4 py-10 text-center text-2xs text-ink-faint">
          Create a project to get an environment.
        </p>
      ) : flags.length === 0 ? (
        <div className="rounded border border-dashed border-line px-4 py-14 text-center">
          <Flag className="mx-auto h-5 w-5 text-ink-faint" />
          <p className="mt-3 text-sm text-ink">No flags yet</p>
          <p className="mt-1 text-2xs text-ink-muted">
            Create your first flag to start shipping behind it.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Create Flag
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-line bg-panel">
          <div className="hidden grid-cols-[1fr_auto_auto] gap-4 border-b border-line px-4 py-2 text-2xs uppercase tracking-[0.14em] text-ink-faint sm:grid">
            <span>Flag</span>
            <span>Rollout</span>
            <span>State</span>
          </div>

          {filtered.map((flag) => (
            <div
              key={flag.id}
              className="grid grid-cols-1 items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto_auto] sm:gap-4"
            >
              <button
                type="button"
                onClick={() => setEditing(flag)}
                className="min-w-0 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm text-ink">{flag.name}</span>
                  <Badge tone={flag.enabled ? 'emerald' : 'red'}>
                    {flag.enabled ? 'on' : 'off'}
                  </Badge>
                </span>
                <span className="mt-0.5 flex items-center gap-2 font-mono text-2xs text-ink-faint">
                  <span className="truncate">{flag.key}</span>
                  <span>v{flag.version}</span>
                  <span>
                    {flag.rules.length} rule{flag.rules.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>

              <span className="flex items-center gap-1.5 font-mono text-2xs text-ink-muted">
                <StatusDot
                  tone={flag.rules.length > 0 ? 'amber' : 'neutral'}
                />
                {flag.rules.length > 0
                  ? `${flag.rules[0]!.rolloutPercentage}%`
                  : 'default'}
              </span>

              <div className="flex items-center gap-2">
                <Switch
                  checked={flag.enabled}
                  onChange={() => void toggle(flag)}
                  disabled={busyId === flag.id}
                  label={`toggle ${flag.key}`}
                />
                <Button size="sm" onClick={() => setEditing(flag)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {flags.length > 0 && (
        <p className="mt-3 font-mono text-2xs text-ink-faint">
          Toggling a flag writes an audit entry and invalidates every connected
          client over Redis Pub/Sub.
        </p>
      )}

      {/* Create flag */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a flag"
        description={`New flags are created in the ${environment?.name ?? ''} environment.`}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => void createFlag()}
              disabled={saving}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create flag
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="flag-name" className="mb-1.5 block text-2xs text-ink-muted">
              Name
            </label>
            <input
              id="flag-name"
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                if (!keyTouched) setNewKey(slugify(event.target.value));
              }}
              placeholder="New checkout flow"
              autoFocus
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="flag-key" className="mb-1.5 block text-2xs text-ink-muted">
              Key <span className="text-ink-faint">(used in your code)</span>
            </label>
            <input
              id="flag-key"
              value={newKey}
              onChange={(event) => {
                setKeyTouched(true);
                setNewKey(event.target.value);
              }}
              placeholder="new_checkout_flow"
              className={`${FIELD} font-mono text-xs`}
            />
            {newKey.length > 0 && !KEY_PATTERN.test(newKey) && (
              <p className="mt-1 text-2xs text-red-400">
                Lowercase letters, numbers, dots, dashes and underscores only.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="flag-default" className="mb-1.5 block text-2xs text-ink-muted">
                Default value
              </label>
              <select
                id="flag-default"
                value={newDefault}
                onChange={(event) => setNewDefault(event.target.value)}
                className={FIELD}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </div>
            <div>
              <span className="mb-1.5 block text-2xs text-ink-muted">Kill switch</span>
              <button
                type="button"
                onClick={() => setNewEnabled((value) => !value)}
                className={`flex h-[38px] w-full items-center justify-between rounded border px-3 text-2xs transition ${
                  newEnabled
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-400'
                }`}
              >
                {newEnabled ? 'Enabled' : 'Disabled'}
                <Switch
                  checked={newEnabled}
                  onChange={() => setNewEnabled((value) => !value)}
                  label="enabled"
                />
              </button>
            </div>
          </div>

          {createError && (
            <p className="rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
              {createError}
            </p>
          )}
        </div>
      </Modal>

      <FlagEditor
        flag={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(updated) =>
          setFlags((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          )
        }
        onDeleted={(id) =>
          setFlags((current) => current.filter((item) => item.id !== id))
        }
      />

      <div className="mt-8">
        <SectionLabel icon={Flag}>How evaluation works</SectionLabel>
        <p className="text-2xs leading-relaxed text-ink-muted">
          Kill switch → blocklist → allowlist → each rule in order (conditions
          combined with all/any, then a sticky{' '}
          <span className="font-mono text-ink">murmur3(key:userId) % 100</span>{' '}
          bucket) → the default value.
        </p>
      </div>
    </div>
  );
}