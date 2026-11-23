'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api, setToken } from '@/lib/api';

/**
 * One-click demo entry. Signs into the seeded demo account and lands in the
 * dashboard, so a recruiter can click straight through without signing up.
 */
export function DemoButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.auth.demo();
      setToken(result.token);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'demo unavailable');
      setBusy(false);
    }
  };

  return (
    <span className="w-full sm:w-auto">
      <button
        type="button"
        onClick={() => void enter()}
        disabled={busy}
        className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-card px-5 text-sm font-medium text-ink transition hover:border-line-strong disabled:opacity-60 sm:w-auto ${className}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        Try Interactive Demo
      </button>
      {error && (
        <span className="mt-1 block text-2xs text-red-400">{error}</span>
      )}
    </span>
  );
}