'use client';

import { useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Database, Layers, Server, Zap } from 'lucide-react';

export function TelemetryBadge({
  cacheStatus,
  evalMs,
  version,
  compact = false,
}: {
  cacheStatus: string;
  evalMs: string;
  version?: number;
  compact?: boolean;
}) {
  const tone =
    cacheStatus === 'L1-HIT'
      ? 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10'
      : cacheStatus === 'L2-HIT'
        ? 'text-cyan-300 border-cyan-400/25 bg-cyan-400/10'
        : cacheStatus === 'DB-FALLBACK'
          ? 'text-amber-300 border-amber-400/25 bg-amber-400/10'
          : 'text-zinc-400 border-zinc-700 bg-zinc-800/40';

  const Icon = cacheStatus === 'L1-HIT' ? Zap : cacheStatus === 'L2-HIT' ? Layers : Database;

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${tone}`}>
        <Icon className="h-3 w-3" />
        {cacheStatus}
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-zinc-400">
        <Server className="h-3 w-3" />
        {evalMs}ms
      </span>
      {!compact && version !== undefined && (
        <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-500">
          v{version}
        </span>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-emerald-400/40 bg-emerald-400/25'
          : 'border-zinc-700 bg-zinc-800'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition ${
          checked
            ? 'translate-x-6 bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.7)]'
            : 'translate-x-1 bg-zinc-500'
        }`}
      />
    </button>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  onRemove,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'red' | 'cyan';
  onRemove?: () => void;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
    green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    red: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
    cyan: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${tones[tone]}`}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-current/70 hover:text-current"
          aria-label="remove"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function RolloutSlider({
  value,
  onCommit,
  disabled,
}: {
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => onCommit(local)}
        onKeyUp={() => onCommit(local)}
        onBlur={() => onCommit(local)}
        className="ff-range h-1.5 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: `linear-gradient(to right, #10b981 ${local}%, #1f2530 ${local}%)`,
        }}
        aria-label="rollout percentage"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-400">
        {local}%
      </span>
    </div>
  );
}

export function JsonBlock({
  value,
  className = '',
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={`max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-zinc-400 ${className}`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function SectionTitle({
  children,
  icon: Icon,
  action,
}: {
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {children}
      </h2>
      {action}
    </div>
  );
}