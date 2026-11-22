import { eq } from 'drizzle-orm';
import type { FlagConfig } from '@flagforge/evaluator';
import type { Database } from '../db/client.js';
import { environments, flags } from '../db/schema.js';
import type { EnvSnapshot } from './cache.js';
import type { EnvironmentRef, SnapshotLoader } from './service.js';

/**
 * The cold path: turns PostgreSQL rows into the same `EnvSnapshot` shape the
 * cache serves, so the rest of the data plane is storage-agnostic.
 */
export function createDbSnapshotLoader(db: Database): SnapshotLoader {
  return {
    async loadEnvironmentByKeyHash(keyHash: string): Promise<EnvironmentRef | null> {
      const [row] = await db
        .select({
          id: environments.id,
          name: environments.name,
          projectId: environments.projectId,
          sdkKeyPrefix: environments.sdkKeyPrefix,
        })
        .from(environments)
        .where(eq(environments.sdkKeyHash, keyHash))
        .limit(1);
      return row ?? null;
    },

    async loadSnapshot(environmentId: string): Promise<EnvSnapshot> {
      const rows = await db
        .select()
        .from(flags)
        .where(eq(flags.environmentId, environmentId));

      const configs: Record<string, FlagConfig> = {};
      let version = 0;
      for (const row of rows) {
        configs[row.key] = {
          key: row.key,
          name: row.name,
          enabled: row.enabled,
          defaultValue: row.defaultValue,
          rules: row.rulesJson,
          overrides: row.overridesJson,
          version: row.version,
        };
        if (row.version > version) version = row.version;
      }

      return { environmentId, version, flags: configs };
    },
  };
}
