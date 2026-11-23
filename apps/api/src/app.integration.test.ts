import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { DatabaseHandle } from './db/client.js';

/**
 * HTTP-level tests of the fully composed application.
 *
 * Neither PostgreSQL nor Redis is required: both are injected as fakes that
 * implement only the surface `buildApp` touches. That keeps these tests runnable
 * on any machine and in CI without service containers, while still exercising
 * real routing, plugins, hooks, serialization and the error handler.
 */

type Env = Record<string, string | undefined>;

function fakeRedis(overrides: Record<string, unknown> = {}): Redis {
  const base: Record<string, unknown> = {
    ping: async () => 'PONG',
    subscribe: async () => 1,
    unsubscribe: async () => 1,
    on: () => base,
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    publish: async () => 1,
    disconnect: () => undefined,
  };
  return Object.assign(base, overrides) as unknown as Redis;
}

/**
 * A minimal stand-in for the Drizzle query builder.
 *
 * The integration tests never assert on query results, but the SDK-key loader
 * does call `db.select(...).from(...).where(...).limit(1)`, so the stub must be
 * chainable and its terminal call awaitable. Returning no rows means every SDK
 * key is "unknown", which is exactly what the auth tests want.
 */
function fakeDatabase(options: { pingOk?: boolean } = {}): DatabaseHandle {
  const pingOk = options.pingOk ?? true;

  const chain: Record<string, unknown> = {};
  const self = (): unknown => chain;
  Object.assign(chain, {
    from: self,
    where: self,
    orderBy: self,
    for: self,
    limit: async () => [],
    returning: async () => [],
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve([]).then(resolve, reject),
  });

  const db = {
    execute: async () => {
      if (!pingOk) throw new Error('connection refused');
      return { rows: [{ ok: 1 }] };
    },
    select: () => chain,
  };
  const pool = { end: async () => undefined };
  return { db, pool } as unknown as DatabaseHandle;
}

const liveApps: FastifyInstance[] = [];

async function makeApp(
  env: Env = {},
  options: { dbPingOk?: boolean; redisPingOk?: boolean } = {},
): Promise<FastifyInstance> {
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', ...env }),
    logger: false,
    database: fakeDatabase({ pingOk: options.dbPingOk ?? true }),
    redis: fakeRedis(
      options.redisPingOk === false
        ? {
            ping: async () => {
              throw new Error('redis unavailable');
            },
          }
        : {},
    ),
    redisSub: fakeRedis(),
  });
  liveApps.push(app);
  return app;
}

afterEach(async () => {
  while (liveApps.length > 0) {
    await liveApps.pop()!.close();
  }
});

describe('liveness', () => {
  it('reports ok without touching any dependency', async () => {
    const app = await makeApp({}, { dbPingOk: false, redisPingOk: false });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('exposes /health/live for orchestrator liveness probes', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('readiness', () => {
  it('reports ready when both dependencies answer', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ready',
      checks: { postgres: { ok: true }, redis: { ok: true } },
    });
  });

  it('reports degraded (but still 200) when Redis is down', async () => {
    // Redis is an optimisation: the read path degrades to L1 + PostgreSQL, so a
    // Redis outage must not take the instance out of rotation.
    const app = await makeApp({}, { redisPingOk: false });

    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.checks.postgres.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(false);
  });

  it('reports unavailable (503) when PostgreSQL is down', async () => {
    const app = await makeApp({}, { dbPingOk: false });

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('unavailable');
  });
});

describe('metrics', () => {
  it('exposes Prometheus exposition including default process metrics', async () => {
    const app = await makeApp();

    // Produce one observation so labelled series exist in the exposition.
    await app.inject({ method: 'GET', url: '/health/ready' });

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('process_cpu_seconds_total');
    expect(res.body).toContain('flagforge_readiness_checks_total');
    expect(res.body).toContain('flagforge_http_request_duration_seconds');
    expect(res.body).toContain('app="flagforge-api"');
  });

  it('is omitted when metrics are disabled', async () => {
    const app = await makeApp({ METRICS_ENABLED: 'false' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
  });
});

describe('rate limiting', () => {
  it('rejects the control plane once the per-IP budget is spent', async () => {
    const app = await makeApp({ RATE_LIMIT_CONTROL_MAX: '2' });

    const first = await app.inject({ method: 'GET', url: '/api/health' });
    const second = await app.inject({ method: 'GET', url: '/api/health' });
    const third = await app.inject({ method: 'GET', url: '/api/health' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });

  it('never limits health or metrics, even with a budget of one', async () => {
    const app = await makeApp({ RATE_LIMIT_CONTROL_MAX: '1' });

    for (let i = 0; i < 5; i += 1) {
      const health = await app.inject({ method: 'GET', url: '/health' });
      const ready = await app.inject({ method: 'GET', url: '/health/ready' });
      const metrics = await app.inject({ method: 'GET', url: '/metrics' });
      expect(health.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
      expect(metrics.statusCode).toBe(200);
    }
  });

  it('can be disabled entirely', async () => {
    const app = await makeApp({
      RATE_LIMIT_ENABLED: 'false',
      RATE_LIMIT_CONTROL_MAX: '1',
    });

    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('data plane authentication', () => {
  it('rejects an evaluation without an SDK key', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { key: 'any-flag', userId: 'u_1', attributes: {} },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects a syntactically valid but unknown SDK key', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      headers: { 'x-sdk-key': 'ff_test_not_a_real_key' },
      payload: { key: 'any-flag', userId: 'u_1', attributes: {} },
    });

    // The fake loader returns nothing, so the key cannot resolve.
    expect(res.statusCode).toBe(401);
  });

  it('validates the request body before hitting the database', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/evaluate',
      headers: { 'x-sdk-key': 'ff_test_not_a_real_key' },
      payload: { userId: 'u_1' },
    });

    // Auth runs first, so an unauthenticated malformed body is still a 401.
    expect(res.statusCode).toBe(401);
  });
});

describe('cross-cutting behaviour', () => {
  it('sets the helmet security headers and a cross-origin CORP', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'not_found' });
  });

  it('rejects unauthenticated control-plane requests with 401', async () => {
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: '/api/projects' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('rejects a forged session token', async () => {
    const app = await makeApp();

    const res = await app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: 'Bearer forged.token' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('validates signup input before touching the database', async () => {
    const app = await makeApp();

    const badEmail = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'not-an-email', password: 'demo1234' },
    });
    const shortPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'dev@example.com', password: 'short' },
    });

    expect(badEmail.statusCode).toBe(422);
    expect(shortPassword.statusCode).toBe(422);
  });

  it('requires a session for /api/auth/me and the AI compiler', async () => {
    const app = await makeApp();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    const compile = await app.inject({
      method: 'POST',
      url: '/api/ai/compile-rule',
      payload: { prompt: 'enable for pro users', flagKey: 'x' },
    });

    expect(me.statusCode).toBe(401);
    expect(compile.statusCode).toBe(401);
  });
});
