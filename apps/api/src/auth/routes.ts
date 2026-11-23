import type { FastifyInstance } from 'fastify';
import type { AuthService } from './service.js';

export interface AuthRoutesDeps {
  auth: AuthService;
}

/**
 * Account endpoints. These are the only control-plane routes that do not require
 * an existing session.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDeps,
): Promise<void> {
  const { auth } = deps;

  app.get('/api/auth/me', async (req) => {
    const user = await auth.authenticate(req.headers.authorization);
    return { user };
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await auth.signup(body);
    return reply.code(201).send(result);
  });

  app.post('/api/auth/login', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return auth.login(body);
  });

  app.post('/api/auth/demo', async () => auth.demoLogin());

  /**
   * Tokens are stateless, so logout is a client-side discard. The endpoint exists
   * so the UI has one clear call, and so a future token-blocklist is a drop-in.
   */
  app.post('/api/auth/logout', async () => ({ ok: true }));
}