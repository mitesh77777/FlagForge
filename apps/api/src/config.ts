import { z } from 'zod';

/**
 * Environment configuration, validated once at boot. Every field has a sane
 * default so the API starts with zero configuration in development.
 */
const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  /**
   * Explicit port override. Left optional so `PORT` (injected by Fly, Render,
   * Railway, Cloud Run, Heroku, …) can be honoured as a fallback in loadConfig.
   */
  API_PORT: z.coerce.number().int().positive().optional(),

  DATABASE_URL: z
    .string()
    .default('postgres://flagforge:flagforge@localhost:5432/flagforge'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  /** Comma-separated list of allowed browser origins for CORS + SSE. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  /** Redis key namespace and L2 defensive TTL. */
  CACHE_NAMESPACE: z.string().default('flagforge'),
  L2_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  /** When set, the control plane requires `Authorization: Bearer <token>`. */
  ADMIN_API_TOKEN: z.string().min(1).optional(),
  /** Default actor recorded in the audit log when none is supplied. */
  DEFAULT_ACTOR_EMAIL: z.string().default('admin@flagforge.dev'),

  /** OpenAI-compatible LLM settings. Absent key ⇒ deterministic offline mode. */
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type AppConfig = Omit<
  z.infer<typeof configSchema>,
  'CORS_ORIGINS' | 'API_PORT'
> & { corsOrigins: string[]; API_PORT: number };

/** Parse a candidate port, returning `undefined` for anything unusable. */
function coercePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Treat whitespace-only values as absent.
 *
 * `.env` files and docker-compose routinely define a key with no value
 * (`LLM_API_KEY=`), which reaches the process as `''` rather than being unset.
 * Without this, `.min(1)` fields fail validation and the container crashes at
 * boot, and a blank `DATABASE_URL`/`REDIS_URL` would override its default with an
 * unusable empty string.
 */
function pruneEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pruned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    pruned[key] =
      typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return pruned;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const clean = pruneEmpty(env);
  const parsed = configSchema.parse(clean);
  const { CORS_ORIGINS, API_PORT, ...rest } = parsed;

  // Precedence: an explicit API_PORT, then the platform-injected PORT, then the
  // 8080 default. Managed hosts route traffic to their own PORT, so ignoring it
  // would leave the container listening on a port nothing forwards to.
  const port = API_PORT ?? coercePort(clean.PORT) ?? 8080;

  return {
    ...rest,
    API_PORT: port,
    corsOrigins: CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

export const REDIS_CHANNEL_FLAG_INVALIDATION = 'flag_invalidation';
