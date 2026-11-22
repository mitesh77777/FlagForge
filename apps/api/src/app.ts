import cors from '@fastify/cors';
import { evaluateAll } from '@flagforge/evaluator';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { registerAiRoutes } from './ai/routes.js';
import type { AppConfig } from './config.js';
import { FlagService } from './control-plane/flag-service.js';
import { registerControlPlane } from './control-plane/routes.js';
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

export interface BuildAppOptions {
  config: AppConfig;
  /** Disable Fastify logging (tests). */
  logger?: boolean;
  /** Inject resources for tests; otherwise created from `config`. */
  database?: DatabaseHandle;
  redis?: Redis;
  redisSub?: Redis;
}

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
    exposedHeaders: ['X-Cache-Status', 'X-Eval-Time-Ms'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-sdk-key',
      'x-actor-email',
    ],
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
  const service = new EvaluationService(cache, loader);
  const hub = new SseHub();
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

  // ── Routes ─────────────────────────────────────────────────────────────────
  await registerDataPlane(app, { service, hub });
  await registerControlPlane(app, { flagService, config });
  await registerAiRoutes(app, { config });

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

  app.get('/health', async () => ({
    status: 'ok',
    l1Entries: cache.l1Size(),
    sseClients: hub.size,
  }));

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
    hub.closeAll();
    await bus.stop();
    if (ownsSub) redisSub.disconnect();
    if (ownsRedis) redis.disconnect();
    if (ownsDb) await dbHandle.pool.end();
  });

  return app;
}