import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlagConfig } from '@flagforge/evaluator';
import { FlagCache, type EnvSnapshot } from './cache.js';
import { InvalidationBus } from './invalidation.js';
import { EvaluationService, type SnapshotLoader } from './service.js';

/**
 * Integration test: two simulated API instances share a Redis L2 + Pub/Sub bus.
 * A write on instance A must invalidate instance B's L1 within one message, and
 * the refresh must be served from L2 (not PostgreSQL).
 *
 * Requires a real Redis. Skipped unless `REDIS_TEST_URL` is set, e.g.
 *   REDIS_TEST_URL=redis://localhost:6379 pnpm --filter @flagforge/api test
 * CI provides one via a service container.
 */
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
const suite = REDIS_TEST_URL ? describe : describe.skip;

function makeSnapshot(environmentId: string, enabled: boolean, version: number): EnvSnapshot {
  const flag: FlagConfig = {
    key: 'kill-switch',
    enabled,
    defaultValue: false,
    rules: [],
    overrides: { allowlist: [], blocklist: [] },
    version,
  };
  return { environmentId, version, flags: { 'kill-switch': flag } };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
  label = 'condition',
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

suite('Redis Pub/Sub invalidation across two API instances', () => {
  const environmentId = `env_test_${randomUUID()}`;
  const connections: Redis[] = [];

  let cacheA: FlagCache;
  let cacheB: FlagCache;
  let serviceA: EvaluationService;
  let serviceB: EvaluationService;
  let busA: InvalidationBus;
  let busB: InvalidationBus;

  let dbCalls = 0;
  let authoritative = makeSnapshot(environmentId, true, 1);

  beforeAll(async () => {
    const make = (): Redis =>
      new Redis(REDIS_TEST_URL!, { maxRetriesPerRequest: 2 });

    const connA = make(); // cache + publisher for instance A
    const subA = make(); // dedicated subscriber for instance A
    const connB = make(); // cache + publisher for instance B
    const subB = make(); // dedicated subscriber for instance B
    connections.push(connA, subA, connB, subB);

    cacheA = new FlagCache(connA, { namespace: 'flagforge-test', ttlSeconds: 60 });
    cacheB = new FlagCache(connB, { namespace: 'flagforge-test', ttlSeconds: 60 });

    const loader: SnapshotLoader = {
      async loadEnvironmentByKeyHash() {
        return {
          id: environmentId,
          name: 'prod',
          projectId: 'project_test',
          sdkKeyPrefix: 'ff_live_test',
        };
      },
      async loadSnapshot() {
        dbCalls += 1;
        return authoritative;
      },
    };

    serviceA = new EvaluationService(cacheA, loader);
    serviceB = new EvaluationService(cacheB, loader);

    busA = new InvalidationBus(connA, subA);
    busB = new InvalidationBus(connB, subB);

    // Both instances react to invalidation by refreshing their own L1.
    await busA.start((msg) => serviceA.refreshEnvironment(msg.environmentId));
    await busB.start((msg) => serviceB.refreshEnvironment(msg.environmentId));

    // Ensure a clean L2 for this randomised environment id.
    await cacheA.deleteL2(environmentId);
  });

  afterAll(async () => {
    await busA?.stop();
    await busB?.stop();
    for (const conn of connections) conn.disconnect();
  });

  it('serves the cold read from DB, the peer read from L2, then invalidates both L1s', async () => {
    // 1. Instance A cold read → PostgreSQL, populates L1 + L2.
    const coldA = await serviceA.getSnapshot(environmentId);
    expect(coldA.cacheStatus).toBe('DB-FALLBACK');
    expect(dbCalls).toBe(1);

    // 2. Instance B read → L2 hit (no extra DB call), populates its own L1.
    const warmB = await serviceB.getSnapshot(environmentId);
    expect(warmB.cacheStatus).toBe('L2-HIT');
    expect(dbCalls).toBe(1);
    expect(cacheA.getL1(environmentId)?.version).toBe(1);
    expect(cacheB.getL1(environmentId)?.version).toBe(1);

    // 3. Simulate a control-plane write: bump the authoritative snapshot to v2,
    //    write L2 (as afterCommit does), then publish the invalidation message.
    authoritative = makeSnapshot(environmentId, false, 2);
    await cacheB.setL2(authoritative);
    await busA.publish({
      environmentId,
      flagKey: 'kill-switch',
      action: 'flag.toggled',
      version: 2,
    });

    // 4. Both instances must refresh their L1 to v2 purely from the message.
    await waitFor(
      () =>
        cacheA.getL1(environmentId)?.version === 2 &&
        cacheB.getL1(environmentId)?.version === 2,
      5_000,
      'both L1 caches to reach version 2',
    );

    // 5. No extra PostgreSQL reads: refresh was served from L2.
    expect(dbCalls).toBe(1);

    // 6. Post-invalidation reads are L1 hits and reflect the kill switch.
    const afterA = await serviceA.getSnapshot(environmentId);
    expect(afterA.cacheStatus).toBe('L1-HIT');
    expect(afterA.snapshot.version).toBe(2);
    const evalA = await serviceA.evaluate(environmentId, 'kill-switch', {
      userId: 'user_1',
    });
    expect(evalA.result?.reason).toBe('KILL_SWITCH_OFF');
    expect(evalA.result?.value).toBe(false);
  });
});