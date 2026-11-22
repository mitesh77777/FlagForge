import type { FastifyRequest } from 'fastify';
import { hashSdkKey } from '../lib/sdk-key.js';
import type { EnvironmentRef, EvaluationService } from './service.js';

export class UnauthorizedError extends Error {
  readonly statusCode = 401;
  constructor(message = 'missing or invalid SDK key') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Extract the SDK key from (in priority order):
 *   1. `x-sdk-key` header  — used by the server-side SDK
 *   2. `Authorization: Bearer <key>` — convenient for fetch()
 *   3. `?sdkKey=` query    — required by the browser EventSource API
 */
export function extractSdkKey(req: FastifyRequest): string | null {
  const header = req.headers['x-sdk-key'];
  if (typeof header === 'string' && header.length > 0) return header;

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token.length > 0) return token;
  }

  const query = req.query as Record<string, unknown> | undefined;
  const q = query?.sdkKey;
  if (typeof q === 'string' && q.length > 0) return q;

  return null;
}

/** Resolve an SDK key to its environment, memoised inside the EvaluationService. */
export async function authenticateSdk(
  req: FastifyRequest,
  service: EvaluationService,
): Promise<EnvironmentRef> {
  const raw = extractSdkKey(req);
  if (!raw) throw new UnauthorizedError();
  const ref = await service.resolveEnvironment(hashSdkKey(raw));
  if (!ref) throw new UnauthorizedError('unknown SDK key');
  return ref;
}
