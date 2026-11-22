import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDatabase } from './client.js';

/**
 * Danger: truncates every application table. Used by `pnpm db:reset` in local
 * development to get back to an empty database before re-running migrations+seed.
 */
async function main(): Promise<void> {
  const url =
    process.env.DATABASE_URL ??
    'postgres://flagforge:flagforge@localhost:5432/flagforge';
  const { db, pool } = createDatabase(url);
  try {
    await db.execute(
      sql`TRUNCATE TABLE "audit_logs", "flags", "environments", "projects" RESTART IDENTITY CASCADE`,
    );
    console.log('🧹 all application tables truncated');
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('❌ reset failed', err);
    process.exit(1);
  });
