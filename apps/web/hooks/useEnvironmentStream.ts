'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlagConfig } from '@flagforge/evaluator';
import { API_URL, api } from '@/lib/api';

export interface Telemetry {
  cacheStatus: string;
  evalMs: string;
  version: number;
  updatedAt: number;
}

const EMPTY_TELEMETRY: Telemetry = {
  cacheStatus: '—',
  evalMs: '—',
  version: 0,
  updatedAt: 0,
};

/**
 * One shared SSE connection for the raw environment config. Each `flags` event
 * triggers a push-driven refetch of `/v1/config`, which also gives us the
 * `X-Cache-Status` / `X-Eval-Time-Ms` response headers for the telemetry badge.
 */
export function useEnvironmentStream(sdkKey: string | null) {
  const [flags, setFlags] = useState<Record<string, FlagConfig>>({});
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const pull = useCallback(async () => {
    if (!sdkKey) return;
    try {
      const { data, cacheStatus, evalMs } = await api.config(sdkKey);
      setFlags(data.flags);
      setTelemetry({
        cacheStatus,
        evalMs,
        version: data.version,
        updatedAt: Date.now(),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load config');
    }
  }, [sdkKey]);

  useEffect(() => {
    if (!sdkKey) return;
    let cancelled = false;

    void pull();

    const source = new EventSource(
      `${API_URL}/v1/stream?sdkKey=${encodeURIComponent(sdkKey)}`,
    );
    source.addEventListener('flags', () => {
      if (!cancelled) void pull();
    });
    source.addEventListener('error', () => {
      // EventSource reconnects automatically; surface a soft status only.
      if (!cancelled) setError('stream reconnecting…');
    });
    sourceRef.current = source;

    return () => {
      cancelled = true;
      source.close();
      sourceRef.current = null;
    };
  }, [sdkKey, pull]);

  return { flags, telemetry, error, refresh: pull };
}