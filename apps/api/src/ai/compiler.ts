import OpenAI from 'openai';
import type { Condition, TargetingRule } from '@flagforge/evaluator';
import type { AppConfig } from '../config.js';
import { targetingRuleSchema, type CompileRuleRequest } from '../schemas.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

export interface CompiledRuleResult {
  compiledRule: TargetingRule;
  source: 'llm' | 'fallback';
  warnings: string[];
  model: string | null;
  diff: { before: TargetingRule | null; after: TargetingRule };
}

export function isLlmConfigured(config: AppConfig): boolean {
  return typeof config.LLM_API_KEY === 'string' && config.LLM_API_KEY.length > 0;
}

/** Extract a JSON object from a model response, tolerating ```json fences. */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = fenced?.[1]?.trim() ?? trimmed;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('model did not return a JSON object');
  }
  return JSON.parse(body.slice(start, end + 1));
}

function sanitizeId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? `ai_${slug}` : `ai_rule_${Date.now()}`;
}

// ── Deterministic offline parser ──────────────────────────────────────────────

const COUNTRY_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /\bindia\b|\bindian\b|\bभारत\b/i, code: 'IN' },
  { re: /\bunited states\b|\busa\b|\bu\.s\.a?\b|\bamerica\b/i, code: 'US' },
  { re: /\bgermany\b|\bgerman\b|\bdeutschland\b/i, code: 'DE' },
  { re: /\bbrazil\b|\bbrasil\b/i, code: 'BR' },
  { re: /\bunited kingdom\b|\buk\b|\bbritain\b|\bengland\b/i, code: 'GB' },
  { re: /\bjapan\b|\bjapanese\b/i, code: 'JP' },
  { re: /\bcanada\b|\bcanadian\b/i, code: 'CA' },
  { re: /\baustralia\b|\baustralian\b/i, code: 'AU' },
  { re: /\bfrance\b|\bfrench\b/i, code: 'FR' },
  { re: /\bsingapore\b/i, code: 'SG' },
];

const NEGATIVE_INTENT = /\b(disable|turn off|hide|kill|remove|off)\b/i;
const POSITIVE_INTENT = /\b(enable|turn on|show|launch|roll out|release|on)\b/i;

/**
 * A deterministic, dependency-free parser used when no LLM key is configured or
 * when the model returns something that fails schema validation. It is
 * intentionally conservative: anything it cannot confidently extract is
 * reported as a warning rather than guessed.
 */
export function heuristicCompile(
  prompt: string,
  flagKey: string,
): { rule: TargetingRule; warnings: string[] } {
  const warnings: string[] = [];
  const conditions: Condition[] = [];

  // Percentage (clamp 1..100).
  let rolloutPercentage = 100;
  const pct = /(\d{1,3})\s*(?:%|percent\b|pct\b)/i.exec(prompt);
  if (pct) {
    const parsed = Number(pct[1]);
    if (Number.isFinite(parsed)) {
      rolloutPercentage = Math.min(100, Math.max(0, Math.trunc(parsed)));
    }
  }

  // Plans.
  const plans: string[] = [];
  if (/\benterprise\b/i.test(prompt)) plans.push('enterprise');
  if (/\bpro\b|\bpaid\b/i.test(prompt)) plans.push('pro');
  if (/\bfree\b|\btrial\b/i.test(prompt)) plans.push('free');
  if (plans.length === 1) {
    conditions.push({ attribute: 'plan', operator: 'eq', value: plans[0]! });
  } else if (plans.length > 1) {
    conditions.push({ attribute: 'plan', operator: 'in', value: plans });
  }

  // Countries.
  const countries = new Set<string>();
  for (const { re, code } of COUNTRY_PATTERNS) {
    if (re.test(prompt)) countries.add(code);
  }
  // Explicit uppercase ISO codes, e.g. "in IN or DE".
  for (const m of prompt.matchAll(/\b(IN|US|DE|BR|GB|JP|CA|AU|FR|SG)\b/g)) {
    if (m[1]) countries.add(m[1]);
  }
  if (countries.size === 1) {
    conditions.push({ attribute: 'country', operator: 'eq', value: [...countries][0]! });
  } else if (countries.size > 1) {
    conditions.push({ attribute: 'country', operator: 'in', value: [...countries] });
  }

  // App version + comparator.
  const versionMatch =
    /(?:app(?:lication)?\s*version|version|v)\s*(\d+\.\d+(?:\.\d+)?)/i.exec(prompt);
  if (versionMatch) {
    const version = versionMatch[1]!;
    const isLt = /\b(below|older than|less than|before)\b/i.test(prompt);
    conditions.push({
      attribute: 'appVersion',
      operator: isLt ? 'semver_lt' : 'semver_gte',
      value: version,
    });
  }

  // Beta opt-in.
  if (/\bbeta\b/i.test(prompt)) {
    conditions.push({ attribute: 'betaOptIn', operator: 'eq', value: true });
  }

  // Email domain.
  const domain = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(prompt);
  if (domain) {
    conditions.push({ attribute: 'emailDomain', operator: 'eq', value: domain[1]! });
  }

  // Seat count, e.g. "at least 25 seats".
  const seats = /(\d+)\s*\+?\s*seats\b/i.exec(prompt);
  if (seats) {
    conditions.push({ attribute: 'seats', operator: 'gte', value: Number(seats[1]) });
  }

  if (conditions.length === 0 && rolloutPercentage === 100) {
    warnings.push(
      'No specific targeting could be parsed; the rule matches 100% of users.',
    );
  }

  const serveValue = NEGATIVE_INTENT.test(prompt) && !POSITIVE_INTENT.test(prompt) ? false : true;

  const idParts = [
    ...plans,
    ...[...countries],
    versionMatch ? `v${versionMatch[1]}` : '',
    `${rolloutPercentage}pct`,
  ].filter(Boolean);

  const rule: TargetingRule = {
    id: sanitizeId(idParts.join('_') || flagKey),
    description: prompt.trim().slice(0, 280),
    conditions,
    matchType: 'AND',
    rolloutPercentage,
    serveValue,
  };

  return { rule, warnings };
}

// ── LLM path ──────────────────────────────────────────────────────────────────

async function callLlm(
  input: CompileRuleRequest,
  config: AppConfig,
): Promise<unknown> {
  const client = new OpenAI({
    apiKey: config.LLM_API_KEY,
    baseURL: config.LLM_BASE_URL,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 1,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input.prompt, input.flagKey) },
  ];

  try {
    const completion = await client.chat.completions.create({
      model: config.LLM_MODEL,
      temperature: 0,
      messages,
      response_format: { type: 'json_object' },
    });
    return parseJsonLoose(completion.choices[0]?.message?.content ?? '');
  } catch {
    // Some OpenAI-compatible providers reject `response_format`; retry plainly.
    const completion = await client.chat.completions.create({
      model: config.LLM_MODEL,
      temperature: 0,
      messages,
    });
    return parseJsonLoose(completion.choices[0]?.message?.content ?? '');
  }
}

/**
 * Compile a natural-language request into a validated Targeting Rule.
 *
 * Order of operations:
 *   1. If an LLM key is configured, ask the model for JSON.
 *   2. Strictly validate with `targetingRuleSchema` (operators, semver, ranges).
 *   3. On any failure — or with no key — use the deterministic offline parser.
 *
 * The returned rule is always schema-valid, so the caller can safely dry-run it.
 */
export async function compileRule(
  input: CompileRuleRequest,
  config: AppConfig,
): Promise<CompiledRuleResult> {
  const warnings: string[] = [];

  if (isLlmConfigured(config)) {
    try {
      const raw = await callLlm(input, config);
      const parsed = targetingRuleSchema.parse(raw);
      return {
        compiledRule: parsed,
        source: 'llm',
        warnings,
        model: config.LLM_MODEL,
        diff: { before: input.currentRule ?? null, after: parsed },
      };
    } catch (err) {
      warnings.push(
        `LLM output was unusable (${err instanceof Error ? err.message : 'unknown error'}); used deterministic fallback parser.`,
      );
    }
  } else {
    warnings.push('LLM_API_KEY is not set; used deterministic offline parser.');
  }

  const { rule, warnings: heuristicWarnings } = heuristicCompile(
    input.prompt,
    input.flagKey,
  );
  warnings.push(...heuristicWarnings);

  // Final guardrail: the fallback rule must also satisfy the exact same schema.
  const validated = targetingRuleSchema.parse(rule);

  return {
    compiledRule: validated,
    source: 'fallback',
    warnings,
    model: null,
    diff: { before: input.currentRule ?? null, after: validated },
  };
}