'use client';

import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Check, Copy, Database, Layers, Zap } from 'lucide-react';

// ── Button ───────────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'emerald' | 'amber' | 'red';

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary:
      'bg-ink text-black border border-ink hover:bg-white/90 disabled:opacity-40',
    secondary:
      'bg-card text-ink border border-line hover:border-line-strong hover:bg-[#161616] disabled:opacity-40',
    ghost:
      'bg-transparent text-ink-muted border border-transparent hover:text-ink hover:bg-card disabled:opacity-40',
  } as const;

  const sizes = {
    sm: 'h-7 px-2.5 text-xs gap-1.5',
    md: 'h-9 px-3.5 text-sm gap-2',
    lg: 'h-11 px-5 text-sm gap-2',
  } as const;

  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Badge / Chip ─────────────────────────────────────────────────────────────

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-line bg-card text-ink-muted',
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
  red: 'border-red-500/25 bg-red-500/10 text-red-400',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wide ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  onRemove,
}: {
  children: ReactNode;
  tone?: Tone;
  onRemove?: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-2xs ${TONE_CLASS[tone]}`}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="remove"
          className="ml-0.5 text-current opacity-60 transition hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  );
}

// ── Status dot ───────────────────────────────────────────────────────────────

const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-ink-faint',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

export function StatusDot({
  tone = 'neutral',
  pulse = false,
  className = '',
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]} ${pulse ? 'animate-pulse-dot' : ''} ${className}`}
    />
  );
}

// ── Kill switch ──────────────────────────────────────────────────────────────

/**
 * The flag kill switch. `on` is emerald; `off` is a muted red, because a
 * disabled flag *is* the kill switch being engaged.
 */
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-emerald-500/40 bg-emerald-500/25'
          : 'border-red-500/30 bg-red-500/10'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
          checked
            ? 'translate-x-[1.125rem] bg-emerald-400'
            : 'translate-x-[0.1875rem] bg-red-400/80'
        }`}
      />
    </button>
  );
}

// ── Rollout slider ───────────────────────────────────────────────────────────

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
        onChange={(event) => setLocal(Number(event.target.value))}
        onPointerUp={() => onCommit(local)}
        onKeyUp={() => onCommit(local)}
        onBlur={() => onCommit(local)}
        aria-label="rollout percentage"
        className="ff-range w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
        style={{
          background: `linear-gradient(to right, #10b981 ${local}%, #1f1f1f ${local}%)`,
        }}
      />
      <span className="w-9 shrink-0 text-right font-mono text-xs text-ink">
        {local}
        <span className="text-ink-faint">%</span>
      </span>
    </div>
  );
}

// ── Structured output ────────────────────────────────────────────────────────

export function JsonBlock({
  value,
  className = '',
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={`max-h-64 min-w-0 overflow-auto rounded-md border border-line bg-black p-3 font-mono text-2xs leading-relaxed text-ink-muted ${className}`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function SectionLabel({
  children,
  icon: Icon,
  action,
}: {
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {children}
      </span>
      {action}
    </div>
  );
}

// ── Telemetry ────────────────────────────────────────────────────────────────

export function CacheStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === 'L1-HIT'
      ? 'emerald'
      : status === 'L2-HIT'
        ? 'amber'
        : status === 'DB-FALLBACK'
          ? 'red'
          : 'neutral';

  const Icon =
    status === 'L1-HIT' ? Zap : status === 'L2-HIT' ? Layers : Database;

  return (
    <Badge tone={tone}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

export function LatencyBadge({ ms }: { ms: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 font-mono text-2xs text-ink-muted">
      {ms}
      <span className="text-ink-faint">ms</span>
    </span>
  );
}

// ── Copy to clipboard ────────────────────────────────────────────────────────

export function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => setCopied(false));
      }}
      className={`inline-flex items-center gap-1.5 rounded border border-line bg-card px-2 py-1 font-mono text-2xs text-ink-muted transition hover:border-line-strong hover:text-ink ${className}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? 'Copied' : label}
    </button>
  );
}
