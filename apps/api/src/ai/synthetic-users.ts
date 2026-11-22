import type { EvaluationContext } from '@flagforge/evaluator';

export interface SyntheticUser {
  userId: string;
  plan: 'free' | 'pro' | 'enterprise';
  country: string;
  appVersion: string;
  betaOptIn: boolean;
  emailDomain: string;
  seats: number;
  createdAt: string;
}

/** Deterministic PRNG (mulberry32) so the dataset is identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

const PLANS = ['free', 'pro', 'enterprise'] as const;
const COUNTRIES = ['IN', 'US', 'DE', 'BR', 'GB', 'JP', 'CA', 'AU', 'FR', 'SG'] as const;
const APP_VERSIONS = [
  '1.8.3',
  '1.9.0',
  '2.0.0',
  '2.1.4',
  '2.4.0',
  '2.4.1',
  '2.5.0',
  '2.10.0',
  '3.0.0-beta.1',
] as const;
const EMAIL_DOMAINS = ['gmail.com', 'acme.io', 'flagforge.dev', 'outlook.com', 'proton.me'] as const;

const DATASET_SIZE = 1000;

/**
 * 1,000 realistic, deterministic synthetic user profiles. Because generation is
 * seeded, a blast-radius simulation is reproducible and diffable across edits.
 * Plans are weighted ~50/35/15 to feel like a real SaaS base.
 */
function generateUsers(): SyntheticUser[] {
  const rng = mulberry32(0x5eed_1234);
  const users: SyntheticUser[] = [];
  const baseTime = Date.UTC(2024, 0, 1);

  for (let i = 0; i < DATASET_SIZE; i++) {
    const roll = rng();
    const plan: SyntheticUser['plan'] =
      roll < 0.5 ? 'free' : roll < 0.85 ? 'pro' : 'enterprise';

    users.push({
      userId: `user_${String(i + 1).padStart(4, '0')}`,
      plan,
      country: pick(rng, COUNTRIES),
      appVersion: pick(rng, APP_VERSIONS),
      betaOptIn: rng() < 0.2,
      emailDomain: pick(rng, EMAIL_DOMAINS),
      seats: plan === 'enterprise' ? 25 + Math.floor(rng() * 200) : 1 + Math.floor(rng() * 10),
      createdAt: new Date(baseTime + Math.floor(rng() * 320) * 86_400_000).toISOString(),
    });
  }
  return users;
}

export const SYNTHETIC_USERS: readonly SyntheticUser[] = Object.freeze(generateUsers());

export const DATASET_TOTAL = DATASET_SIZE;

/** Turn a synthetic profile into the attributes the evaluator expects. */
export function toEvaluationContext(user: SyntheticUser): EvaluationContext {
  return {
    userId: user.userId,
    attributes: {
      plan: user.plan,
      country: user.country,
      appVersion: user.appVersion,
      betaOptIn: user.betaOptIn,
      emailDomain: user.emailDomain,
      seats: user.seats,
      createdAt: user.createdAt,
    },
  };
}

/** Strip internal fields for transport to the UI samples. */
export function publicUser(user: SyntheticUser) {
  return {
    userId: user.userId,
    plan: user.plan,
    country: user.country,
    appVersion: user.appVersion,
    betaOptIn: user.betaOptIn,
    seats: user.seats,
  };
}
