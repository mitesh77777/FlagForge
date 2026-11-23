import { eq } from 'drizzle-orm';
import type { FlagService } from '../control-plane/flag-service.js';
import type { Database } from '../db/client.js';
import { users, type User } from '../db/schema.js';
import { ensureDemoWorkspace } from '../db/seed.js';
import { AppError, ConflictError, ValidationError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import {
  createSessionToken,
  extractBearerToken,
  verifySessionToken,
} from '../lib/session.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
  /** Seconds until the token expires. */
  expiresIn: number;
  /** Present on signup: the auto-provisioned workspace and its raw keys (once). */
  project?: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
  };
  environments?: Array<{
    id: string;
    name: string;
    tier: 'live' | 'test';
    sdkKey: string;
    sdkKeyPrefix: string;
  }>;
}

export interface AuthServiceDeps {
  db: Database;
  flags: FlagService;
  sessionSecret: string;
  sessionTtlSeconds: number;
  demoEmail: string;
  demoPassword: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('email is required');
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError('enter a valid email address');
  }
  return email;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('password is required');
  }
  if (value.length < 8) {
    throw new ValidationError('password must be at least 8 characters');
  }
  if (value.length > 200) {
    throw new ValidationError('password is too long');
  }
  return value;
}

function serializeUser(row: User): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Account lifecycle: signup, login, the one-click demo login, and session
 * verification for protected routes.
 *
 * Passwords are scrypt hashes; sessions are stateless HMAC-signed tokens sent as
 * `Authorization: Bearer …` (see `lib/session.ts` for why bearer over cookies).
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  private issue(row: User): AuthResult {
    return {
      user: serializeUser(row),
      token: createSessionToken(
        row.id,
        this.deps.sessionSecret,
        this.deps.sessionTtlSeconds,
      ),
      expiresIn: this.deps.sessionTtlSeconds,
    };
  }

  /** Creates the account and its starter project (dev + prod environments). */
  async signup(input: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
  }): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const password = normalizePassword(input.password);

    const existing = await this.deps.db.query.users.findFirst({
      where: (row, { eq: eqFn }) => eqFn(row.email, email),
    });
    if (existing) {
      throw new ConflictError('an account with that email already exists');
    }

    const passwordHash = await hashPassword(password);
    const rawName = typeof input.name === 'string' ? input.name.trim() : '';
    const name = (rawName || email.split('@')[0] || 'Developer').slice(0, 120);

    const [row] = await this.deps.db
      .insert(users)
      .values({ email, passwordHash, name })
      .returning();
    if (!row) throw new Error('failed to create account');

    // A brand-new account is useless without a project, so provision one and
    // return its raw SDK keys exactly once (they are hashed at rest).
    const provisioned = await this.deps.flags.createProjectWithEnvironments(
      row.id,
      { name: `${name}'s Workspace` },
    );

    return {
      ...this.issue(row),
      project: provisioned.project,
      environments: provisioned.environments,
    };
  }

  async login(input: {
    email?: unknown;
    password?: unknown;
  }): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';

    const row = await this.deps.db.query.users.findFirst({
      where: (user, { eq: eqFn }) => eqFn(user.email, email),
    });

    // A single generic message (and a verification step even on a miss) avoids
    // revealing which emails have accounts.
    const ok = row ? await verifyPassword(password, row.passwordHash) : false;
    if (!row || !ok) {
      throw new AppError('invalid email or password', 401, 'unauthorized');
    }

    return this.issue(row);
  }

  /** One-click entry for evaluators; creates the demo workspace if absent. */
  async demoLogin(): Promise<AuthResult> {
    const { user } = await ensureDemoWorkspace(this.deps.db, {
      email: this.deps.demoEmail,
      password: this.deps.demoPassword,
    });
    return this.issue(user);
  }

  async me(userId: string): Promise<AuthUser> {
    const [row] = await this.deps.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) {
      throw new AppError('session is no longer valid', 401, 'unauthorized');
    }
    return serializeUser(row);
  }

  /**
   * Resolve the caller from an `Authorization: Bearer <token>` header.
   * Verifies the signature and expiry, then confirms the account still exists.
   */
  async authenticate(authorization: string | undefined): Promise<AuthUser> {
    const token = extractBearerToken(authorization);
    if (!token) {
      throw new AppError('authentication required', 401, 'unauthorized');
    }
    const payload = verifySessionToken(token, this.deps.sessionSecret);
    if (!payload) {
      throw new AppError('invalid or expired session', 401, 'unauthorized');
    }
    return this.me(payload.sub);
  }
}