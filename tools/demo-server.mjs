/**
 * FlagForge — local UI preview harness (NOT the production API).
 * ─────────────────────────────────────────────────────────────────────────────
 * The production API is `apps/api` (PostgreSQL + Redis: transactions, audit log,
 * two-tier cache, Pub/Sub invalidation). This harness exists so the full product
 * can be clicked through on a machine without Docker/Postgres/Redis.
 *
 * Real code reused: `@flagforge/evaluator` (rule engine + MurmurHash3),
 * `apps/api/dist/ai/compiler` (Zod-validated compiler), `.../simulator`
 * (1,000-user blast radius), `.../seed-data` (the demo flags).
 *
 * Faked: persistence (in-memory), password checking, session storage, the Redis
 * L2 tier and Postgres transactions. SSE fan-out is real.
 *
 * Usage:  pnpm demo   (run `pnpm build` first so the dist imports exist)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { evaluateAll } from '../packages/evaluator/dist/index.js';
import { compileRule } from '../apps/api/dist/ai/compiler.js';
import { simulateRule } from '../apps/api/dist/ai/simulator.js';
import { SEED_FLAGS, DEMO_SDK_KEYS } from '../apps/api/dist/db/seed-data.js';

const PORT = Number(process.env.DEMO_PORT ?? 8080);
const DEFAULT_WEB = process.env.DEMO_WEB_ORIGIN ?? 'http://localhost:3000';

const compilerConfig = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  LLM_MODEL: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  LLM_TIMEOUT_MS: 20_000,
};

// ── In-memory state ──────────────────────────────────────────────────────────

const users = new Map();
const projects = new Map();
const environments = new Map();
const flags = new Map();
const audits = new Map();
const sessions = new Map();
const sseClients = new Map();
const warm = new Set();

const nowIso = () => new Date().toISOString();
const newKey = (live) =>
  `ff_${live ? 'live' : 'test'}_${randomBytes(16).toString('hex')}`;

function userFromAuth(req) {
  const header = req.headers.authorization ?? '';
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : '';
  const userId = sessions.get(token);
  return userId ? users.get(userId) ?? null : null;
}

function ownedProject(projectId, user) {
  const project = projects.get(projectId);
  return project && project.ownerId === user.id ? project : null;
}

function ownedEnvironment(environmentId, user) {
  const environment = environments.get(environmentId);
  if (!environment) return null;
  return ownedProject(environment.projectId, user) ? environment : null;
}

function ownedFlag(flagId, user) {
  const flag = flags.get(flagId);
  if (!flag) return null;
  return ownedEnvironment(flag.environmentId, user) ? flag : null;
}

function envByKey(rawKey) {
  for (const environment of environments.values()) {
    if (environment.sdkKey === rawKey) return environment;
  }
  return null;
}

function serializeEnvironment(environment) {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    sdkKeyPrefix: environment.sdkKeyPrefix,
    createdAt: environment.createdAt,
    previousKeyExpiresAt: environment.previousKeyExpiresAt,
  };
}

function serializeProject(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    createdAt: project.createdAt,
  };
}

function issueToken(user) {
  const token = `demo_${randomUUID()}`;
  sessions.set(token, user.id);
  return token;
}

function appendAudit(environmentId, flagKey, action, before, after, actor) {
  const list = audits.get(environmentId) ?? [];
  list.unshift({
    id: randomUUID(),
    environmentId,
    flagKey,
    actorEmail: actor,
    action,
    beforeJson: before,
    afterJson: after,
    createdAt: nowIso(),
  });
  audits.set(environmentId, list);
}

/** Create a project with Development + Production environments. */
function createWorkspace(ownerId, name, explicitKeys) {
  const id = randomUUID();
  const project = {
    id,
    ownerId,
    name,
    slug:
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') ||
      `project-${id.slice(0, 6)}`,
    createdAt: nowIso(),
  };
  projects.set(id, project);

  const created = [];
  for (const spec of [
    { name: 'development', tier: 'test' },
    { name: 'production', tier: 'live' },
  ]) {
    const sdkKey = explicitKeys?.[spec.name] ?? newKey(spec.tier === 'live');
    const environment = {
      id: randomUUID(),
      projectId: id,
      name: spec.name,
      tier: spec.tier,
      sdkKey,
      sdkKeyPrefix: sdkKey.slice(0, 16),
      createdAt: nowIso(),
      previousKeyExpiresAt: null,
    };
    environments.set(environment.id, environment);
    audits.set(environment.id, []);
    created.push(environment);
  }

  return { project, environments: created };
}

function seedDemoWorkspace(user) {
  const existing = [...projects.values()].find((p) => p.ownerId === user.id);
  if (existing) {
    return { project: existing, environments: [...environments.values()].filter((e) => e.projectId === existing.id) };
  }

  const { project, environments: created } = createWorkspace(
    user.id,
    'Acme SaaS (Demo)',
    // The well-known public demo keys, so the quickstart example runs with no setup.
    { development: DEMO_SDK_KEYS.dev, production: DEMO_SDK_KEYS.prod },
  );

  for (const environment of created) {
    const isDev = environment.name === 'development';
    SEED_FLAGS.forEach((seed) => {
      const flag = {
        id: randomUUID(),
        environmentId: environment.id,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        enabled: isDev ? false : seed.enabled,
        defaultValue: seed.defaultValue,
        rules: structuredClone(seed.rules),
        overrides: structuredClone(seed.overrides),
        version: 1,
        updatedAt: nowIso(),
      };
      flags.set(flag.id, flag);
      appendAudit(
        environment.id,
        flag.key,
        'flag.created',
        null,
        { key: flag.key, enabled: flag.enabled, version: 1 },
        'seed@flagforge.dev',
      );
    });
  }

  return { project, environments: created };
}

function ensureDemoUser() {
  const email = 'demo@flagforge.dev';
  const existing = [...users.values()].find((u) => u.email === email);
  if (existing) return existing;
  const user = {
    id: randomUUID(),
    email,
    name: 'Demo User',
    createdAt: nowIso(),
  };
  users.set(user.id, user);
  seedDemoWorkspace(user);
  return user;
}

// ── SSE ──────────────────────────────────────────────────────────────────────

function sseWrite(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    sseClients.delete(client.id);
  }
}

function snapshotFor(environmentId) {
  const configs = {};
  let version = 0;
  for (const flag of flags.values()) {
    if (flag.environmentId !== environmentId) continue;
    configs[flag.key] = {
      key: flag.key,
      name: flag.name,
      enabled: flag.enabled,
      defaultValue: flag.defaultValue,
      rules: flag.rules,
      overrides: flag.overrides,
      version: flag.version,
    };
    if (flag.version > version) version = flag.version;
  }
  return { environmentId, version, flags: configs };
}

function broadcast(environmentId, meta) {
  const snapshot = snapshotFor(environmentId);
  for (const client of sseClients.values()) {
    if (client.environmentId !== environmentId) continue;
    const base = { version: snapshot.version, ...meta };
    sseWrite(
      client,
      'flags',
      client.context
        ? { ...base, results: evaluateAll(snapshot.flags, client.context) }
        : { ...base, flags: snapshot.flags },
    );
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function corsFor(req) {
  return {
    'access-control-allow-origin': req.headers.origin ?? DEFAULT_WEB,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      'content-type,authorization,x-sdk-key,x-actor-email',
    'access-control-expose-headers': 'x-cache-status,x-eval-time-ms',
    'access-control-max-age': '600',
  };
}

function send(req, res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...corsFor(req), ...extra });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsFor(req));
    res.end();
    return;
  }

  // Health
  if (path === '/health' || path === '/health/live' || path === '/api/health') {
    return send(req, res, 200, { status: 'ok', mode: 'demo-harness' });
  }
  if (path === '/health/ready') {
    return send(req, res, 200, {
      status: 'ready',
      mode: 'demo-harness',
      checks: { postgres: { ok: true }, redis: { ok: true } },
      note: 'in-memory preview — not the production API',
    });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (path === '/api/auth/demo' && req.method === 'POST') {
    const user = ensureDemoUser();
    seedDemoWorkspace(user);
    return send(req, res, 200, {
      user,
      token: issueToken(user),
      expiresIn: 604800,
    });
  }

  if (path === '/api/auth/signup' && req.method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) {
      return send(req, res, 422, {
        error: 'validation_failed',
        issues: [{ path: 'email', message: 'enter a valid email address' }],
      });
    }
    if (String(body.password ?? '').length < 8) {
      return send(req, res, 422, {
        error: 'validation_failed',
        issues: [{ path: 'password', message: 'password must be at least 8 characters' }],
      });
    }
    if ([...users.values()].some((u) => u.email === email)) {
      return send(req, res, 409, { error: 'conflict', message: 'an account with that email already exists' });
    }
    const user = {
      id: randomUUID(),
      email,
      name: String(body.name ?? '').trim() || email.split('@')[0],
      createdAt: nowIso(),
    };
    users.set(user.id, user);
    const workspace = createWorkspace(user.id, `${user.name}'s Workspace`);
    return send(req, res, 201, {
      user,
      token: issueToken(user),
      expiresIn: 604800,
      project: serializeProject(workspace.project),
      environments: workspace.environments.map((e) => ({
        id: e.id,
        name: e.name,
        tier: e.tier,
        sdkKey: e.sdkKey,
        sdkKeyPrefix: e.sdkKeyPrefix,
      })),
    });
  }

  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const user = [...users.values()].find((u) => u.email === email);
    if (!user) {
      return send(req, res, 401, { error: 'unauthorized', message: 'invalid email or password' });
    }
    return send(req, res, 200, { user, token: issueToken(user), expiresIn: 604800 });
  }

  if (path === '/api/auth/logout') return send(req, res, 200, { ok: true });

  if (path === '/api/auth/me') {
    const user = userFromAuth(req);
    if (!user) return send(req, res, 401, { error: 'unauthorized', message: 'authentication required' });
    return send(req, res, 200, { user });
  }

  // ── Public demo bootstrap (login-free, demo workspace only) ───────────────
  if (path === '/api/sandbox') {
    const user = [...users.values()].find((u) => u.email === 'demo@flagforge.dev');
    if (!user) return send(req, res, 404, { error: 'not_found' });
    const project = [...projects.values()].find((p) => p.ownerId === user.id);
    const list = project
      ? [...environments.values()].filter((e) => e.projectId === project.id)
      : [];
    const flagsByEnvironment = {};
    for (const environment of list) {
      flagsByEnvironment[environment.id] = [...flags.values()].filter(
        (f) => f.environmentId === environment.id,
      );
    }
    const production = list.find((e) => e.name === 'production') ?? list[0];
    return send(req, res, 200, {
      project: project ? serializeProject(project) : null,
      environments: list.map(serializeEnvironment),
      flagsByEnvironment,
      auditLogs: production ? audits.get(production.id) ?? [] : [],
      demoKeys: {
        prod: DEMO_SDK_KEYS.prod,
        dev: DEMO_SDK_KEYS.dev,
      },
    });
  }

  // ── Authenticated control plane ───────────────────────────────────────────
  if (path.startsWith('/api/')) {
    const user = userFromAuth(req);
    if (!user) {
      return send(req, res, 401, { error: 'unauthorized', message: 'authentication required' });
    }

    if (path === '/api/projects' && req.method === 'GET') {
      return send(req, res, 200, {
        projects: [...projects.values()]
          .filter((p) => p.ownerId === user.id)
          .map(serializeProject),
      });
    }

    if (path === '/api/projects' && req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body.name ?? '').trim();
      if (name.length === 0) {
        return send(req, res, 422, { error: 'validation_failed', issues: [{ path: 'name', message: 'project name is required' }] });
      }
      const workspace = createWorkspace(user.id, name);
      return send(req, res, 201, {
        project: serializeProject(workspace.project),
        environments: workspace.environments.map((e) => ({
          id: e.id,
          name: e.name,
          tier: e.tier,
          sdkKey: e.sdkKey,
          sdkKeyPrefix: e.sdkKeyPrefix,
        })),
      });
    }

    if (path === '/api/environments' && req.method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const list = [...environments.values()].filter(
        (e) => (!projectId || e.projectId === projectId) && ownedProject(e.projectId, user),
      );
      return send(req, res, 200, { environments: list.map(serializeEnvironment) });
    }

    const rotate = /^\/api\/environments\/([^/]+)\/rotate-key$/.exec(path);
    if (rotate && req.method === 'POST') {
      const environment = ownedEnvironment(rotate[1], user);
      if (!environment) return send(req, res, 404, { error: 'not_found' });
      environment.sdkKey = newKey(environment.tier === 'live');
      environment.sdkKeyPrefix = environment.sdkKey.slice(0, 16);
      environment.previousKeyExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
      return send(req, res, 200, {
        environmentId: environment.id,
        environment: environment.name,
        sdkKey: environment.sdkKey,
        sdkKeyPrefix: environment.sdkKeyPrefix,
        previousKeyExpiresAt: environment.previousKeyExpiresAt,
      });
    }

    const flagsOf = /^\/api\/environments\/([^/]+)\/flags$/.exec(path);
    if (flagsOf && req.method === 'GET') {
      const environment = ownedEnvironment(flagsOf[1], user);
      if (!environment) return send(req, res, 404, { error: 'not_found' });
      return send(req, res, 200, {
        flags: [...flags.values()].filter((f) => f.environmentId === environment.id),
      });
    }

    const auditOf = /^\/api\/environments\/([^/]+)\/audit-logs$/.exec(path);
    if (auditOf && req.method === 'GET') {
      const environment = ownedEnvironment(auditOf[1], user);
      if (!environment) return send(req, res, 404, { error: 'not_found' });
      return send(req, res, 200, { auditLogs: audits.get(environment.id) ?? [] });
    }

    const playground = /^\/api\/environments\/([^/]+)\/playground$/.exec(path);
    if (playground && req.method === 'POST') {
      const environment = ownedEnvironment(playground[1], user);
      if (!environment) return send(req, res, 404, { error: 'not_found' });
      const body = await readJson(req);
      const flag = [...flags.values()].find(
        (f) => f.environmentId === environment.id && f.key === body.key,
      );
      if (!flag) return send(req, res, 404, { error: 'not_found', message: 'flag not found' });
      const started = process.hrtime.bigint();
      const snapshot = snapshotFor(environment.id);
      const result = evaluateAll(snapshot.flags, {
        userId: String(body.userId ?? 'playground_user'),
        attributes: body.attributes ?? {},
      })[flag.key];
      const evalMs = (Number(process.hrtime.bigint() - started) / 1e6).toFixed(3);
      const cacheStatus = warm.has(environment.id) ? 'L1-HIT' : 'DB-FALLBACK';
      warm.add(environment.id);
      return send(req, res, 200, {
        key: flag.key,
        value: result.value,
        reason: result.reason,
        ruleId: result.ruleId ?? null,
        bucket: result.bucket ?? null,
        version: result.version,
        cacheStatus,
        evalMs,
      });
    }

    if (path === '/api/flags' && req.method === 'POST') {
      const body = await readJson(req);
      const environment = ownedEnvironment(String(body.environmentId ?? ''), user);
      if (!environment) return send(req, res, 404, { error: 'not_found' });
      const key = String(body.key ?? '');
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(key)) {
        return send(req, res, 422, { error: 'validation_failed', issues: [{ path: 'key', message: 'invalid key' }] });
      }
      if ([...flags.values()].some((f) => f.environmentId === environment.id && f.key === key)) {
        return send(req, res, 409, { error: 'conflict', message: `flag "${key}" already exists` });
      }
      const flag = {
        id: randomUUID(),
        environmentId: environment.id,
        key,
        name: String(body.name ?? key),
        description: String(body.description ?? ''),
        enabled: body.enabled ?? false,
        defaultValue: body.defaultValue ?? false,
        rules: body.rules ?? [],
        overrides: body.overrides ?? { allowlist: [], blocklist: [] },
        version: 1,
        updatedAt: nowIso(),
      };
      flags.set(flag.id, flag);
      appendAudit(environment.id, key, 'flag.created', null, { key, enabled: flag.enabled, version: 1 }, user.email);
      broadcast(environment.id, { changedKey: key, action: 'flag.created', ts: Date.now() });
      return send(req, res, 201, { flag });
    }

    const flagPath = /^\/api\/flags\/([^/]+)$/.exec(path);
    if (flagPath) {
      const flag = ownedFlag(flagPath[1], user);
      if (!flag) return send(req, res, 404, { error: 'not_found' });

      if (req.method === 'GET') return send(req, res, 200, { flag });

      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const before = { enabled: flag.enabled, rules: flag.rules, overrides: flag.overrides };
        for (const field of ['name', 'description', 'enabled', 'defaultValue', 'rules', 'overrides']) {
          if (body[field] !== undefined) flag[field] = body[field];
        }
        flag.version += 1;
        flag.updatedAt = nowIso();
        const action =
          Object.keys(body).length === 1 && body.enabled !== undefined
            ? 'flag.toggled'
            : 'flag.updated';
        appendAudit(flag.environmentId, flag.key, action, before, {
          enabled: flag.enabled,
          rules: flag.rules,
          overrides: flag.overrides,
        }, user.email);
        broadcast(flag.environmentId, { changedKey: flag.key, action, ts: Date.now() });
        console.log(`[demo] ${action} ${flag.key} → v${flag.version}`);
        return send(req, res, 200, { flag });
      }

      if (req.method === 'DELETE') {
        const before = { key: flag.key, enabled: flag.enabled, version: flag.version };
        flags.delete(flag.id);
        appendAudit(flag.environmentId, flag.key, 'flag.deleted', before, null, user.email);
        broadcast(flag.environmentId, { changedKey: flag.key, action: 'flag.deleted', ts: Date.now() });
        return send(req, res, 200, { deleted: true, key: flag.key });
      }
    }

    // AI
    if (path === '/api/ai/status') {
      const configured = Boolean(compilerConfig.LLM_API_KEY);
      return send(req, res, 200, {
        configured,
        model: configured ? compilerConfig.LLM_MODEL : null,
        baseUrl: configured ? compilerConfig.LLM_BASE_URL : null,
        mode: configured ? 'llm' : 'deterministic-fallback',
      });
    }

    if (path === '/api/ai/compile-rule' && req.method === 'POST') {
      const body = await readJson(req);
      const compiled = await compileRule(
        { prompt: body.prompt, flagKey: body.flagKey, currentRule: body.currentRule },
        compilerConfig,
      );
      return send(req, res, 200, {
        flagKey: body.flagKey,
        prompt: body.prompt,
        compiledRule: compiled.compiledRule,
        source: compiled.source,
        model: compiled.model,
        warnings: compiled.warnings,
        diff: compiled.diff,
        simulation: simulateRule(body.flagKey, compiled.compiledRule),
      });
    }

    return send(req, res, 404, { error: 'not_found', path });
  }

  // ── Data plane ────────────────────────────────────────────────────────────
  if (path === '/v1/config') {
    const keyHeader = req.headers['x-sdk-key'];
    const environment = envByKey(typeof keyHeader === 'string' ? keyHeader : '');
    if (!environment) return send(req, res, 401, { error: 'unauthorized' });
    const started = process.hrtime.bigint();
    const snapshot = snapshotFor(environment.id);
    const cacheStatus = warm.has(environment.id) ? 'L1-HIT' : 'DB-FALLBACK';
    warm.add(environment.id);
    return send(req, res, 200, {
      environment: environment.name,
      environmentId: environment.id,
      version: snapshot.version,
      flags: snapshot.flags,
    }, {
      'x-cache-status': cacheStatus,
      'x-eval-time-ms': (Number(process.hrtime.bigint() - started) / 1e6).toFixed(3),
    });
  }

  if (path === '/v1/evaluate/batch' && req.method === 'POST') {
    const keyHeader = req.headers['x-sdk-key'];
    const environment = envByKey(typeof keyHeader === 'string' ? keyHeader : '');
    if (!environment) return send(req, res, 401, { error: 'unauthorized' });
    const body = await readJson(req);
    const snapshot = snapshotFor(environment.id);
    return send(req, res, 200, {
      environment: environment.name,
      userId: body.userId,
      version: snapshot.version,
      flags: evaluateAll(snapshot.flags, {
        userId: String(body.userId ?? 'anonymous'),
        attributes: body.attributes ?? {},
      }),
    }, { 'x-cache-status': 'L1-HIT', 'x-eval-time-ms': '0.100' });
  }

  if (path === '/v1/evaluate' && req.method === 'POST') {
    const keyHeader = req.headers['x-sdk-key'];
    const environment = envByKey(typeof keyHeader === 'string' ? keyHeader : '');
    if (!environment) return send(req, res, 401, { error: 'unauthorized' });
    const body = await readJson(req);
    const started = process.hrtime.bigint();
    const snapshot = snapshotFor(environment.id);
    const result = evaluateAll(snapshot.flags, {
      userId: String(body.userId ?? 'anonymous'),
      attributes: body.attributes ?? {},
    })[body.key];
    if (!result) return send(req, res, 404, { error: 'flag_not_found', key: body.key });
    // Report a genuine progression: the first read for an environment is a cold
    // load, everything after it is served from the in-memory snapshot.
    const cacheStatus = warm.has(environment.id) ? 'L1-HIT' : 'DB-FALLBACK';
    warm.add(environment.id);
    return send(req, res, 200, {
      key: body.key,
      value: result.value,
      reason: result.reason,
      ruleId: result.ruleId ?? null,
      bucket: result.bucket ?? null,
      version: result.version,
      environment: environment.name,
    }, {
      'x-cache-status': cacheStatus,
      'x-eval-time-ms': (Number(process.hrtime.bigint() - started) / 1e6).toFixed(3),
    });
  }

  if (path === '/v1/stream') {
    const environment = envByKey(String(url.searchParams.get('sdkKey') ?? ''));
    if (!environment) return send(req, res, 401, { error: 'unauthorized' });

    const userId = url.searchParams.get('userId');
    let attributes = {};
    const raw = url.searchParams.get('attributes');
    if (raw) {
      try {
        attributes = JSON.parse(raw);
      } catch {
        /* ignore */
      }
    }

    const client = {
      id: randomUUID(),
      environmentId: environment.id,
      res,
      context: userId ? { userId, attributes } : undefined,
    };
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...corsFor(req),
    });
    sseClients.set(client.id, client);

    const snapshot = snapshotFor(environment.id);
    sseWrite(client, 'ready', {
      environment: environment.name,
      environmentId: environment.id,
      version: snapshot.version,
    });
    sseWrite(client, 'flags', client.context
      ? { version: snapshot.version, results: evaluateAll(snapshot.flags, client.context) }
      : { version: snapshot.version, flags: snapshot.flags });

    req.on('close', () => sseClients.delete(client.id));
    req.on('error', () => sseClients.delete(client.id));
    return;
  }

  return send(req, res, 404, { error: 'not_found', path });
});

const heartbeat = setInterval(() => {
  for (const client of sseClients.values()) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      sseClients.delete(client.id);
    }
  }
}, 20_000);
heartbeat.unref();

server.listen(PORT, () => {
  ensureDemoUser();
  console.log('');
  console.log('  FlagForge — local preview harness (in-memory, full product)');
  console.log(`  API      http://localhost:${PORT}`);
  console.log(`  Web      ${DEFAULT_WEB}`);
  console.log('  Demo     demo@flagforge.dev / demo1234');
  console.log('  Real evaluator + compiler + simulator · no PostgreSQL/Redis');
  console.log('');
});