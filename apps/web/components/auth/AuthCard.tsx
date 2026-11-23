'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { api, setToken, type ApiEnvironmentWithKey } from '@/lib/api';
import { Button } from '@/components/ui';
import { KeyRevealModal } from '@/components/dashboard/KeyRevealModal';

function Logo() {
  return (
    <span className="flex items-center justify-center gap-2.5">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <rect x="2.5" y="3.5" width="19" height="3.2" rx="1.6" fill="#FAFAFA" />
        <rect x="2.5" y="10.4" width="12" height="3.2" rx="1.6" fill="#10B981" />
        <rect x="2.5" y="17.3" width="6.5" height="3.2" rx="1.6" fill="#FAFAFA" fillOpacity="0.35" />
      </svg>
      <span className="text-base font-semibold tracking-tight text-ink">
        FlagForge
      </span>
    </span>
  );
}

const FIELD =
  'w-full rounded border border-line bg-black px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-emerald-500/50 focus:outline-none';

export function AuthCard({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const isSignup = mode === 'signup';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'form' | 'demo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ApiEnvironmentWithKey[] | null>(null);

  const finish = (token: string, environments?: ApiEnvironmentWithKey[]) => {
    setToken(token);
    if (environments && environments.length > 0) setRevealed(environments);
    else router.replace('/dashboard/flags');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy('form');
    setError(null);
    try {
      if (isSignup) {
        const result = await api.auth.signup({
          email,
          password,
          name: name.trim() || undefined,
        });
        finish(result.token, result.environments);
      } else {
        const result = await api.auth.login({ email, password });
        finish(result.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const useDemo = async () => {
    if (busy) return;
    setBusy('demo');
    setError(null);
    try {
      const result = await api.auth.demo();
      finish(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'demo login failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo />

        <div className="mt-7 rounded-lg border border-line bg-panel p-6">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            {isSignup ? 'Create your account' : 'Sign in'}
          </h1>
          <p className="mt-1 text-2xs text-ink-muted">
            {isSignup
              ? 'Start shipping behind flags in under a minute.'
              : 'Welcome back to your feature flags.'}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            {isSignup && (
              <div>
                <label htmlFor="name" className="mb-1.5 block text-2xs text-ink-muted">
                  Name
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  className={FIELD}
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-2xs text-ink-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className={FIELD}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-2xs text-ink-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                className={FIELD}
              />
            </div>

            {error && (
              <p className="rounded border border-red-500/25 bg-red-500/[0.06] px-2.5 py-2 text-2xs text-red-400">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={busy !== null}
            >
              {busy === 'form' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-2xs uppercase tracking-wider text-ink-faint">
              or
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button
            type="button"
            className="w-full"
            onClick={() => void useDemo()}
            disabled={busy !== null}
          >
            {busy === 'demo' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
            )}
            Continue with Demo Account
          </Button>

          <p className="mt-4 text-center text-2xs text-ink-muted">
            {isSignup ? 'Already have an account? ' : 'New to FlagForge? '}
            <Link
              href={isSignup ? '/login' : '/signup'}
              className="text-ink underline-offset-2 hover:underline"
            >
              {isSignup ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>

        <p className="mt-5 text-center font-mono text-2xs text-ink-faint">
          Demo account: demo@flagforge.dev / demo1234
        </p>
      </div>

      {revealed && (
        <KeyRevealModal
          open
          onClose={() => {
            setRevealed(null);
            router.replace('/dashboard/flags');
          }}
          environments={revealed}
          title="Account created — save your SDK keys"
        />
      )}
    </div>
  );
}