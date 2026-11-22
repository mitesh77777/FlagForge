import type { FastifyInstance, FastifyRequest } from 'fastify';
import { evaluateAll, type EvaluationContext } from '@flagforge/evaluator';
import {
  evaluateBatchRequestSchema,
  evaluateRequestSchema,
} from '../schemas.js';
import { authenticateSdk } from './auth.js';
import type { SseHub } from './sse.js';
import type { EvaluationService } from './service.js';

export interface DataPlaneDeps {
  service: EvaluationService;
  hub: SseHub;
}

function msSince(start: bigint): string {
  return (Number(process.hrtime.bigint() - start) / 1e6).toFixed(3);
}

/** Build an evaluation context from SSE query params (browser EventSource). */
function parseStreamContext(req: FastifyRequest): EvaluationContext | undefined {
  const query = req.query as Record<string, unknown>;
  const userId = typeof query.userId === 'string' && query.userId.length > 0
    ? query.userId
    : undefined;
  if (!userId) return undefined;

  let attributes: Record<string, string | number | boolean> = {};
  if (typeof query.attributes === 'string' && query.attributes.length > 0) {
    try {
      const parsed: unknown = JSON.parse(query.attributes);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        attributes = parsed as Record<string, string | number | boolean>;
      }
    } catch {
      // Ignore malformed attributes; evaluate with none.
    }
  }
  return { userId, attributes };
}

/**
 * Data plane HTTP surface. Registered WITHOUT the control-plane auth hooks —
 * it is authenticated purely by SDK key and is optimised for the hot path:
 * no PostgreSQL on a cache hit, cache/eval timing surfaced via response headers.
 */
export async function registerDataPlane(
  app: FastifyInstance,
  deps: DataPlaneDeps,
): Promise<void> {
  const { service, hub } = deps;

  // ── GET /v1/config — raw flag configs for local/client-side evaluation ─────
  app.get('/v1/config', async (req, reply) => {
    const env = await authenticateSdk(req, service);
    const started = process.hrtime.bigint();
    const { snapshot, cacheStatus } = await service.getSnapshot(env.id);

    reply.header('X-Cache-Status', cacheStatus);
    reply.header('X-Eval-Time-Ms', msSince(started));

    return {
      environment: env.name,
      environmentId: env.id,
      version: snapshot.version,
      flags: snapshot.flags,
    };
  });

  // ── POST /v1/evaluate ──────────────────────────────────────────────────────
  app.post('/v1/evaluate', async (req, reply) => {
    const env = await authenticateSdk(req, service);
    const body = evaluateRequestSchema.parse(req.body);

    const started = process.hrtime.bigint();
    const { result, cacheStatus } = await service.evaluate(env.id, body.key, {
      userId: body.userId,
      attributes: body.attributes,
    });
    const elapsedMs = msSince(started);

    reply.header('X-Cache-Status', cacheStatus);
    reply.header('X-Eval-Time-Ms', elapsedMs);

    if (!result) {
      return reply.code(404).send({
        error: 'flag_not_found',
        key: body.key,
        environment: env.name,
      });
    }

    return {
      key: body.key,
      value: result.value,
      reason: result.reason,
      ruleId: result.ruleId ?? null,
      bucket: result.bucket ?? null,
      version: result.version,
      environment: env.name,
    };
  });

  // ── POST /v1/evaluate/batch ────────────────────────────────────────────────
  app.post('/v1/evaluate/batch', async (req, reply) => {
    const env = await authenticateSdk(req, service);
    const body = evaluateBatchRequestSchema.parse(req.body);

    const started = process.hrtime.bigint();
    const outcome = await service.evaluateBatch(
      env.id,
      { userId: body.userId, attributes: body.attributes },
      body.keys,
    );
    const elapsedMs = msSince(started);

    reply.header('X-Cache-Status', outcome.cacheStatus);
    reply.header('X-Eval-Time-Ms', elapsedMs);

    return {
      environment: env.name,
      userId: body.userId,
      version: outcome.version,
      flags: outcome.flags,
    };
  });

  // ── GET /v1/stream (Server-Sent Events) ────────────────────────────────────
  app.get('/v1/stream', async (req, reply) => {
    const env = await authenticateSdk(req, service);
    const context = parseStreamContext(req);
    const { snapshot } = await service.getSnapshot(env.id);

    const origin = req.headers.origin ?? '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    });
    // Take over the socket from Fastify — we write the stream by hand.
    reply.hijack();

    const clientId = hub.add(env.id, reply.raw, context);

    const write = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    write('ready', {
      environment: env.name,
      environmentId: env.id,
      version: snapshot.version,
      userId: context?.userId ?? null,
      clients: hub.countForEnvironment(env.id),
    });

    // Context clients get evaluated results; config clients get the raw config.
    write(
      'flags',
      context
        ? { version: snapshot.version, results: evaluateAll(snapshot.flags, context) }
        : { version: snapshot.version, flags: snapshot.flags },
    );

    const cleanup = (): void => hub.remove(clientId);
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);

    return reply;
  });
}