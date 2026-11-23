import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless session tokens: `base64url(payload).hmacSha256(payload)`.
 *
 * This is the compact JWT (HS256) construction without pulling in a JWT library.
 * The token is sent as `Authorization: Bearer <token>` — a deliberate choice over
 * cookies, because the dashboard is served from a different origin than the API
 * (Vercel → Fly) and cross-site cookies need `SameSite=None; Secure`, which
 * browsers increasingly restrict.
 *
 * Tokens cannot be revoked individually without server state. Logout discards the
 * token client-side; the TTL is the backstop.
 */
export interface SessionPayload {
  /** User id. */
  sub: string;
  /** Expiry, in epoch seconds. */
  exp: number;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const payload: SessionPayload = {
    sub: userId,
    exp: Math.floor(now / 1000) + Math.max(1, Math.floor(ttlSeconds)),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionPayload | null {
  const separator = token.indexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  if (body.length === 0 || provided.length === 0) return null;

  const expected = sign(body, secret);
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as SessionPayload).sub !== 'string' ||
    typeof (payload as SessionPayload).exp !== 'number'
  ) {
    return null;
  }

  const parsed = payload as SessionPayload;
  if (parsed.exp <= Math.floor(now / 1000)) return null;
  return parsed;
}

/** Extract a token from an `Authorization: Bearer …` header. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}