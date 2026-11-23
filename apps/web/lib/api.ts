/** Browser-reachable API origin. Inlined at build time by Next.js. */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'
).replace(/\/+$/, '');

const TOKEN_KEY = 'flagforge.session';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface ApiProject {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface ApiEnvironment {
  id: string;
  projectId: string;
  name: string;
  sdkKeyPrefix: string;
  createdAt: string;
  previousKeyExpiresAt: string | null;
}

/** Raw key — only ever returned once, at creation or rotation. */
export interface ApiEnvironmentWithKey {
  id: string;
  name: string;
  tier: 'live' | 'test';
  sdkKey: string;
  sdkKeyPrefix: string;
}

export interface AuthResponse {
  user: ApiUser;
  token: string;
  expiresIn: number;
  project?: ApiProject;
  environments?: ApiEnvironmentWithKey[];
}

export interface ApiRule {
  id: string;
  description?: string;
  conditions: Array<{
    attribute: string;
    operator: string;
    value: unknown;
  }>;
  matchType: 'AND' | 'OR';
  rolloutPercentage: number;
  serveValue: unknown;
}

export interface ApiFlag {
  id: string;
  environmentId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  defaultValue: unknown;
  rules: ApiRule[];
  overrides: { allowlist: string[]; blocklist: string[] };
  version: number;
  updatedAt: string;
}

export interface ApiAuditLog {
  id: string;
  environmentId: string;
  flagKey: string;
  actorEmail: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
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
  sampleMatchedUsers: Array<{
    userId: string;
    plan: string;
    country: string;
    appVersion: string;
  }>;
  sampleExcludedUsers: unknown[];
  breakdown: {
    byPlan: SimulationBreakdownEntry[];
    byCountry: SimulationBreakdownEntry[];
  };
}

export interface CompileResponse {
  flagKey: string;
  prompt: string;
  compiledRule: ApiRule;
  source: 'llm' | 'fallback';
  model: string | null;
  warnings: string[];
  diff: { before: ApiRule | null; after: ApiRule };
  simulation: SimulationResult;
}

export interface EvaluateResponse {
  key: string;
  value: unknown;
  reason: string;
  ruleId: string | null;
  bucket: number | null;
  version: number;
  environment: string;
}

export interface ConfigResponse {
  environment: string;
  environmentId: string;
  version: number;
  flags: Record<string, unknown>;
}

export interface KeyRotationResponse {
  environmentId: string;
  environment: string;
  sdkKey: string;
  sdkKeyPrefix: string;
  previousKeyExpiresAt: string | null;
}

export interface PlaygroundResult {
  key: string;
  value: unknown;
  reason: string;
  ruleId: string | null;
  bucket: number | null;
  version: number;
  cacheStatus: string;
  evalMs: string;
}

// ── Request helper ───────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401) {
    setToken(null);
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
        issues?: Array<{ path: string; message: string }>;
      };
      message =
        body.issues?.[0]?.message ?? body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── API surface ──────────────────────────────────────────────────────────────

export const api = {
  auth: {
    signup(input: {
      email: string;
      password: string;
      name?: string;
    }): Promise<AuthResponse> {
      return post<AuthResponse>('/api/auth/signup', input);
    },
    login(input: { email: string; password: string }): Promise<AuthResponse> {
      return post<AuthResponse>('/api/auth/login', input);
    },
    demo(): Promise<AuthResponse> {
      return post<AuthResponse>('/api/auth/demo');
    },
    me(): Promise<{ user: ApiUser }> {
      return request<{ user: ApiUser }>('/api/auth/me');
    },
    logout(): Promise<{ ok: boolean }> {
      return post<{ ok: boolean }>('/api/auth/logout');
    },
  },

  projects: {
    list(): Promise<{ projects: ApiProject[] }> {
      return request<{ projects: ApiProject[] }>('/api/projects');
    },
    create(input: {
      name: string;
    }): Promise<{ project: ApiProject; environments: ApiEnvironmentWithKey[] }> {
      return post('/api/projects', input);
    },
  },

  environments: {
    list(projectId: string): Promise<{ environments: ApiEnvironment[] }> {
      return request<{ environments: ApiEnvironment[] }>(
        `/api/environments?projectId=${encodeURIComponent(projectId)}`,
      );
    },
    rotate(environmentId: string): Promise<KeyRotationResponse> {
      return post<KeyRotationResponse>(
        `/api/environments/${environmentId}/rotate-key`,
        { tier: 'live' },
      );
    },
  },

  flags: {
    list(environmentId: string): Promise<{ flags: ApiFlag[] }> {
      return request<{ flags: ApiFlag[] }>(
        `/api/environments/${environmentId}/flags`,
      );
    },
    create(input: {
      environmentId: string;
      key: string;
      name: string;
      description?: string;
      defaultValue?: unknown;
      enabled?: boolean;
    }): Promise<{ flag: ApiFlag }> {
      return post<{ flag: ApiFlag }>('/api/flags', input);
    },
    update(
      flagId: string,
      patchBody: Partial<
        Pick<ApiFlag, 'enabled' | 'name' | 'description' | 'defaultValue' | 'rules' | 'overrides'>
      >,
    ): Promise<{ flag: ApiFlag }> {
      return patch<{ flag: ApiFlag }>(`/api/flags/${flagId}`, patchBody);
    },
    remove(flagId: string): Promise<{ deleted: true; key: string }> {
      return request<{ deleted: true; key: string }>(`/api/flags/${flagId}`, {
        method: 'DELETE',
      });
    },
  },

  audit: {
    list(
      environmentId: string,
      limit = 100,
    ): Promise<{ auditLogs: ApiAuditLog[] }> {
      return request<{ auditLogs: ApiAuditLog[] }>(
        `/api/environments/${environmentId}/audit-logs?limit=${limit}`,
      );
    },
  },

  playground(
    environmentId: string,
    input: {
      key: string;
      userId: string;
      attributes: Record<string, string | number | boolean>;
    },
  ): Promise<PlaygroundResult> {
    return post<PlaygroundResult>(
      `/api/environments/${environmentId}/playground`,
      input,
    );
  },

  ai: {
    status(): Promise<{
      configured: boolean;
      model: string | null;
      mode: string;
    }> {
      return request('/api/ai/status');
    },
    compile(
      prompt: string,
      flagKey: string,
      currentRule?: ApiRule,
    ): Promise<CompileResponse> {
      return post<CompileResponse>('/api/ai/compile-rule', {
        prompt,
        flagKey,
        currentRule,
      });
    },
  },

  // ── Data plane (authenticated by SDK key, not the session) ────────────────
  dataPlane: {
    async evaluate(
      sdkKey: string,
      input: {
        key: string;
        userId: string;
        attributes: Record<string, string | number | boolean>;
      },
    ): Promise<{ result: EvaluateResponse; cacheStatus: string; evalMs: string }> {
      const res = await fetch(`${API_URL}/v1/evaluate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sdk-key': sdkKey,
        },
        body: JSON.stringify(input),
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new ApiError(`Evaluation failed (${res.status})`, res.status);
      }
      return {
        result: (await res.json()) as EvaluateResponse,
        cacheStatus: res.headers.get('x-cache-status') ?? 'UNKNOWN',
        evalMs: res.headers.get('x-eval-time-ms') ?? '—',
      };
    },

    async config(sdkKey: string): Promise<{
      data: ConfigResponse;
      cacheStatus: string;
      evalMs: string;
    }> {
      const res = await fetch(`${API_URL}/v1/config`, {
        headers: { 'x-sdk-key': sdkKey },
        cache: 'no-store',
      });
      if (!res.ok) throw new ApiError(`Config failed (${res.status})`, res.status);
      return {
        data: (await res.json()) as ConfigResponse,
        cacheStatus: res.headers.get('x-cache-status') ?? 'UNKNOWN',
        evalMs: res.headers.get('x-eval-time-ms') ?? '—',
      };
    },

    streamUrl(
      sdkKey: string,
      userId: string,
      attributes: Record<string, string | number | boolean>,
    ): string {
      const params = new URLSearchParams({ sdkKey, userId });
      if (Object.keys(attributes).length > 0) {
        params.set('attributes', JSON.stringify(attributes));
      }
      return `${API_URL}/v1/stream?${params.toString()}`;
    },
  },
};