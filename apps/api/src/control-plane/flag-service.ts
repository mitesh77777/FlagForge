import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FlagConfig, JsonValue } from '@flagforge/evaluator';
import type { Database } from '../db/client.js';
import { auditLogs, environments, flags, projects } from '../db/schema.js';
import { DEMO_SDK_KEYS } from '../db/seed-data.js';
import type { FlagInput, FlagUpdate } from '../schemas.js';
import type { FlagCache, EnvSnapshot } from '../data-plane/cache.js';
import type { InvalidationBus } from '../data-plane/invalidation.js';
import type { SnapshotLoader } from '../data-plane/service.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { generateSdkKey, hashSdkKey, sdkKeyPrefix, type KeyTier } from '../lib/sdk-key.js';
import { rotationExpiry } from '../lib/rotation.js';

export const DEMO_PROJECT_SLUG = 'flagforge-demo';

export interface FlagServiceDeps {
  db: Database;
  cache: FlagCache;
  bus: InvalidationBus;
  loader: SnapshotLoader;
  logger: { error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

export interface FlagView {
  id: string;
  environmentId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  defaultValue: JsonValue;
  rules: FlagConfig['rules'];
  overrides: FlagConfig['overrides'];
  version: number;
  updatedAt: string;
}

interface FlagRow {
  id: string;
  environmentId: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  defaultValue: JsonValue;
  rulesJson: FlagConfig['rules'];
  overridesJson: FlagConfig['overrides'];
  version: number;
  updatedAt: Date;
}

function serializeFlag(row: FlagRow): FlagView {
  return {
    id: row.id,
    environmentId: row.environmentId,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    defaultValue: row.defaultValue,
    rules: row.rulesJson,
    overrides: row.overridesJson,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Control-plane use cases. Every mutation runs in a single PostgreSQL
 * transaction that (1) writes the flag row + increments the version and
 * (2) appends an immutable audit row. Only AFTER commit do we refresh the L2
 * cache and publish the invalidation message — so a failed transaction can never
 * produce a phantom cache update.
 */
export class FlagService {
  constructor(private readonly deps: FlagServiceDeps) {}

  // ── Projects ───────────────────────────────────────────────────────────────
  async listProjects() {
    return this.deps.db.select().from(projects).orderBy(projects.createdAt);
  }

  async createProject(input: { name: string; slug: string }) {
    const [existing] = await this.deps.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, input.slug))
      .limit(1);
    if (existing) throw new ConflictError(`project slug "${input.slug}" already exists`);
    const [row] = await this.deps.db.insert(projects).values(input).returning();
    return row!;
  }

  // ── Environments ───────────────────────────────────────────────────────────
  async listEnvironments(projectId?: string) {
    const query = this.deps.db.select().from(environments);
    const rows = projectId
      ? await query.where(eq(environments.projectId, projectId)).orderBy(environments.name)
      : await query.orderBy(environments.name);
    // Never expose the hash.
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      sdkKeyPrefix: r.sdkKeyPrefix,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getEnvironment(id: string) {
    const [row] = await this.deps.db
      .select()
      .from(environments)
      .where(eq(environments.id, id))
      .limit(1);
    if (!row) throw new NotFoundError(`environment ${id} not found`);
    return row;
  }

  // ── Ownership ──────────────────────────────────────────────────────────────
  // Every control-plane read/write funnels through one of these. They return
  // 404 (not 403) for records the caller does not own, so an authenticated user
  // can never confirm that another tenant's id exists.

  async listProjectsFor(ownerId: string) {
    return this.deps.db
      .select()
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .orderBy(projects.createdAt);
  }

  /**
   * Environment listing scoped to an owner (optionally one project).
   * Never exposes hashes — only the non-secret display prefix.
   */
  async listEnvironmentsForOwner(ownerId: string, projectId?: string) {
    const filters = [eq(projects.ownerId, ownerId)];
    if (projectId) filters.push(eq(environments.projectId, projectId));

    const rows = await this.deps.db
      .select({
        id: environments.id,
        projectId: environments.projectId,
        name: environments.name,
        sdkKeyPrefix: environments.sdkKeyPrefix,
        createdAt: environments.createdAt,
        previousKeyExpiresAt: environments.sdkKeyPrevExpiresAt,
      })
      .from(environments)
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .where(and(...filters))
      .orderBy(environments.name);

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      sdkKeyPrefix: row.sdkKeyPrefix,
      createdAt: row.createdAt.toISOString(),
      previousKeyExpiresAt: row.previousKeyExpiresAt
        ? row.previousKeyExpiresAt.toISOString()
        : null,
    }));
  }

  async assertProjectOwned(projectId: string, ownerId: string) {
    const [row] = await this.deps.db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundError('project not found');
    return row;
  }

  async assertEnvironmentOwned(environmentId: string, ownerId: string) {
    const [row] = await this.deps.db
      .select({
        id: environments.id,
        projectId: environments.projectId,
        name: environments.name,
        sdkKeyPrefix: environments.sdkKeyPrefix,
        sdkKeyPrevExpiresAt: environments.sdkKeyPrevExpiresAt,
      })
      .from(environments)
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .where(and(eq(environments.id, environmentId), eq(projects.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundError('environment not found');
    return row;
  }

  async assertFlagOwned(flagId: string, ownerId: string) {
    const [row] = await this.deps.db
      .select({
        id: flags.id,
        environmentId: flags.environmentId,
        key: flags.key,
      })
      .from(flags)
      .innerJoin(environments, eq(flags.environmentId, environments.id))
      .innerJoin(projects, eq(environments.projectId, projects.id))
      .where(and(eq(flags.id, flagId), eq(projects.ownerId, ownerId)))
      .limit(1);
    if (!row) throw new NotFoundError('flag not found');
    return row;
  }

  // ── Project provisioning ────────────────────────────────────────────────────

  /** Derive a globally unique, URL-safe slug (projects.slug is unique). */
  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'project';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate =
        attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      const [existing] = await this.deps.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, candidate))
        .limit(1);
      if (!existing) return candidate;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }

  /**
   * Creates a project plus its two environments in one transaction and returns
   * each raw SDK key exactly once. Used by signup and "New Project".
   */
  async createProjectWithEnvironments(ownerId: string, input: { name: string }) {
    const name = input.name.trim();
    if (name.length === 0) throw new ValidationError('project name is required');

    const slug = await this.uniqueSlug(name);

    return this.deps.db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ ownerId, name, slug })
        .returning();
      if (!project) throw new Error('failed to create project');

      const specs: Array<{ name: string; tier: KeyTier }> = [
        { name: 'development', tier: 'test' },
        { name: 'production', tier: 'live' },
      ];

      const created: Array<{
        id: string;
        name: string;
        tier: KeyTier;
        sdkKey: string;
        sdkKeyPrefix: string;
      }> = [];

      for (const spec of specs) {
        const rawKey = generateSdkKey(spec.tier);
        const [row] = await tx
          .insert(environments)
          .values({
            projectId: project.id,
            name: spec.name,
            sdkKeyHash: hashSdkKey(rawKey),
            sdkKeyPrefix: sdkKeyPrefix(rawKey),
          })
          .returning();
        if (!row) throw new Error('failed to create environment');
        created.push({
          id: row.id,
          name: row.name,
          tier: spec.tier,
          sdkKey: rawKey,
          sdkKeyPrefix: row.sdkKeyPrefix,
        });
      }

      return {
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          createdAt: project.createdAt.toISOString(),
        },
        environments: created,
      };
    });
  }

  /** Creates an environment and returns the RAW SDK key exactly once. */
  async createEnvironment(input: { projectId: string; name: string; tier: KeyTier }) {
    const [project] = await this.deps.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new NotFoundError(`project ${input.projectId} not found`);

    const rawKey = generateSdkKey(input.tier);
    const [row] = await this.deps.db
      .insert(environments)
      .values({
        projectId: input.projectId,
        name: input.name,
        sdkKeyHash: hashSdkKey(rawKey),
        sdkKeyPrefix: sdkKeyPrefix(rawKey),
      })
      .returning();
    if (!row) throw new Error('failed to create environment');

    return {
      environment: {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        sdkKeyPrefix: row.sdkKeyPrefix,
        createdAt: row.createdAt.toISOString(),
      },
      sdkKey: rawKey, // shown once, never retrievable again
    };
  }

  /**
   * Rotates an environment's SDK key, returning the new RAW key exactly once.
   *
   * The outgoing key is demoted to the previous-key slot and keeps
   * authenticating until `previousKeyExpiresAt`, so a rolling deploy never hits
   * a window of 401s. `graceSeconds <= 0` performs a hard cutover.
   */
  async rotateSdkKey(environmentId: string, tier: KeyTier, graceSeconds = 0) {
    const rawKey = generateSdkKey(tier);
    const previousKeyExpiresAt = rotationExpiry(graceSeconds);

    const row = await this.deps.db.transaction(async (tx) => {
      // Lock the row so two concurrent rotations cannot interleave and lose one
      // of the outgoing keys.
      const [current] = await tx
        .select()
        .from(environments)
        .where(eq(environments.id, environmentId))
        .for('update')
        .limit(1);
      if (!current) {
        throw new NotFoundError(`environment ${environmentId} not found`);
      }

      const [updated] = await tx
        .update(environments)
        .set({
          sdkKeyHash: hashSdkKey(rawKey),
          sdkKeyPrefix: sdkKeyPrefix(rawKey),
          sdkKeyPrevHash: current.sdkKeyHash,
          sdkKeyPrevExpiresAt: previousKeyExpiresAt,
        })
        .where(eq(environments.id, environmentId))
        .returning();
      return updated!;
    });

    return {
      environmentId: row.id,
      environment: row.name,
      sdkKey: rawKey,
      sdkKeyPrefix: row.sdkKeyPrefix,
      previousKeyExpiresAt: row.sdkKeyPrevExpiresAt
        ? row.sdkKeyPrevExpiresAt.toISOString()
        : null,
    };
  }

  // ── Flags ──────────────────────────────────────────────────────────────────
  async listFlags(environmentId: string): Promise<FlagView[]> {
    const rows = await this.deps.db
      .select()
      .from(flags)
      .where(eq(flags.environmentId, environmentId))
      .orderBy(flags.key);
    return rows.map(serializeFlag);
  }

  async getFlagById(flagId: string): Promise<FlagView> {
    const [row] = await this.deps.db
      .select()
      .from(flags)
      .where(eq(flags.id, flagId))
      .limit(1);
    if (!row) throw new NotFoundError(`flag ${flagId} not found`);
    return serializeFlag(row);
  }

  async createFlag(environmentId: string, input: FlagInput, actor: string): Promise<FlagView> {
    await this.getEnvironment(environmentId);

    const view = await this.deps.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: flags.id })
        .from(flags)
        .where(and(eq(flags.environmentId, environmentId), eq(flags.key, input.key)))
        .limit(1);
      if (existing) {
        throw new ConflictError(`flag "${input.key}" already exists in this environment`);
      }

      const [row] = await tx
        .insert(flags)
        .values({
          environmentId,
          key: input.key,
          name: input.name,
          description: input.description,
          enabled: input.enabled,
          defaultValue: input.defaultValue,
          rulesJson: input.rules,
          overridesJson: input.overrides,
          version: 1,
        })
        .returning();
      if (!row) throw new Error('failed to create flag');

      await tx.insert(auditLogs).values({
        environmentId,
        flagKey: row.key,
        actorEmail: actor,
        action: 'flag.created',
        beforeJson: null,
        afterJson: serializeFlag(row) as unknown as JsonValue,
      });

      return serializeFlag(row);
    });

    // Commit succeeded — only now is it safe to touch the cache and bus.
    await this.afterCommit(environmentId, view.key, 'flag.created', view.version);
    return view;
  }

  async updateFlag(flagId: string, patch: FlagUpdate, actor: string): Promise<FlagView> {
    const outcome = await this.deps.db.transaction(async (tx) => {
      // Lock the row so concurrent edits serialize and versioning is correct.
      const [current] = await tx
        .select()
        .from(flags)
        .where(eq(flags.id, flagId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundError(`flag ${flagId} not found`);

      const before = serializeFlag(current);

      const [row] = await tx
        .update(flags)
        .set({
          name: patch.name ?? current.name,
          description: patch.description ?? current.description,
          enabled: patch.enabled ?? current.enabled,
          defaultValue: patch.defaultValue ?? current.defaultValue,
          rulesJson: patch.rules ?? current.rulesJson,
          overridesJson: patch.overrides ?? current.overridesJson,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(flags.id, flagId))
        .returning();
      if (!row) throw new Error('failed to update flag');

      const action =
        patch.enabled !== undefined && Object.keys(patch).length === 1
          ? 'flag.toggled'
          : 'flag.updated';

      await tx.insert(auditLogs).values({
        environmentId: row.environmentId,
        flagKey: row.key,
        actorEmail: actor,
        action,
        beforeJson: before as unknown as JsonValue,
        afterJson: serializeFlag(row) as unknown as JsonValue,
      });

      return { view: serializeFlag(row), action };
    });

    await this.afterCommit(
      outcome.view.environmentId,
      outcome.view.key,
      outcome.action,
      outcome.view.version,
    );
    return outcome.view;
  }

  async deleteFlag(flagId: string, actor: string): Promise<{ deleted: true; key: string }> {
    const outcome = await this.deps.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(flags)
        .where(eq(flags.id, flagId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundError(`flag ${flagId} not found`);

      await tx.delete(flags).where(eq(flags.id, flagId));
      await tx.insert(auditLogs).values({
        environmentId: current.environmentId,
        flagKey: current.key,
        actorEmail: actor,
        action: 'flag.deleted',
        beforeJson: serializeFlag(current) as unknown as JsonValue,
        afterJson: null,
      });

      return {
        environmentId: current.environmentId,
        key: current.key,
        version: current.version,
      };
    });

    await this.afterCommit(
      outcome.environmentId,
      outcome.key,
      'flag.deleted',
      outcome.version,
    );
    return { deleted: true, key: outcome.key };
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  async listAuditLogs(environmentId: string, limit = 50) {
    const rows = await this.deps.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.environmentId, environmentId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((r) => ({
      id: r.id,
      environmentId: r.environmentId,
      flagKey: r.flagKey,
      actorEmail: r.actorEmail,
      action: r.action,
      beforeJson: r.beforeJson,
      afterJson: r.afterJson,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ── Guest sandbox bootstrap ─────────────────────────────────────────────────
  async getSandbox() {
    const [project] = await this.deps.db
      .select()
      .from(projects)
      .where(eq(projects.slug, DEMO_PROJECT_SLUG))
      .limit(1);
    if (!project) return null;

    const envRows = await this.deps.db
      .select()
      .from(environments)
      .where(eq(environments.projectId, project.id))
      .orderBy(environments.name);

    const envViews = envRows.map((e) => ({
      id: e.id,
      name: e.name,
      sdkKeyPrefix: e.sdkKeyPrefix,
      createdAt: e.createdAt.toISOString(),
    }));

    const flagsByEnvironment: Record<string, FlagView[]> = {};
    for (const env of envRows) {
      flagsByEnvironment[env.id] = await this.listFlags(env.id);
    }

    const prod = envRows.find((e) => e.name === 'prod');
    const audit = prod ? await this.listAuditLogs(prod.id, 50) : [];

    return {
      project: { id: project.id, name: project.name, slug: project.slug },
      environments: envViews,
      flagsByEnvironment,
      auditLogs: audit,
      // Public demo keys so the zero-friction sandbox can stream live updates.
      demoKeys: { prod: DEMO_SDK_KEYS.prod, dev: DEMO_SDK_KEYS.dev },
    };
  }

  // ── Post-commit cache + bus propagation ─────────────────────────────────────
  private async afterCommit(
    environmentId: string,
    flagKey: string,
    action: string,
    version: number,
  ): Promise<void> {
    const logger = this.deps.logger;
    try {
      // Purge this instance's L1 immediately so the writing process cannot serve
      // stale data in the window before the Pub/Sub echo arrives.
      this.deps.cache.deleteL1(environmentId);

      const snapshot: EnvSnapshot = await this.deps.loader.loadSnapshot(environmentId);
      await this.deps.cache.setL2(snapshot);
      await this.deps.bus.publish({
        environmentId,
        flagKey,
        action,
        version: snapshot.version,
      });
    } catch (err) {
      // The write is committed; a propagation failure must not fail the request.
      // L2 TTL bounds staleness and the next read repopulates from PostgreSQL.
      logger.error({ err, environmentId, flagKey, version }, 'post-commit propagation failed');
    }
  }
}
