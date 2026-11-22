import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { compileRuleSchema } from '../schemas.js';
import { compileRule, isLlmConfigured } from './compiler.js';
import { simulateRule } from './simulator.js';

export interface AiDeps {
  config: AppConfig;
}

/**
 * AI Rule Compiler endpoints.
 *
 * `compile-rule` is deliberately read-only: it compiles, validates and dry-runs
 * a candidate rule, but NEVER persists it. Publishing is a separate, explicit
 * control-plane mutation the human must approve in the UI.
 */
export async function registerAiRoutes(
  app: FastifyInstance,
  deps: AiDeps,
): Promise<void> {
  const { config } = deps;

  app.get('/api/ai/status', async () => ({
    configured: isLlmConfigured(config),
    model: isLlmConfigured(config) ? config.LLM_MODEL : null,
    baseUrl: isLlmConfigured(config) ? config.LLM_BASE_URL : null,
    mode: isLlmConfigured(config) ? 'llm' : 'deterministic-fallback',
  }));

  app.post('/api/ai/compile-rule', async (req) => {
    const input = compileRuleSchema.parse(req.body);
    const compiled = await compileRule(input, config);
    const simulation = simulateRule(input.flagKey, compiled.compiledRule);

    return {
      flagKey: input.flagKey,
      prompt: input.prompt,
      compiledRule: compiled.compiledRule,
      source: compiled.source,
      model: compiled.model,
      warnings: compiled.warnings,
      diff: compiled.diff,
      simulation,
    };
  });
}