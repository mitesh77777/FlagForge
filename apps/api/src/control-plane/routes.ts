import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { NotFoundError } from '../lib/errors.js';
import { safeEqual } from '../lib/sdk-key.js';
import {
  createEnvironmentSchema,
  createProjectSchema,
  flagInputSchema,
  flagUpdateSchema,
} from '../schemas.js';
import type { FlagService } from './flag-service.js';

export interface ControlPlaneDeps {
  flagService: FlagService;
  config: AppConfig;
}

function actorOf(req: FastifyRequest, config: AppConfig): string {
  const header = req.headers['x-actor-email'];
  if (typeof header === 'string' && header.includes('@')) return header;
  return config.DEFAULT_ACTOR_EMAIL;
}

/**
 * Control plane (management API). Low-frequency writes guarded by an optional
 * bearer token; every mutation records the acting identity in the audit log.
 */
export async function registerControlPlane(
  app: FastifyInstance,
  deps: ControlPlaneDeps,
): Promise<void> {
  const { flagService, config } = deps;

  const requireAdmin = async (
    req: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    if (!config.ADMIN_API_TOKEN) return; // open in demo mode
    const auth = req.headers.authorization ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token || !safeEqual(token, config.ADMIN_API_TOKEN)) {
      const err = new Error('unauthorized');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }
  };

  const admin = { preHandler: requireAdmin };

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/api/health', async () => ({ status: 'ok', plane: 'control' }));

  // ── Projects ───────────────────────────────────────────────────────────────
  app.get('/api/projects', async () => ({ projects: await flagService.listProjects() }));

  app.post('/api/projects', admin, async (req, reply) => {
    const input = createProjectSchema.parse(req.body);
    const project = await flagService.createProject(input);
    return reply.code(201).send({ project });
  });

  // ── Environments ───────────────────────────────────────────────────────────
  app.get('/api/environments', async (req) => {
    const query = req.query as { projectId?: string };
    return { environments: await flagService.listEnvironments(query.projectId) };
  });

  app.post('/api/environments', admin, async (req, reply) => {
    const input = createEnvironmentSchema.parse(req.body);
    const result = await flagService.createEnvironment(input);
    return reply.code(201).send(result);
  });

  app.post('/api/environments/:id/rotate-key', admin, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { tier?: 'live' | 'test' };
    const tier = body.tier === 'test' ? 'test' : 'live';
    return flagService.rotateSdkKey(id, tier);
  });

  // ── Flags ──────────────────────────────────────────────────────────────────
  app.get('/api/environments/:id/flags', async (req) => {
    const { id } = req.params as { id: string };
    await flagService.getEnvironment(id);
    return { flags: await flagService.listFlags(id) };
  });

  app.post('/api/environments/:id/flags', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = flagInputSchema.parse(req.body);
    const flag = await flagService.createFlag(id, input, actorOf(req, config));
    return reply.code(201).send({ flag });
  });

  app.get('/api/flags/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { flag: await flagService.getFlagById(id) };
  });

  app.patch('/api/flags/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    const patch = flagUpdateSchema.parse(req.body);
    const flag = await flagService.updateFlag(id, patch, actorOf(req, config));
    return { flag };
  });

  app.delete('/api/flags/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    return flagService.deleteFlag(id, actorOf(req, config));
  });

  // ── Audit log ──────────────────────────────────────────────────────────────
  app.get('/api/environments/:id/audit-logs', async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    return { auditLogs: await flagService.listAuditLogs(id, Number.isFinite(limit) ? limit : 50) };
  });

  // ── Guest sandbox bootstrap (zero-friction demo) ────────────────────────────
  app.get('/api/sandbox', async () => {
    const sandbox = await flagService.getSandbox();
    if (!sandbox) {
      throw new NotFoundError('demo project not seeded — run the seed script');
    }
    return sandbox;
  });
}
