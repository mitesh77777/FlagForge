import { z } from 'zod';
import {
  OPERATORS,
  isValidSemver,
  type JsonValue,
  type Operator,
} from '@flagforge/evaluator';

/**
 * Strict Zod schemas for every request body and for the persisted flag AST.
 * The same `targetingRuleSchema` guards both control-plane writes and the
 * AI compiler output, so an LLM can never persist a shape the engine can't run.
 */

// ── Primitives ────────────────────────────────────────────────────────────────

export const operatorSchema = z.enum(
  [...OPERATORS] as unknown as [Operator, ...Operator[]],
);

const MAX_JSON_DEPTH = 8;
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonValueSchema).max(1000),
    z.record(jsonValueSchema),
  ]),
) as z.ZodType<JsonValue>;

const attributeNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'attribute must be an identifier');

const SEMVER_OPERATORS: ReadonlySet<string> = new Set(['semver_gte', 'semver_lt']);
const SET_OPERATORS: ReadonlySet<string> = new Set(['in', 'not_in']);
const NUMERIC_OPERATORS: ReadonlySet<string> = new Set(['gt', 'gte', 'lt', 'lte']);

// ── Targeting AST ─────────────────────────────────────────────────────────────

export const conditionSchema = z
  .object({
    attribute: attributeNameSchema,
    operator: operatorSchema,
    value: jsonValueSchema,
  })
  .superRefine((cond, ctx) => {
    if (SEMVER_OPERATORS.has(cond.operator)) {
      if (typeof cond.value !== 'string' || !isValidSemver(cond.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `operator "${cond.operator}" requires a valid semver string`,
          path: ['value'],
        });
      }
    } else if (SET_OPERATORS.has(cond.operator)) {
      if (!Array.isArray(cond.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `operator "${cond.operator}" requires an array value`,
          path: ['value'],
        });
      }
    } else if (NUMERIC_OPERATORS.has(cond.operator)) {
      if (typeof cond.value !== 'number' && typeof cond.value !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `operator "${cond.operator}" requires a numeric value`,
          path: ['value'],
        });
      }
    }
  });

export const targetingRuleSchema = z.object({
  id: z.string().min(1).max(128),
  description: z.string().max(280).optional(),
  conditions: z.array(conditionSchema).max(32),
  matchType: z.enum(['AND', 'OR']).default('AND'),
  rolloutPercentage: z.number().int().min(0).max(100),
  serveValue: jsonValueSchema,
});

export const overridesSchema = z.object({
  allowlist: z.array(z.string().min(1)).max(10_000).default([]),
  blocklist: z.array(z.string().min(1)).max(10_000).default([]),
});

export const flagKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'key must start alphanumeric and contain only [A-Za-z0-9._-]',
  );

export const flagInputSchema = z.object({
  key: flagKeySchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  enabled: z.boolean().default(false),
  defaultValue: jsonValueSchema.default(false),
  rules: z.array(targetingRuleSchema).max(50).default([]),
  overrides: overridesSchema.default({ allowlist: [], blocklist: [] }),
});

export const flagUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    enabled: z.boolean().optional(),
    defaultValue: jsonValueSchema.optional(),
    rules: z.array(targetingRuleSchema).max(50).optional(),
    overrides: overridesSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'at least one field must be provided',
  });

// ── Control-plane entities ─────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase kebab-case'),
});

/** Project creation from the dashboard: the slug is derived and de-duplicated. */
export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

/** Flag creation addressed by environment id (dashboard flow). */
export const flagCreateSchema = flagInputSchema.extend({
  environmentId: z.string().uuid(),
});

export const createEnvironmentSchema = z.object({
  projectId: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'environment name must be lowercase kebab-case'),
  tier: z.enum(['live', 'test']).default('live'),
});

// ── Data-plane requests ───────────────────────────────────────────────────────

export const attributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const attributesSchema = z
  .record(attributeValueSchema)
  .default({});

export const evaluateRequestSchema = z.object({
  key: flagKeySchema,
  userId: z.string().min(1).max(256),
  attributes: attributesSchema,
});

export const evaluateBatchRequestSchema = z.object({
  userId: z.string().min(1).max(256),
  attributes: attributesSchema,
  keys: z.array(flagKeySchema).max(500).optional(),
});

// ── AI rule compiler ──────────────────────────────────────────────────────────

export const compileRuleSchema = z.object({
  prompt: z.string().min(3).max(2000),
  flagKey: flagKeySchema,
  /** Optional current value, used to render a diff in the response. */
  currentRule: targetingRuleSchema.optional(),
});

export type FlagInput = z.infer<typeof flagInputSchema>;
export type FlagUpdate = z.infer<typeof flagUpdateSchema>;
export type EvaluateRequest = z.infer<typeof evaluateRequestSchema>;
export type EvaluateBatchRequest = z.infer<typeof evaluateBatchRequestSchema>;
export type CompileRuleRequest = z.infer<typeof compileRuleSchema>;
export { MAX_JSON_DEPTH };
