import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

/**
 * Applies every pending SQL migration in `apps/api/drizzle`. Safe to run on
 * every container start (idempotent — drizzle tracks applied migrations).
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDatabase(connectionString);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const isDirectRun =
  invokedPath.endsWith('/src/db/migrate.ts') ||
  invokedPath.endsWith('/dist/db/migrate.js');

if (isDirectRun) {
  const url =
    process.env.DATABASE_URL ??
    'postgres://flagforge:flagforge@localhost:5432/flagforge';

  runMigrations(url)
    .then(() => {
      console.log('✅ migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('❌ migration failed', err);
      process.exit(1);
    });
}
