import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, type DatabaseHandle } from './db/client.js';

/**
 * End-to-end SaaS journey against a real PostgreSQL database.
 *
 * Gated on `DATABASE_TEST_URL` (CI sets it and runs migrations first) so the
 * normal `pnpm test` stays runnable without infrastructure.
 */

const DATABASE_TEST_URL = process.env.DATABASE_TEST_URL;
const suite = DATABASE_TEST_URL ? describe : describe.skip;

/**
 * A tiny in-memory Redis covering exactly what the app uses here: the L2
 * snapshot store and Pub/Sub. Enough to exercise invalidation without adding a
 * second service dependency to this test.
 */
class MemoryRedis {
  private readonly store = new Map<string, string>();
  private readonly listeners = new Set<
    (channel: string, message: string) => void
  >();
  private readonly channels = new Set<string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async publish(channel: string, message: string): Promise<number> {
    let delivered = 0;
    for (const listener of this.listeners) {
      if (this.channels.has(channel)) {
        listener(channel, message);
        delivered += 1;
      }
    }
    return delivered;
  }

  on(event: string, listener: (channel: string, message: string) => void): this {
    if (event === 'message') this.listeners.add(listener);
    return this;
  }

  async subscribe(channel: string): Promise<number> {
    this.channels.add(channel);
    return 1;
  }

  async unsubscribe(channel: string): Promise<number> {
    this.channels.delete(channel);
    return 1;
  }

  disconnect(): void {
    /* no-op */
  }
}

suite('SaaS journey (real PostgreSQL)', () => {
  let app: FastifyInstance;
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_TEST_URL!);
    const redis = new MemoryRedis() as unknown as Redis;
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: DATABASE_TEST_URL!,
        SESSION_SECRET: 'journey-test-secret-0123456789',
      }),
      logger: false,
      database: handle,
      redis,
      redisSub: redis,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await handle?.pool.end();
  });

  it('signs up, provisions a workspace, and serves a flag through the data plane', async () => {
    const email = `journey_${randomUUID()}@example.com`;

    // 1. Signup auto-provisions a project with two environments.
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email, password: 'demo1234', name: 'Journey' },
    });
    expect(signup.statusCode).toBe(201);

    const body = signup.json() as {
      token: string;
      user: { email: string };
      project: { id: string };
      environments: Array<{ id: string; name: string; sdkKey: string }>;
    };
    expect(body.user.email).toBe(email);

    const auth = { authorization: `Bearer ${body.token}` };
    const production = body.environments.find((env) => env.name === 'production');
    expect(production?.sdkKey).toMatch(/^ff_live_[0-9a-f]{32}$/);

    // 2. The workspace is visible to its owner.
    const projects = (
      await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    ).json() as { projects: Array<{ id: string }> };
    expect(projects.projects).toHaveLength(1);
    expect(projects.projects[0]!.id).toBe(body.project.id);

    // 3. Create a flag in the production environment.
    const created = await app.inject({
      method: 'POST',
      url: '/api/flags',
      headers: auth,
      payload: {
        environmentId: production!.id,
        key: 'journey_flag',
        name: 'Journey Flag',
        description: 'created by the journey test',
        defaultValue: false,
        enabled: true,
        rules: [],
      },
    });
    expect(created.statusCode).toBe(201);
    const flag = created.json().flag as { id: string };

    const evaluate = () =>
      app.inject({
        method: 'POST',
        url: '/v1/evaluate',
        headers: { 'x-sdk-key': production!.sdkKey },
        payload: { key: 'journey_flag', userId: 'user_journey', attributes: {} },
      });

    // 4. The returned SDK key authenticates against the data plane.
    const first = await evaluate();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      value: false,
      reason: 'DEFAULT_FALLBACK',
    });

    // 5. Mutate the served value (new version + audit row + invalidation).
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/flags/${flag.id}`,
      headers: auth,
      payload: { defaultValue: true },
    });
    expect(patched.statusCode).toBe(200);

    // 6. Cache invalidation: the next data-plane read must reflect the new value.
    let flipped = await evaluate();
    for (let attempt = 0; attempt < 20 && flipped.json().value !== true; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      flipped = await evaluate();
    }
    expect(flipped.json().value).toBe(true);

    // 7. The audit trail records both mutations.
    const audit = (
      await app.inject({
        method: 'GET',
        url: `/api/environments/${production!.id}/audit-logs`,
        headers: auth,
      })
    ).json() as { auditLogs: Array<{ action: string }> };
    const actions = audit.auditLogs.map((entry) => entry.action);
    expect(actions).toContain('flag.created');
    expect(actions).toContain('flag.updated');
  });

  it('isolates workspaces: another account cannot read or mutate the flag', async () => {
    const ownerEmail = `owner_${randomUUID()}@example.com`;
    const otherEmail = `other_${randomUUID()}@example.com`;

    const owner = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: ownerEmail, password: 'demo1234' },
      })
    ).json() as {
      token: string;
      project: { id: string };
      environments: Array<{ id: string; name: string }>;
    };
    const other = (
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: otherEmail, password: 'demo1234' },
      })
    ).json() as { token: string };

    const ownerAuth = { authorization: `Bearer ${owner.token}` };
    const otherAuth = { authorization: `Bearer ${other.token}` };
    const production = owner.environments.find((env) => env.name === 'production')!;

    const flag = (
      await app.inject({
        method: 'POST',
        url: '/api/flags',
        headers: ownerAuth,
        payload: {
          environmentId: production.id,
          key: 'private_flag',
          name: 'Private Flag',
          defaultValue: false,
          enabled: true,
          rules: [],
        },
      })
    ).json().flag as { id: string };

    // The other account's project list must not contain the owner's project.
    const otherProjects = (
      await app.inject({ method: 'GET', url: '/api/projects', headers: otherAuth })
    ).json() as { projects: Array<{ id: string }> };
    expect(otherProjects.projects.some((p) => p.id === owner.project.id)).toBe(
      false,
    );

    // Cross-tenant ids are indistinguishable from missing ones.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/flags/${flag.id}`,
          headers: otherAuth,
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/flags/${flag.id}`,
          headers: otherAuth,
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(404);

    // The owner still can.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/flags/${flag.id}`,
          headers: ownerAuth,
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(200);
  });
});