import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { evaluateAll } from '@flagforge/evaluator';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { registerAiRoutes } from './ai/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import { AuthService } from './auth/service.js';
import type { AppConfig } from './config.js';
import { FlagService } from './control-plane/flag-service.js';
import { registerControlPlane } from './control-plane/routes.js';
import { extractSdkKey } from './data-plane/auth.js';
import { FlagCache } from './data-plane/cache.js';
import {
  InvalidationBus,
  type InvalidationHandler,
} from './data-plane/invalidation.js';
import { createDbSnapshotLoader } from './data-plane/repository.js';
import { registerDataPlane } from './data-plane/routes.js';
import { EvaluationService } from './data-plane/service.js';
import { SseHub } from './data-plane/sse.js';
import { createDatabase, type DatabaseHandle } from './db/client.js';
import { AppError } from './lib/errors.js';
import { createMetrics, type Metrics } from './lib/metrics.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Disable Fastify logging (tests). */
  logger?: boolean;
  /** Inject resources for tests; otherwise created from `config`. */
  database?: DatabaseHandle;
  redis?: Redis;
  redisSub?: Redis;
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Strip the query string. `req.url` is the raw target, so it must be parsed. */
function pathOf(url: string): string {
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

function isDataPlanePath(url: string): boolean {
  return pathOf(url).startsWith('/v1/');
}

/** Health and metrics must never consume (or be blocked by) a rate-limit budget. */
function isRateLimitExempt(url: string): boolean {
  const path = pathOf(url);
  return path === '/' || path.startsWith('/health') || path.startsWith('/metrics');
}

async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} check timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const READINESS_TIMEOUT_MS = 2_000;

/**
 * Compose the two planes around a shared evaluator + cache.
 *
 *   Control plane  /api/*   → PostgreSQL (source of truth), audit, cache fill
 *   Data plane     /v1/*    → L1 → L2 → DB, SSE, evaluation
 *
 * The Pub/Sub subscriber is the glue: on invalidation it refreshes this
 * instance's L1 and pushes the fresh snapshot to matching SSE clients.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true,
    // Cache the preflight for a day: without this every cross-origin POST to
    // /v1/evaluate pays a second round trip, which dominates a sub-5ms path.
    maxAge: 86_400,
    exposedHeaders: ['X-Cache-Status', 'X-Eval-Time-Ms'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-sdk-key',
      'x-actor-email',
    ],
  });

  // Security headers. The API returns JSON only (never HTML), so CSP would be
  // noise, but CORP must be cross-origin: the dashboard is served from a
  // different origin and reads these responses from the browser.
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // ── Resource ownership (injected resources are left for the caller) ────────
  const ownsDb = !options.database;
  const dbHandle = options.database ?? createDatabase(config.DATABASE_URL);

  const ownsRedis = !options.redis;
  const redis =
    options.redis ??
    new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });

  const ownsSub = !options.redisSub;
  const redisSub =
    options.redisSub ??
    new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });

  // ── Shared core ────────────────────────────────────────────────────────────
  const cache = new FlagCache(redis, {
    namespace: config.CACHE_NAMESPACE,
    ttlSeconds: config.L2_CACHE_TTL_SECONDS,
    onError: (err) => app.log.warn({ err }, 'L2 cache error; degraded to L1+DB'),
  });
  const loader = createDbSnapshotLoader(dbHandle.db);
  const hub = new SseHub();

  // Metrics needs live gauges from the hub and the service; the service needs
  // metrics for its cold-load counter. Break the cycle with a mutable holder
  // whose functions are only invoked at scrape/request time.
  const gaugeSources = {
    sseClients: () => 0,
    inflightLoads: () => 0,
    coalescedLoads: () => 0,
  };
  const metrics = createMetrics(gaugeSources);

  const service = new EvaluationService(cache, loader, {
    onSnapshotLoad: ({ coalesced }) =>
      metrics.snapshotLoads.inc({ cause: coalesced ? 'coalesced' : 'postgres' }),
  });

  gaugeSources.sseClients = () => hub.size;
  gaugeSources.inflightLoads = () => service.inflightLoads;
  gaugeSources.coalescedLoads = () => service.coalescedLoads;

  const bus = new InvalidationBus(redis, redisSub, undefined, (err) =>
    app.log.error({ err }, 'invalidation bus error'),
  );

  const flagService = new FlagService({
    db: dbHandle.db,
    cache,
    bus,
    loader,
    logger: app.log,
  });

  const auth = new AuthService({
    db: dbHandle.db,
    flags: flagService,
    sessionSecret: config.SESSION_SECRET,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
    demoEmail: config.DEMO_EMAIL,
    demoPassword: config.DEMO_PASSWORD,
  });

  // ── Rate limiting (per SDK key on the data plane, per IP on the control) ───
  if (config.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      timeWindow: config.RATE_LIMIT_WINDOW_MS,
      max: (req: FastifyRequest) =>
        isDataPlanePath(req.url)
          ? config.RATE_LIMIT_DATA_MAX
          : config.RATE_LIMIT_CONTROL_MAX,
      keyGenerator: (req: FastifyRequest) =>
        isDataPlanePath(req.url) ? (extractSdkKey(req) ?? req.ip) : req.ip,
      allowList: (req: FastifyRequest) => isRateLimitExempt(req.url),
      // `statusCode` must be present: the plugin surfaces this object through the
      // error handler, which maps unknown errors to 500.
      errorResponseBuilder: (_req, context) => ({
        statusCode: 429,
        error: 'rate_limited',
        message: `rate limit exceeded; retry in ${Math.ceil(
          Number(context.ttl) / 1000,
        )}s`,
      }),
    });
  }

  // ── Routes ─────────────────────────────────────────────────────────────────
  await registerDataPlane(app, { service, hub });
  await registerAuthRoutes(app, { auth });
  await registerControlPlane(app, {
    flagService,
    auth,
    config,
    service,
    metrics: config.METRICS_ENABLED ? metrics : undefined,
  });
  await registerAiRoutes(app, {
    config,
    auth,
    onCompile: (source) => metrics.aiCompiles.inc({ source }),
  });

  // ── Request instrumentation ────────────────────────────────────────────────
  // Derived entirely from what the app already does: latency from Fastify's own
  // timer, cache tier from the response header the data plane sets.
  app.addHook('onResponse', (req, reply, done) => {
    metrics.httpDuration.observe(
      {
        method: req.method,
        route: req.routeOptions?.url ?? 'unmatched',
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );

    const cacheStatus = reply.getHeader('x-cache-status');
    if (typeof cacheStatus === 'string') {
      metrics.cacheLookups.inc({
        tier:
          cacheStatus === 'L1-HIT' ? 'l1' : cacheStatus === 'L2-HIT' ? 'l2' : 'db',
      });
    }
    done();
  });

  // ── Health ─────────────────────────────────────────────────────────────────
  const checkPostgres = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await withTimeout(
        Promise.resolve(dbHandle.db.execute(sql`select 1`)),
        READINESS_TIMEOUT_MS,
        'postgres',
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  };

  const checkRedis = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await withTimeout(redis.ping(), READINESS_TIMEOUT_MS, 'redis');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  };

  // Liveness — the process is up. Never touches dependencies.
  app.get('/health', async () => ({
    status: 'ok',
    l1Entries: cache.l1Size(),
    sseClients: hub.size,
  }));

  app.get('/health/live', async () => ({ status: 'ok' }));

  /**
   * Readiness — can this instance serve correct traffic?
   *
   * PostgreSQL is a hard dependency: cold reads and every control-plane write
   * need it. Redis is an optimisation, and the read path degrades to L1 + DB
   * without it, so a Redis outage is reported as `degraded` (HTTP 200) rather
   * than `unavailable`, and the orchestrator keeps routing to this instance.
   */
  app.get('/health/ready', async (_req, reply) => {
    const [postgres, redisCheck] = await Promise.all([
      checkPostgres(),
      checkRedis(),
    ]);

    metrics.readinessChecks.inc({
      check: 'postgres',
      result: postgres.ok ? 'ok' : 'fail',
    });
    metrics.readinessChecks.inc({
      check: 'redis',
      result: redisCheck.ok ? 'ok' : 'fail',
    });

    const status = !postgres.ok
      ? 'unavailable'
      : redisCheck.ok
        ? 'ready'
        : 'degraded';

    return reply.code(postgres.ok ? 200 : 503).send({
      status,
      checks: {
        postgres: postgres.ok ? { ok: true } : { ok: false, error: postgres.error },
        redis: redisCheck.ok ? { ok: true } : { ok: false, error: redisCheck.error },
      },
      sseClients: hub.size,
      l1Entries: cache.l1Size(),
    });
  });

  // ── Invalidation subscriber → L1 refresh → SSE fan-out ─────────────────────
  const onInvalidation: InvalidationHandler = async (message) => {
    const snapshot = await service.refreshEnvironment(message.environmentId);
    const delivered = hub.broadcastEach(
      message.environmentId,
      'flags',
      (context) => ({
        version: snapshot.version,
        changedKey: message.flagKey,
        action: message.action,
        ts: message.ts,
        ...(context
          ? { results: evaluateAll(snapshot.flags, context) }
          : { flags: snapshot.flags }),
      }),
    );
    metrics.invalidations.inc({ action: message.action });
    app.log.debug(
      {
        environmentId: message.environmentId,
        flagKey: message.flagKey,
        version: snapshot.version,
        sseClients: delivered,
      },
      'flag invalidation applied',
    );
  };

  try {
    await bus.start(onInvalidation);
  } catch (err) {
    // Pub/Sub is a latency optimisation: the L2 TTL (and per-request L2 reads)
    // still bound staleness if the subscription cannot be established at boot.
    app.log.error(
      { err },
      'failed to subscribe to invalidation channel; starting in degraded mode',
    );
  }

  // Keep SSE connections alive through proxies.
  const heartbeat = setInterval(() => hub.heartbeat(), 20_000);
  heartbeat.unref();

  // ── Error handling ─────────────────────────────────────────────────────────
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: 'validation_failed',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code, message: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply
        .code(statusCode)
        .send({ error: 'request_error', message: error.message });
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: 'internal_error', message: 'internal server error' });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `no route for ${req.method} ${req.url}`,
    }),
  );

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    // Tell SSE clients to reconnect promptly instead of cutting them silently.
    hub.closeAll('server shutting down');
    await bus.stop();
    if (ownsSub) redisSub.disconnect();
    if (ownsRedis) redis.disconnect();
    if (ownsDb) await dbHandle.pool.end();
  });

  return app;
}
