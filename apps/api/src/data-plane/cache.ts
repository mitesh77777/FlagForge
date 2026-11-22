import type { Redis } from 'ioredis';
import type { FlagConfig } from '@flagforge/evaluator';

/**
 * A fully materialised view of one environment's flags. This is the exact object
 * stored in L1 (in-process Map) and L2 (Redis JSON), and streamed over SSE.
 */
export interface EnvSnapshot {
  environmentId: string;
  /** Highest flag version in the snapshot; lets SDKs skip redundant updates. */
  version: number;
  flags: Record<string, FlagConfig>;
}

export type CacheStatus = 'L1-HIT' | 'L2-HIT' | 'DB-FALLBACK';

export interface FlagCacheOptions {
  namespace: string;
  ttlSeconds: number;
  /** Called when Redis L2 operations fail (the cache then degrades to L1+DB). */
  onError?: (err: unknown) => void;
}

/**
 * Two-tier flag cache.
 *
 *   L1  in-process `Map`      → sub-millisecond, per-instance, no I/O
 *   L2  Redis JSON string     → shared across instances, survives restarts
 *   ──  PostgreSQL            → cold fallback only (owned by the loader)
 *
 * The data plane never touches PostgreSQL while either tier is warm.
 */
export class FlagCache {
  private readonly l1 = new Map<string, EnvSnapshot>();

  constructor(
    private readonly redis: Redis,
    private readonly options: FlagCacheOptions,
  ) {}

  /** Redis key holding the JSON snapshot for an environment. */
  l2Key(environmentId: string): string {
    return `${this.options.namespace}:env:${environmentId}:flags`;
  }

  // ── L1 ────────────────────────────────────────────────────────────────────
  getL1(environmentId: string): EnvSnapshot | undefined {
    return this.l1.get(environmentId);
  }

  setL1(snapshot: EnvSnapshot): void {
    this.l1.set(snapshot.environmentId, snapshot);
  }

  deleteL1(environmentId: string): boolean {
    return this.l1.delete(environmentId);
  }

  clearL1(): void {
    this.l1.clear();
  }

  l1Size(): number {
    return this.l1.size;
  }

  // ── L2 ────────────────────────────────────────────────────────────────────
  async getL2(environmentId: string): Promise<EnvSnapshot | null> {
    try {
      const raw = await this.redis.get(this.l2Key(environmentId));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as EnvSnapshot;
      } catch {
        // Corrupt entry — drop it so the next read falls back to PostgreSQL.
        await this.deleteL2(environmentId);
        return null;
      }
    } catch (err) {
      // Redis is an optimisation, never a dependency. Degrade to DB fallback.
      this.options.onError?.(err);
      return null;
    }
  }

  async setL2(snapshot: EnvSnapshot): Promise<void> {
    try {
      const key = this.l2Key(snapshot.environmentId);
      const payload = JSON.stringify(snapshot);
      if (this.options.ttlSeconds > 0) {
        await this.redis.set(key, payload, 'EX', this.options.ttlSeconds);
      } else {
        await this.redis.set(key, payload);
      }
    } catch (err) {
      this.options.onError?.(err);
    }
  }

  async deleteL2(environmentId: string): Promise<void> {
    try {
      await this.redis.del(this.l2Key(environmentId));
    } catch (err) {
      this.options.onError?.(err);
    }
  }
}
