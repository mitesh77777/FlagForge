'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';
import { StatusDot } from './ui';

type Health = 'checking' | 'up' | 'down';

/**
 * Live API probe for the navbar. Polls the readiness endpoint (which checks
 * PostgreSQL and Redis) so the pill reflects whether the backend can actually
 * serve traffic, not merely whether the process is up.
 */
export function ApiStatusPill() {
  const [health, setHealth] = useState<Health>('checking');
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const probe = async (): Promise<void> => {
      const started = performance.now();
      try {
        const res = await fetch(`${API_URL}/health/ready`, { cache: 'no-store' });
        const elapsed = Math.round(performance.now() - started);
        if (cancelled) return;
        setHealth(res.ok ? 'up' : 'down');
        setLatency(elapsed);
      } catch {
        if (!cancelled) {
          setHealth('down');
          setLatency(null);
        }
      }
    };

    void probe();
    const timer = setInterval(() => void probe(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const label =
    health === 'up'
      ? 'API healthy'
      : health === 'down'
        ? 'API unreachable'
        : 'Checking API';

  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1.5">
      <StatusDot
        tone={health === 'up' ? 'emerald' : health === 'down' ? 'red' : 'neutral'}
        pulse={health === 'up'}
      />
      <span className="font-mono text-2xs text-ink-muted">{label}</span>
      {health === 'up' && latency !== null && (
        <span className="font-mono text-2xs text-ink-faint">{latency}ms</span>
      )}
    </span>
  );
}
