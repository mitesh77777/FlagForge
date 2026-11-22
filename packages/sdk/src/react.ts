/**
 * Optional React binding for @flagforge/sdk.
 *
 * Import from `@flagforge/sdk/react` so the core SDK stays dependency-free.
 *
 *   <FlagForgeProvider client={client}>
 *     <App />
 *   </FlagForgeProvider>
 *
 *   const enabled = useFlag('new-checkout-flow', false);
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FlagForgeClient } from './index.js';

const FlagForgeContext = createContext<FlagForgeClient | null>(null);

export interface FlagForgeProviderProps {
  client: FlagForgeClient | null;
  children?: ReactNode;
}

export function FlagForgeProvider({ client, children }: FlagForgeProviderProps) {
  return createElement(FlagForgeContext.Provider, { value: client }, children);
}

export function useFlagForgeClient(): FlagForgeClient | null {
  return useContext(FlagForgeContext);
}

function readValue<T>(
  client: FlagForgeClient | null,
  key: string,
  fallback: T,
): T {
  if (!client) return fallback;
  const value = client.getFlag(key);
  return value === undefined ? fallback : (value as T);
}

/**
 * Subscribe to a single flag. Re-renders whenever a live SSE update arrives.
 */
export function useFlag<T = unknown>(key: string, defaultValue: T): T {
  const client = useContext(FlagForgeContext);
  const [value, setValue] = useState<T>(() =>
    readValue(client, key, defaultValue),
  );

  const fallbackRef = useRef(defaultValue);
  fallbackRef.current = defaultValue;

  useEffect(() => {
    if (!client) return;
    const sync = (): void =>
      setValue(readValue(client, key, fallbackRef.current));
    sync();
    return client.subscribe(sync);
  }, [client, key]);

  return value;
}

/** The whole evaluated snapshot, useful for rendering many flags at once. */
export function useFlags() {
  const client = useContext(FlagForgeContext);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!client) return;
    return client.subscribe(() => forceRender((n) => n + 1));
  }, [client]);

  return client?.getSnapshot().results ?? {};
}