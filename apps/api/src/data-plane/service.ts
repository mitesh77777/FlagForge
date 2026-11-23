import { evaluateFlag, type EvaluationContext, type EvaluationResult, type FlagConfig } from '@flagforge/evaluator';
import { Singleflight } from '../lib/singleflight.js';
import type { EnvSnapshot, CacheStatus, FlagCache } from './cache.js';

export interface EnvironmentRef {
  id: string;
  name: string;
  projectId: string;
  sdkKeyPrefix: string;
}

/** The only component allowed to touch PostgreSQL on the data plane. */
export interface SnapshotLoader {
  loadEnvironmentByKeyHash(keyHash: string): Promise<EnvironmentRef | null>;
  loadSnapshot(environmentId: string): Promise<EnvSnapshot>;
}

export interface EvaluateOutcome {
  result: EvaluationResult | null;
  cacheStatus: CacheStatus;
}

export interface BatchOutcome {
  flags: Record<string, EvaluationResult>;
  version: number;
  cacheStatus: CacheStatus;
}

export interface EvaluationServiceOptions {
  /**
   * Called after a cold snapshot load. `coalesced` is `true` when this caller
   * joined an in-flight load rather than querying PostgreSQL itself.
   */
  onSnapshotLoad?: (info: { coalesced: boolean }) => void;
}

/**
 * The read path. Implements L1 → L2 → DB resolution with strict "no DB on cache
 * hit" semantics, and exposes explicit invalidation hooks used by the Pub/Sub
 * subscriber.
 */
export class EvaluationService {
  /** Environment resolution is tiny and immutable enough to memoise in-process. */
  private readonly envRefs = new Map<string, EnvironmentRef>();

  /** Coalesces concurrent cold loads so a stampede costs one query per environment. */
  private readonly flight = new Singleflight();

  constructor(
    private readonly cache: FlagCache,
    private readonly loader: SnapshotLoader,
    private readonly options: EvaluationServiceOptions = {},
  ) {}

  // ── Environment / SDK-key resolution ───────────────────────────────────────
  async resolveEnvironment(keyHash: string): Promise<EnvironmentRef | null> {
    const cached = this.envRefs.get(keyHash);
    if (cached) return cached;
    const ref = await this.loader.loadEnvironmentByKeyHash(keyHash);
    if (ref) this.envRefs.set(keyHash, ref);
    return ref;
  }

  forgetEnvironmentKey(keyHash: string): void {
    this.envRefs.delete(keyHash);
  }

  // ── Snapshot resolution (two-tier) ─────────────────────────────────────────
  async getSnapshot(
    environmentId: string,
  ): Promise<{ snapshot: EnvSnapshot; cacheStatus: CacheStatus }> {
    const l1 = this.cache.getL1(environmentId);
    if (l1) return { snapshot: l1, cacheStatus: 'L1-HIT' };

    const l2 = await this.cache.getL2(environmentId);
    if (l2) {
      this.cache.setL1(l2);
      return { snapshot: l2, cacheStatus: 'L2-HIT' };
    }

    // Cold. Coalesce concurrent misses, and populate both tiers *inside* the
    // single load so a coalesced group performs exactly one query and one write.
    const { value: snapshot, joined } = await this.flight.run(
      `snapshot:${environmentId}`,
      async () => {
        const loaded = await this.loader.loadSnapshot(environmentId);
        this.cache.setL1(loaded);
        await this.cache.setL2(loaded);
        return loaded;
      },
    );

    this.options.onSnapshotLoad?.({ coalesced: joined });
    return { snapshot, cacheStatus: 'DB-FALLBACK' };
  }

  /**
   * Purge this instance's L1 entry. Called immediately on invalidation so the
   * next read cannot serve stale data even before the refresh completes.
   */
  invalidateEnvironment(environmentId: string): void {
    this.cache.deleteL1(environmentId);
  }

  /**
   * Re-read the authoritative snapshot (L2, else DB) and re-populate L1.
   * Returns the fresh snapshot for SSE broadcast.
   *
   * Deliberately NOT coalesced. A refresh is triggered by an invalidation, i.e.
   * the database already holds newer data than any load that may currently be in
   * flight. Joining such a load would repopulate L1 with the *pre-invalidation*
   * snapshot and serve stale flags until the next invalidation or TTL expiry.
   */
  async refreshEnvironment(environmentId: string): Promise<EnvSnapshot> {
    this.cache.deleteL1(environmentId);
    const l2 = await this.cache.getL2(environmentId);
    if (l2) {
      this.cache.setL1(l2);
      return l2;
    }
    const snapshot = await this.loader.loadSnapshot(environmentId);
    this.cache.setL1(snapshot);
    await this.cache.setL2(snapshot);
    return snapshot;
  }

  // ── Evaluation ─────────────────────────────────────────────────────────────
  async evaluate(
    environmentId: string,
    key: string,
    context: EvaluationContext,
  ): Promise<EvaluateOutcome> {
    const { snapshot, cacheStatus } = await this.getSnapshot(environmentId);
    const config = snapshot.flags[key];
    if (!config) return { result: null, cacheStatus };
    return { result: evaluateFlag(config, context), cacheStatus };
  }

  async evaluateBatch(
    environmentId: string,
    context: EvaluationContext,
    keys?: string[],
  ): Promise<BatchOutcome> {
    const { snapshot, cacheStatus } = await this.getSnapshot(environmentId);
    const selected: Array<[string, FlagConfig]> = keys
      ? keys
          .map((k) => [k, snapshot.flags[k]] as const)
          .filter((entry): entry is [string, FlagConfig] => entry[1] !== undefined)
      : Object.entries(snapshot.flags);

    const flags: Record<string, EvaluationResult> = {};
    for (const [key, config] of selected) {
      flags[key] = evaluateFlag(config, context);
    }
    return { flags, version: snapshot.version, cacheStatus };
  }

  /** Force every L1 entry to be dropped (used on config-version bumps). */
  clearLocalCache(): void {
    this.cache.clearL1();
    this.envRefs.clear();
  }

  // ── Introspection (surfaced as metrics gauges) ─────────────────────────────
  /** Distinct environments with a snapshot load in flight right now. */
  get inflightLoads(): number {
    return this.flight.size;
  }

  /** Cumulative callers that coalesced onto someone else's load. */
  get coalescedLoads(): number {
    return this.flight.coalescedCalls;
  }
}
