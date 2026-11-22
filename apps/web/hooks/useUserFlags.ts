'use client';

import { useEffect, useState } from 'react';
import { FlagForgeClient, type FlagSnapshot } from '@flagforge/sdk';
import { API_URL } from '@/lib/api';
import type { CohortUser } from '@/lib/cohort';

/**
 * Drives the hero consumer view through `@flagforge/sdk` over SSE. One client
 * (one EventSource) for the selected user, recreated when the user changes.
 */
export function useUserFlags(sdkKey: string | null, user: CohortUser) {
  const [snapshot, setSnapshot] = useState<FlagSnapshot>({
    version: 0,
    results: {},
  });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!sdkKey) return;

    const client = new FlagForgeClient({
      apiUrl: API_URL,
      sdkKey,
      userContext: {
        userId: user.userId,
        attributes: {
          plan: user.plan,
          country: user.country,
          appVersion: user.appVersion,
          betaOptIn: user.betaOptIn,
          emailDomain: user.emailDomain,
          seats: user.seats,
        },
      },
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
  }, [sdkKey, user.userId]);

  return { snapshot, connected };
}