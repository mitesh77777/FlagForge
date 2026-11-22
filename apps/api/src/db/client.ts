import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export interface DatabaseHandle {
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
}

/**
 * Create a pooled Drizzle handle. The data plane never calls this on the hot
 * path; only the control plane and cold-fallback cache fills touch PostgreSQL.
 */
export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = NodePgDatabase<typeof schema>;
export { schema };
