import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration. `DATABASE_URL` is read from the environment so the
 * same config works locally (localhost) and inside docker (service DNS name).
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://flagforge:flagforge@localhost:5432/flagforge',
  },
});
