/**
 * In-process request coalescing (a "singleflight").
 *
 * On a cold cache, N concurrent requests for the same environment would each
 * miss L1 and L2 and independently query PostgreSQL. Singleflight collapses them
 * into one load: the first caller runs `fn`, everyone else awaits the same
 * promise. Cold-start database load is therefore bounded by the number of
 * *distinct* environments being resolved, not by the number of in-flight
 * requests.
 *
 * The return value reports whether the call joined an existing load, so the
 * caller can emit accurate metrics.
 */
export interface SingleflightResult<T> {
  value: T;
  /** `true` when this caller awaited an in-flight load rather than starting one. */
  joined: boolean;
}

export class Singleflight {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private coalesced = 0;

  async run<T>(key: string, fn: () => Promise<T>): Promise<SingleflightResult<T>> {
    const existing = this.inflight.get(key);
    if (existing) {
      this.coalesced += 1;
      return { value: (await existing) as T, joined: true };
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        // Delete before the promise settles for awaiters, so a call arriving
        // immediately after completion starts a fresh load rather than joining
        // a settled one.
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return { value: (await promise) as T, joined: false };
  }

  /** Loads that are currently in flight, one entry per distinct key. */
  get size(): number {
    return this.inflight.size;
  }

  /** Total callers that joined an in-flight load instead of starting one. */
  get coalescedCalls(): number {
    return this.coalesced;
  }
}
