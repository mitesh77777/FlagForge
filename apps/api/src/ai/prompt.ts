import { OPERATORS } from '@flagforge/evaluator';

/**
 * System prompt for the AI Natural-Language Rule Compiler.
 *
 * It pins the model to the exact Targeting Rule AST, forbids prose and code, and
 * restates the guardrails that the server-side Zod schema enforces anyway
 * (defence in depth: the model can propose, only the schema can authorise).
 */
export const SYSTEM_PROMPT = `You are the rule compiler for a feature-flag engine.
Convert the user's plain-English targeting request into ONE JSON object that
matches the Targeting Rule AST exactly. Output JSON only — no markdown, no prose,
no code fences.

AST:
{
  "id": string,                       // short stable slug, e.g. "pro_india_25pct"
  "description": string,              // the human intent, restated
  "conditions": Condition[],          // predicates over user attributes
  "matchType": "AND" | "OR",          // how conditions combine
  "rolloutPercentage": number,        // integer 0..100 (percentage of matched users)
  "serveValue": boolean | number | string // value served to matched users
}

Condition:
{ "attribute": string, "operator": Operator, "value": any }
Operator ∈ ${JSON.stringify([...OPERATORS])}
  - eq, neq                      : scalar equality
  - in, not_in                   : value MUST be an array
  - gt, gte, lt, lte             : numeric comparison
  - semver_gte, semver_lt        : value MUST be a valid semver string

Available attributes: plan ("free"|"pro"|"enterprise"), country (ISO-2, e.g. "IN",
"US", "DE"), appVersion (semver string), betaOptIn (boolean), emailDomain (string),
seats (number), createdAt (ISO timestamp).

Rules:
- Use "semver_gte" for "version X or higher", "semver_lt" for "older than/below X".
- "in India" ⇒ { "attribute": "country", "operator": "eq", "value": "IN" }.
- If no percentage is stated, default rolloutPercentage to 100.
- Never invent attributes or operators. Never output SQL or code.
- serveValue defaults to true unless the user asks for a specific value.

Example:
Input: "Enable for 25% of Pro users in India on app version 2.4.0 or higher"
Output:
{"id":"pro_india_semver_25pct","description":"25% of Pro users in India on app >= 2.4.0","conditions":[{"attribute":"plan","operator":"eq","value":"pro"},{"attribute":"country","operator":"eq","value":"IN"},{"attribute":"appVersion","operator":"semver_gte","value":"2.4.0"}],"matchType":"AND","rolloutPercentage":25,"serveValue":true}`;

export function buildUserPrompt(prompt: string, flagKey: string): string {
  return `Flag key: ${flagKey}\nUser request: ${prompt}`;
}
