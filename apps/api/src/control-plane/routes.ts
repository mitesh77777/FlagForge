import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService, AuthUser } from '../auth/service.js';
import type { AppConfig } from '../config.js';
import type { EvaluationService } from '../data-plane/service.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { Metrics } from '../lib/metrics.js';
import { safeEqual } from '../lib/sdk-key.js';
import {
  createEnvironmentSchema,
  flagCreateSchema,
  flagInputSchema,
  flagUpdateSchema,
  projectCreateSchema,
} from '../schemas.js';
import type { FlagService } from './flag-service.js';

export interface ControlPlaneDeps {
  flagService: FlagService;
  auth: AuthService;
  config: AppConfig;
  /** The same evaluation service the data plane uses (for the playground). */
  service: EvaluationService;
  /** When present, a Prometheus `/metrics` endpoint is exposed. */
  metrics?: Metrics;
}

/**
 * Authenticated control plane.
 *
 * Every route below (except `/api/health`, `/metrics` and the public demo
 * bootstrap) resolves a session and then scopes all data access to
 * `projects.owner_id === user.id`. Cross-tenant ids deliberately return 404 so
 * an authenticated user cannot probe for the existence of another workspace.
 */
export async function registerControlPlane(
  app: FastifyInstance,
  deps: ControlPlaneDeps,
): Promise<void> {
  const { flagService, auth, config, metrics, service } = deps;

  /** Optional bearer guard for the operator-only endpoints. */
  const requireAdmin = async (
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    if (!config.ADMIN_API_TOKEN) return; // open in demo mode
    const header = req.headers.authorization ?? '';
    const token = header.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : '';
    if (!token || !safeEqual(token, config.ADMIN_API_TOKEN)) {
      const err = new Error('unauthorized');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }
  };

  const admin = { preHandler: requireAdmin };

  /** Resolve the caller; throws 401 when the session is missing or invalid. */
  const currentUser = (req: FastifyRequest): Promise<AuthUser> =>
    auth.authenticate(req.headers.authorization);

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({ status: 'ok', plane: 'control' }));

  // ── Metrics (Prometheus text exposition) ───────────────────────────────────
  // Guarded by the operator token only when one is configured; always exempt
  // from rate limiting so scrapes never consume the budget.
  if (metrics) {
    app.get('/metrics', admin, async (_req, reply) => {
      reply.header('content-type', metrics.registry.contentType);
      return metrics.registry.metrics();
    });
  }

  // ── Projects ───────────────────────────────────────────────────────────────
  app.get('/api/projects', async (req) => {
    const user = await currentUser(req);
    const rows = await flagService.listProjectsFor(user.id);
    return {
      projects: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  app.post('/api/projects', async (req, reply) => {
    const user = await currentUser(req);
    const input = projectCreateSchema.parse(req.body);
    const created = await flagService.createProjectWithEnvironments(user.id, {
      name: input.name,
    });
    return reply.code(201).send(created);
  });

  // ── Environments ───────────────────────────────────────────────────────────
  app.get('/api/environments', async (req) => {
    const user = await currentUser(req);
    const query = req.query as { projectId?: string };
    return {
      environments: await flagService.listEnvironmentsForOwner(
        user.id,
        query.projectId,
      ),
    };
  });

  app.post('/api/environments', async (req, reply) => {
    const user = await currentUser(req);
    const input = createEnvironmentSchema.parse(req.body);
    await flagService.assertProjectOwned(input.projectId, user.id);
    const result = await flagService.createEnvironment(input);
    return reply.code(201).send(result);
  });

  app.post('/api/environments/:id/rotate-key', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertEnvironmentOwned(id, user.id);
    const body = (req.body ?? {}) as { tier?: 'live' | 'test' };
    const tier = body.tier === 'test' ? 'test' : 'live';
    return flagService.rotateSdkKey(
      id,
      tier,
      config.SDK_KEY_ROTATION_GRACE_SECONDS,
    );
  });

  // ── Flags ──────────────────────────────────────────────────────────────────
  app.get('/api/environments/:id/flags', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertEnvironmentOwned(id, user.id);
    return { flags: await flagService.listFlags(id) };
  });

  app.post('/api/environments/:id/flags', async (req, reply) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertEnvironmentOwned(id, user.id);
    const input = flagInputSchema.parse(req.body);
    const flag = await flagService.createFlag(id, input, user.email);
    return reply.code(201).send({ flag });
  });

  /** Dashboard flow: the environment travels in the body. */
  app.post('/api/flags', async (req, reply) => {
    const user = await currentUser(req);
    const input = flagCreateSchema.parse(req.body);
    const { environmentId, ...flagInput } = input;
    await flagService.assertEnvironmentOwned(environmentId, user.id);
    const flag = await flagService.createFlag(environmentId, flagInput, user.email);
    return reply.code(201).send({ flag });
  });

  app.get('/api/flags/:id', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertFlagOwned(id, user.id);
    return { flag: await flagService.getFlagById(id) };
  });

  app.patch('/api/flags/:id', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertFlagOwned(id, user.id);
    const patch = flagUpdateSchema.parse(req.body);
    return { flag: await flagService.updateFlag(id, patch, user.email) };
  });

  app.delete('/api/flags/:id', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertFlagOwned(id, user.id);
    return flagService.deleteFlag(id, user.email);
  });

  // ── Audit log ──────────────────────────────────────────────────────────────
  app.get('/api/environments/:id/audit-logs', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertEnvironmentOwned(id, user.id);
    const query = req.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    return {
      auditLogs: await flagService.listAuditLogs(
        id,
        Number.isFinite(limit) ? limit : 50,
      ),
    };
  });

  // ── Playground ─────────────────────────────────────────────────────────────
  /**
   * Evaluates a flag through the exact service the data plane uses, without
   * needing the raw SDK key (which is hashed at rest and not recoverable). The
   * cache tier and latency are reported so the UI shows a real read path.
   */
  app.post('/api/environments/:id/playground', async (req) => {
    const user = await currentUser(req);
    const { id } = req.params as { id: string };
    await flagService.assertEnvironmentOwned(id, user.id);

    const body = (req.body ?? {}) as {
      key?: unknown;
      userId?: unknown;
      attributes?: unknown;
    };
    if (typeof body.key !== 'string' || body.key.length === 0) {
      throw new ValidationError('key is required');
    }

    const userId =
      typeof body.userId === 'string' && body.userId.length > 0
        ? body.userId
        : 'playground_user';
    const attributes =
      body.attributes &&
      typeof body.attributes === 'object' &&
      !Array.isArray(body.attributes)
        ? (body.attributes as Record<string, string | number | boolean>)
        : {};

    const started = process.hrtime.bigint();
    const { result, cacheStatus } = await service.evaluate(id, body.key, {
      userId,
      attributes,
    });
    const evalMs = (Number(process.hrtime.bigint() - started) / 1e6).toFixed(3);

    if (!result) throw new NotFoundError(`flag "${body.key}" not found`);

    return {
      key: body.key,
      value: result.value,
      reason: result.reason,
      ruleId: result.ruleId ?? null,
      bucket: result.bucket ?? null,
      version: result.version,
      cacheStatus,
      evalMs,
    };
  });

  // ── Public demo bootstrap ──────────────────────────────────────────────────
  // Deliberately unauthenticated, and deliberately limited to the seeded demo
  // project: it powers the zero-login showcase without exposing any tenant data.
  app.get('/api/sandbox', async () => {
    const sandbox = await flagService.getSandbox();
    if (!sandbox) {
      throw new NotFoundError('demo project not seeded — run the seed script');
    }
    return sandbox;
  });
}