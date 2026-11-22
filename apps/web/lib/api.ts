import type { FlagConfig, TargetingRule } from '@flagforge/evaluator';
import type { CohortUser } from './cohort';

/** Browser-reachable API origin. Inlined at build time by Next.js. */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
).replace(/\/+$/, '');

const ACTOR_HEADER = { 'x-actor-email': 'demo@flagforge.dev' };

export interface EnvironmentView {
  id: string;
  name: string;
  sdkKeyPrefix: string;
  createdAt: string;
}

export interface FlagView {
  id: string;
  environmentId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  defaultValue: unknown;
  rules: TargetingRule[];
  overrides: { allowlist: string[]; blocklist: string[] };
  version: number;
  updatedAt: string;
}

export interface AuditLogView {
  id: string;
  environmentId: string;
  flagKey: string;
  actorEmail: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
}

export interface SandboxResponse {
  project: { id: string; name: string; slug: string };
  environments: EnvironmentView[];
  flagsByEnvironment: Record<string, FlagView[]>;
  auditLogs: AuditLogView[];
  demoKeys: { prod: string; dev: string };
}

export interface SimulationBreakdownEntry {
  key: string;
  total: number;
  matched: number;
}

export interface SimulationResult {
  totalUsers: number;
  matchedUsers: number;
  percentage: number;
  sampleMatchedUsers: CohortUser[];
  sampleExcludedUsers: CohortUser[];
  breakdown: {
    byPlan: SimulationBreakdownEntry[];
    byCountry: SimulationBreakdownEntry[];
  };
}

export interface CompileResponse {
  flagKey: string;
  prompt: string;
  compiledRule: TargetingRule;
  source: 'llm' | 'fallback';
  model: string | null;
  warnings: string[];
  diff: { before: TargetingRule | null; after: TargetingRule };
  simulation: SimulationResult;
}

export interface ConfigResponse {
  environment: string;
  environmentId: string;
  version: number;
  flags: Record<string, FlagConfig>;
}

export interface ConfigFetchResult {
  data: ConfigResponse;
  cacheStatus: string;
  evalMs: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...ACTOR_HEADER,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export const api = {
  sandbox(): Promise<SandboxResponse> {
    return request<SandboxResponse>('/api/sandbox');
  },

  environmentFlags(environmentId: string): Promise<{ flags: FlagView[] }> {
    return request<{ flags: FlagView[] }>(`/api/environments/${environmentId}/flags`);
  },

  auditLogs(environmentId: string, limit = 50): Promise<{ auditLogs: AuditLogView[] }> {
    return request<{ auditLogs: AuditLogView[] }>(
      `/api/environments/${environmentId}/audit-logs?limit=${limit}`,
    );
  },

  patchFlag(
    flagId: string,
    patch: Partial<Pick<FlagView, 'enabled' | 'rules' | 'overrides' | 'name' | 'description'>>,
  ): Promise<{ flag: FlagView }> {
    return request<{ flag: FlagView }>(`/api/flags/${flagId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  compileRule(
    prompt: string,
    flagKey: string,
    currentRule?: TargetingRule,
  ): Promise<CompileResponse> {
    return request<CompileResponse>('/api/ai/compile-rule', {
      method: 'POST',
      body: JSON.stringify({ prompt, flagKey, currentRule }),
    });
  },

  aiStatus(): Promise<{
    configured: boolean;
    model: string | null;
    baseUrl: string | null;
    mode: string;
  }> {
    return request('/api/ai/status');
  },

  async config(sdkKey: string): Promise<ConfigFetchResult> {
    const res = await fetch(`${API_URL}/v1/config`, {
      headers: { 'x-sdk-key': sdkKey },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`config fetch failed (${res.status})`);
    return {
      data: (await res.json()) as ConfigResponse,
      cacheStatus: res.headers.get('X-Cache-Status') ?? 'UNKNOWN',
      evalMs: res.headers.get('X-Eval-Time-Ms') ?? '—',
    };
  },
};