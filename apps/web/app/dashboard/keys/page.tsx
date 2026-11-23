'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, RotateCw, ShieldCheck } from 'lucide-react';
import {
  API_URL,
  api,
  type ApiEnvironmentWithKey,
} from '@/lib/api';
import { Badge, Button, StatusDot } from '@/components/ui';
import { CodeSample } from '@/components/CodeSample';
import { KeyRevealModal } from '@/components/dashboard/KeyRevealModal';
import { useWorkspace } from '@/components/dashboard/WorkspaceProvider';

type Tab = 'curl' | 'node' | 'react';

function buildSnippets(apiUrl: string, flagKey: string) {
  return {
    curl: `curl -s ${apiUrl}/v1/evaluate \\
  -H 'content-type: application/json' \\
  -H 'x-sdk-key: <YOUR_SDK_KEY>' \\
  -d '{"key":"${flagKey}","userId":"user_123","attributes":{"plan":"pro","country":"IN"}}'`,
    node: `import { FlagForgeClient } from '@flagforge/sdk';

const client = new FlagForgeClient({
  apiUrl: '${apiUrl}',
  sdkKey: '<YOUR_SDK_KEY>',
  userContext: { userId: 'user_123', attributes: { plan: 'pro' } },
});

await client.ready;                      // one batch call, then SSE
client.get('${flagKey}', false);          // sticks for this user
client.onChange(() => render());          // live updates`,
    react: `import { FlagForgeProvider, useFlag } from '@flagforge/sdk/react';

<FlagForgeProvider client={client}>
  <Checkout />
</FlagForgeProvider>;

function Checkout() {
  const enabled = useFlag('${flagKey}', false);
  return enabled ? <CheckoutV2 /> : <CheckoutLegacy />;
}`,
  };
}

export default function KeysPage() {
  const { environments, environment, project, refreshEnvironments } =
    useWorkspace();
  const [flags, setFlags] = useState<Array<{ key: string }>>([]);
  const [rotating, setRotating] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ApiEnvironmentWithKey[] | null>(null);
  const [graceUntil, setGraceUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('curl');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!environment) return;
      try {
        const { flags: list } = await api.flags.list(environment.id);
        if (!cancelled) setFlags(list);
      } catch {
        if (!cancelled) setFlags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environment]);

  const snippetFlag = flags[0]?.key ?? 'my_first_flag';
  const snippets = useMemo(
    () => buildSnippets(API_URL, snippetFlag),
    [snippetFlag],
  );

  const rotate = useCallback(
    async (environmentId: string) => {
      setRotating(environmentId);
      setError(null);
      try {
        const rotated = await api.environments.rotate(environmentId);
        setGraceUntil(rotated.previousKeyExpiresAt);
        setRevealed([
          {
            id: rotated.environmentId,
            name: rotated.environment,
            tier: 'live',
            sdkKey: rotated.sdkKey,
            sdkKeyPrefix: rotated.sdkKeyPrefix,
          },
        ]);
        await refreshEnvironments();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'failed to rotate key');
      } finally {
        setRotating(null);
      }
    },
    [refreshEnvironments],
  );

  return (
    <div className="min-w-0">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">SDK &amp; Keys</h1>
        <p className="mt-1 text-2xs text-ink-muted">
          {project?.name} · keys authenticate the data plane only
        </p>
      </div>

      {error && (
        <p className="mb-3 rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
          {error}
        </p>
      )}

      <section className="mb-6">
        <div className="overflow-hidden rounded border border-line bg-panel">
          {environments.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <StatusDot
                tone={environment?.id === item.id ? 'emerald' : 'neutral'}
                pulse={environment?.id === item.id}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm capitalize text-ink">{item.name}</span>
                  <Badge tone={item.name === 'production' ? 'emerald' : 'amber'}>
                    {item.name === 'production' ? 'live' : 'test'}
                  </Badge>
                </span>
                <span className="mt-0.5 block font-mono text-2xs text-ink-faint">
                  {item.sdkKeyPrefix}••••••••••••••••
                </span>
              </span>

              <Button
                size="sm"
                onClick={() => void rotate(item.id)}
                disabled={rotating !== null}
              >
                {rotating === item.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCw className="h-3 w-3" />
                )}
                Rotate key
              </Button>
            </div>
          ))}
          {environments.length === 0 && (
            <p className="px-4 py-8 text-center text-2xs text-ink-faint">
              No environments in this project.
            </p>
          )}
        </div>

        <p className="mt-2 flex items-start gap-1.5 text-2xs leading-relaxed text-ink-faint">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500/70" />
          Raw keys are shown once and stored only as SHA-256 hashes. Rotation keeps
          the previous key valid for 24 hours (a zero-downtime cutover).
        </p>
        {graceUntil && (
          <p className="mt-1 font-mono text-2xs text-amber-400">
            previous key expires {new Date(graceUntil).toLocaleString()}
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.16em] text-ink-muted">
            <KeyRound className="h-3.5 w-3.5" />
            Live quickstart
          </span>
          <div className="flex rounded border border-line bg-card p-0.5">
            {(['curl', 'node', 'react'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTab(option)}
                className={`rounded px-2 py-1 font-mono text-2xs transition ${
                  tab === option ? 'bg-line text-ink' : 'text-ink-faint hover:text-ink'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <CodeSample
          code={snippets[tab]}
          filename={
            tab === 'curl'
              ? 'terminal.sh'
              : tab === 'node'
                ? 'server.ts'
                : 'component.tsx'
          }
        />

        <p className="mt-2 font-mono text-2xs text-ink-faint">
          API origin: {API_URL} · sample flag: {snippetFlag}
        </p>
      </section>

      {revealed && (
        <KeyRevealModal
          open
          onClose={() => setRevealed(null)}
          environments={revealed}
          title="New SDK key"
          description="The previous key keeps working until the grace window closes."
        />
      )}
    </div>
  );
}