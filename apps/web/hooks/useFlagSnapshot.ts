'use client';

import { useEffect, useState } from 'react';
import { FlagForgeClient, type FlagSnapshot } from '@flagforge/sdk';
import { API_URL } from '@/lib/api';

export interface DemoUser {
  id: string;
  label: string;
  name: string;
  plan: string;
  country: string;
  appVersion: string;
  betaOptIn: boolean;
}

/**
 * Ten "accounts" of the demo storefront.
 *
 * FlagForge never stores users — your app sends whatever user id it already
 * has, and the answer is derived from it. These ten exist purely so the demo
 * shows one account getting a feature while another does not.
 *
 * Deliberately includes the two special ids from the seeded rules:
 *   user_demo_001 is allow-listed, user_demo_020 and user_demo_013 are blocked.
 */
export const DEMO_USERS: readonly DemoUser[] = Object.freeze([
  { id: 'user_demo_001', name: 'Priya', label: '#001 Priya · Enterprise · India · allow-listed', plan: 'enterprise', country: 'IN', appVersion: '2.4.1', betaOptIn: true },
  { id: 'user_demo_002', name: 'Sam', label: '#002 Sam · Pro · United States', plan: 'pro', country: 'US', appVersion: '2.5.0', betaOptIn: false },
  { id: 'user_demo_003', name: 'Lena', label: '#003 Lena · Free · Germany', plan: 'free', country: 'DE', appVersion: '1.9.0', betaOptIn: false },
  { id: 'user_demo_004', name: 'Ravi', label: '#004 Ravi · Pro · India · beta opt-in', plan: 'pro', country: 'IN', appVersion: '2.4.0', betaOptIn: true },
  { id: 'user_demo_005', name: 'Aiko', label: '#005 Aiko · Enterprise · Japan', plan: 'enterprise', country: 'JP', appVersion: '3.0.0-beta.1', betaOptIn: true },
  { id: 'user_demo_006', name: 'Bruno', label: '#006 Bruno · Free · Brazil', plan: 'free', country: 'BR', appVersion: '2.0.0', betaOptIn: false },
  { id: 'user_demo_008', name: 'Mia', label: '#008 Mia · Free · United States · beta opt-in', plan: 'free', country: 'US', appVersion: '1.8.3', betaOptIn: true },
  { id: 'user_demo_013', name: 'Sofia', label: '#013 Sofia · Free · Singapore · blocked from AI search', plan: 'free', country: 'SG', appVersion: '2.5.0', betaOptIn: true },
  { id: 'user_demo_017', name: 'Noah', label: '#017 Noah · Pro · Brazil · beta opt-in', plan: 'pro', country: 'BR', appVersion: '2.4.0', betaOptIn: true },
  { id: 'user_demo_020', name: 'Casey', label: '#020 Casey · Free · United States · block-listed', plan: 'free', country: 'US', appVersion: '2.0.0', betaOptIn: false },
]);

export function attributesFor(user: DemoUser) {
  return {
    plan: user.plan,
    country: user.country,
    appVersion: user.appVersion,
    betaOptIn: user.betaOptIn,
    emailDomain: 'acme.io',
    seats: 12,
  };
}

/**
 * Subscribes to the real data plane with the real SDK: one batch call to
 * bootstrap, then live Server-Sent Events. Nothing is simulated.
 */
export function useFlagSnapshot(
  sdkKey: string | null,
  user: DemoUser,
): { snapshot: FlagSnapshot; connected: boolean } {
  const [snapshot, setSnapshot] = useState<FlagSnapshot>({ version: 0, results: {} });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!sdkKey) return;

    const client = new FlagForgeClient({
      apiUrl: API_URL,
      sdkKey,
      userContext: { userId: user.id, attributes: attributesFor(user) },
    });

    const unsubscribe = client.subscribe(setSnapshot);
    void client.ready.then((initial) => {
      setSnapshot(initial);
      setConnected(true);
    });

    return () => {
      unsubscribe();
      client.close();
      setConnected(false);
    };
  }, [sdkKey, user]);

  return { snapshot, connected };
}

export interface CohortResult {
  value: unknown;
  reason: string;
  bucket?: number;
}

/**
 * Evaluate every account through the real batch endpoint, so the comparison
 * table shows genuine server decisions rather than a client-side guess.
 * Re-runs whenever the live config version changes, so flipping a flag in the
 * dashboard also updates the table.
 */
export function useCohort(
  sdkKey: string | null,
  users: readonly DemoUser[],
  version: number,
): Record<string, Record<string, CohortResult>> {
  const [rows, setRows] = useState<Record<string, Record<string, CohortResult>>>({});

  useEffect(() => {
    if (!sdkKey) return;
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        users.map(async (user) => {
          try {
            const response = await fetch(`${API_URL}/v1/evaluate/batch`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-sdk-key': sdkKey,
              },
              body: JSON.stringify({
                userId: user.id,
                attributes: attributesFor(user),
              }),
            });
            if (!response.ok) return [user.id, {}] as const;
            const body = (await response.json()) as {
              flags?: Record<string, CohortResult>;
            };
            return [user.id, body.flags ?? {}] as const;
          } catch {
            return [user.id, {}] as const;
          }
        }),
      );
      if (!cancelled) setRows(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [sdkKey, users, version]);

  return rows;
}