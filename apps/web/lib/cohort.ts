import type { EvaluationContext } from '@flagforge/evaluator';

export interface CohortUser {
  userId: string;
  plan: 'free' | 'pro' | 'enterprise';
  country: string;
  appVersion: string;
  betaOptIn: boolean;
  emailDomain: string;
  seats: number;
}

/**
 * 20 hand-curated "consumers" for the right-hand pane. Deliberately includes
 * `user_demo_001` (allowlisted) and `user_demo_020` (blocklisted) so the
 * override payoff is visible in the cohort grid.
 */
export const COHORT: readonly CohortUser[] = Object.freeze([
  { userId: 'user_demo_001', plan: 'enterprise', country: 'IN', appVersion: '2.4.1', betaOptIn: true, emailDomain: 'acme.io', seats: 120 },
  { userId: 'user_demo_002', plan: 'pro', country: 'US', appVersion: '2.5.0', betaOptIn: false, emailDomain: 'gmail.com', seats: 8 },
  { userId: 'user_demo_003', plan: 'free', country: 'DE', appVersion: '1.9.0', betaOptIn: false, emailDomain: 'outlook.com', seats: 1 },
  { userId: 'user_demo_004', plan: 'pro', country: 'IN', appVersion: '2.4.0', betaOptIn: true, emailDomain: 'flagforge.dev', seats: 5 },
  { userId: 'user_demo_005', plan: 'enterprise', country: 'GB', appVersion: '2.10.0', betaOptIn: false, emailDomain: 'acme.io', seats: 240 },
  { userId: 'user_demo_006', plan: 'free', country: 'BR', appVersion: '2.0.0', betaOptIn: false, emailDomain: 'gmail.com', seats: 1 },
  { userId: 'user_demo_007', plan: 'pro', country: 'DE', appVersion: '2.4.1', betaOptIn: false, emailDomain: 'proton.me', seats: 3 },
  { userId: 'user_demo_008', plan: 'free', country: 'US', appVersion: '1.8.3', betaOptIn: true, emailDomain: 'outlook.com', seats: 2 },
  { userId: 'user_demo_009', plan: 'enterprise', country: 'JP', appVersion: '3.0.0-beta.1', betaOptIn: true, emailDomain: 'acme.io', seats: 60 },
  { userId: 'user_demo_010', plan: 'pro', country: 'CA', appVersion: '2.1.4', betaOptIn: false, emailDomain: 'gmail.com', seats: 4 },
  { userId: 'user_demo_011', plan: 'free', country: 'AU', appVersion: '2.4.0', betaOptIn: false, emailDomain: 'gmail.com', seats: 1 },
  { userId: 'user_demo_012', plan: 'pro', country: 'FR', appVersion: '2.10.0', betaOptIn: false, emailDomain: 'acme.io', seats: 12 },
  { userId: 'user_demo_013', plan: 'free', country: 'SG', appVersion: '2.5.0', betaOptIn: true, emailDomain: 'proton.me', seats: 1 },
  { userId: 'user_demo_014', plan: 'enterprise', country: 'US', appVersion: '2.0.0', betaOptIn: false, emailDomain: 'acme.io', seats: 500 },
  { userId: 'user_demo_015', plan: 'pro', country: 'IN', appVersion: '1.9.0', betaOptIn: false, emailDomain: 'gmail.com', seats: 2 },
  { userId: 'user_demo_016', plan: 'free', country: 'GB', appVersion: '2.4.1', betaOptIn: false, emailDomain: 'outlook.com', seats: 1 },
  { userId: 'user_demo_017', plan: 'pro', country: 'BR', appVersion: '2.4.0', betaOptIn: true, emailDomain: 'acme.io', seats: 6 },
  { userId: 'user_demo_018', plan: 'enterprise', country: 'DE', appVersion: '2.5.0', betaOptIn: false, emailDomain: 'acme.io', seats: 180 },
  { userId: 'user_demo_019', plan: 'free', country: 'JP', appVersion: '2.1.4', betaOptIn: false, emailDomain: 'gmail.com', seats: 1 },
  { userId: 'user_demo_020', plan: 'free', country: 'US', appVersion: '2.0.0', betaOptIn: false, emailDomain: 'gmail.com', seats: 1 },
]);

export function toContext(user: CohortUser): EvaluationContext {
  return {
    userId: user.userId,
    attributes: {
      plan: user.plan,
      country: user.country,
      appVersion: user.appVersion,
      betaOptIn: user.betaOptIn,
      emailDomain: user.emailDomain,
      seats: user.seats,
    },
  };
}