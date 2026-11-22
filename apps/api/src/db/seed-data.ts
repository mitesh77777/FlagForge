import { createHash } from 'node:crypto';
import type { FlagOverrides, JsonValue, TargetingRule } from '@flagforge/evaluator';

/** SHA-256 hex digest — used to store SDK keys without keeping the secret. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** First `n` characters of a key, safe to display in the UI. */
export function keyPrefix(key: string, n = 12): string {
  return key.slice(0, n);
}

/**
 * Well-known demo SDK keys, seeded in development so the zero-friction Guest
 * Sandbox can authenticate without any signup. These are intentionally public.
 */
export const DEMO_SDK_KEYS = {
  prod: 'ff_live_demo_7f3a91c4e8b25d60',
  dev: 'ff_test_demo_2b6d08fe1439ac75',
} as const;

export interface SeedFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  defaultValue: JsonValue;
  rules: TargetingRule[];
  overrides: FlagOverrides;
}

/**
 * Four realistic flags covering the interesting evaluation paths:
 *  - attribute AND/OR matching + percentage rollout
 *  - semver gating (`semver_gte` / `semver_lt`)
 *  - a kill-switch-off flag (pricing page) to demo flipping
 *  - explicit allow/block overrides
 */
export const SEED_FLAGS: SeedFlag[] = [
  {
    key: 'new-checkout-flow',
    name: 'New Checkout Flow',
    description:
      'Rebuilt one-page checkout. Rolled out to internal staff, then 50% of Pro users in IN/US/DE, plus any beta opt-ins.',
    enabled: true,
    defaultValue: false,
    rules: [
      {
        id: 'rule_internal_staff',
        description: 'Internal staff (email domain)',
        conditions: [
          { attribute: 'emailDomain', operator: 'eq', value: 'flagforge.dev' },
        ],
        matchType: 'AND',
        rolloutPercentage: 100,
        serveValue: true,
      },
      {
        id: 'rule_pro_geo',
        description: '50% of Pro users in India, US or Germany',
        conditions: [
          { attribute: 'plan', operator: 'eq', value: 'pro' },
          { attribute: 'country', operator: 'in', value: ['IN', 'US', 'DE'] },
        ],
        matchType: 'AND',
        rolloutPercentage: 50,
        serveValue: true,
      },
      {
        id: 'rule_beta_optin',
        description: 'Anyone who opted into beta',
        conditions: [{ attribute: 'betaOptIn', operator: 'eq', value: true }],
        matchType: 'AND',
        rolloutPercentage: 100,
        serveValue: true,
      },
    ],
    overrides: {
      allowlist: ['user_demo_001'],
      blocklist: ['user_demo_020'],
    },
  },
  {
    key: 'ai-search-beta',
    name: 'AI Search (Beta)',
    description:
      'Semantic search powered by embeddings. Gated to Pro/Enterprise on app version 2.4.0+.',
    enabled: true,
    defaultValue: false,
    rules: [
      {
        id: 'rule_pro_enterprise_semver',
        description: 'Pro or Enterprise on app >= 2.4.0',
        conditions: [
          {
            attribute: 'plan',
            operator: 'in',
            value: ['pro', 'enterprise'],
          },
          { attribute: 'appVersion', operator: 'semver_gte', value: '2.4.0' },
        ],
        matchType: 'AND',
        rolloutPercentage: 25,
        serveValue: true,
      },
    ],
    overrides: {
      allowlist: [],
      blocklist: ['user_demo_013'],
    },
  },
  {
    key: 'pricing-page-v2',
    name: 'Pricing Page v2',
    description:
      'Redesigned pricing page. Ships dark by default so it can be flipped live from the sandbox.',
    enabled: false,
    defaultValue: false,
    rules: [
      {
        id: 'rule_gradual_10pct',
        description: '10% gradual rollout once enabled',
        conditions: [],
        matchType: 'AND',
        rolloutPercentage: 10,
        serveValue: true,
      },
    ],
    overrides: { allowlist: [], blocklist: [] },
  },
  {
    key: 'dark-mode-default',
    name: 'Dark Mode Default',
    description:
      'Dark theme on by default, but legacy clients below app 2.0.0 are forced back to light.',
    enabled: true,
    defaultValue: true,
    rules: [
      {
        id: 'rule_legacy_light',
        description: 'Force light mode for apps older than 2.0.0',
        conditions: [
          { attribute: 'appVersion', operator: 'semver_lt', value: '2.0.0' },
        ],
        matchType: 'AND',
        rolloutPercentage: 100,
        serveValue: false,
      },
    ],
    overrides: { allowlist: [], blocklist: [] },
  },
];
