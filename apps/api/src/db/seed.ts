import 'dotenv/config';
import { eq } from 'drizzle-orm';
import type { JsonValue } from '@flagforge/evaluator';
import { hashPassword } from '../lib/password.js';
import { createDatabase, type Database } from './client.js';
import { auditLogs, environments, flags, projects, users } from './schema.js';
import { DEMO_SDK_KEYS, SEED_FLAGS, keyPrefix, sha256 } from './seed-data.js';

export const DEMO_PROJECT_SLUG = 'flagforge-demo';

interface SeededEnvironment {
  id: string;
  name: string;
}

export interface SeedOptions {
  /**
   * `true` wipes any existing demo project (cascade) and rebuilds it.
   * `false` (default) is a no-op when the demo project already exists, so a
   * deployed instance is never reset by a restart or redeploy.
   */
  force?: boolean;
  /** Account that owns the demo project. */
  ownerId?: string;
}

/**
 * Deterministic demo seed. With `force` it deletes any prior demo project
 * (cascade) and re-creates it with two environments, four flags and a realistic
 * audit trail. Returns `true` when data was written, `false` when it was skipped.
 */
export async function seedDatabase(
  db: Database,
  options: SeedOptions = {},
): Promise<boolean> {
  if (!options.force) {
    const existing = await db.query.projects.findFirst({
      where: (p, { eq: eqFn }) => eqFn(p.slug, DEMO_PROJECT_SLUG),
    });
    if (existing) return false;
  }

  await db.delete(projects).where(eq(projects.slug, DEMO_PROJECT_SLUG));

  const [project] = await db
    .insert(projects)
    .values({
      name: 'Acme SaaS (Demo)',
      slug: DEMO_PROJECT_SLUG,
      ownerId: options.ownerId ?? null,
    })
    .returning();

  if (!project) throw new Error('failed to insert demo project');

  const envSpecs: Array<{ name: string; rawKey: string }> = [
    { name: 'prod', rawKey: DEMO_SDK_KEYS.prod },
    { name: 'dev', rawKey: DEMO_SDK_KEYS.dev },
  ];

  const seeded: SeededEnvironment[] = [];
  for (const spec of envSpecs) {
    const [env] = await db
      .insert(environments)
      .values({
        projectId: project.id,
        name: spec.name,
        sdkKeyHash: sha256(spec.rawKey),
        sdkKeyPrefix: keyPrefix(spec.rawKey),
      })
      .returning();
    if (!env) throw new Error(`failed to insert environment ${spec.name}`);
    seeded.push({ id: env.id, name: env.name });
  }

  const prod = seeded.find((e) => e.name === 'prod');
  const dev = seeded.find((e) => e.name === 'dev');
  if (!prod || !dev) throw new Error('demo environments missing');

  // prod gets the full flag set; dev mirrors it with everything off (typical flow).
  const now = Date.now();

  for (const env of [prod, dev]) {
    const isDev = env.name === 'dev';
    let i = 0;
    for (const flag of SEED_FLAGS) {
      const enabled = isDev ? false : flag.enabled;
      const [row] = await db
        .insert(flags)
        .values({
          environmentId: env.id,
          key: flag.key,
          name: flag.name,
          description: flag.description,
          enabled,
          defaultValue: flag.defaultValue,
          rulesJson: flag.rules,
          overridesJson: flag.overrides,
          version: 1,
          updatedAt: new Date(now - (SEED_FLAGS.length - i) * 60 * 60 * 1000),
        })
        .returning();

      if (row) {
        await db.insert(auditLogs).values({
          environmentId: env.id,
          flagKey: row.key,
          actorEmail: 'seed@flagforge.dev',
          action: 'flag.created',
          beforeJson: null,
          afterJson: snapshot(row) as JsonValue,
          createdAt: new Date(now - (SEED_FLAGS.length - i) * 60 * 60 * 1000),
        });
      }
      i += 1;
    }

    // A representative toggle + edit so the audit viewer has a "diff" to render.
    const pricing = await db.query.flags.findFirst({
      where: (f, { and, eq: eqFn }) =>
        and(eqFn(f.environmentId, env.id), eqFn(f.key, 'pricing-page-v2')),
    });
    if (pricing) {
      await db.insert(auditLogs).values([
        {
          environmentId: env.id,
          flagKey: pricing.key,
          actorEmail: 'fname.lname@acme.io',
          action: 'flag.updated',
          beforeJson: { rolloutPercentage: 5 } as JsonValue,
          afterJson: { rolloutPercentage: 10 } as JsonValue,
          createdAt: new Date(now - 45 * 60 * 1000),
        },
        {
          environmentId: env.id,
          flagKey: pricing.key,
          actorEmail: 'fname.lname@acme.io',
          action: 'flag.toggled',
          beforeJson: { enabled: false } as JsonValue,
          afterJson: { enabled: pricing.enabled } as JsonValue,
          createdAt: new Date(now - 20 * 60 * 1000),
        },
      ]);
    }
  }

  return true;
}

/** Create (or fetch) the account that owns the seeded demo workspace. */
export async function ensureDemoUser(
  db: Database,
  credentials: { email: string; password: string; name?: string },
) {
  const email = credentials.email.trim().toLowerCase();
  const existing = await db.query.users.findFirst({
    where: (row, { eq: eqFn }) => eqFn(row.email, email),
  });
  if (existing) return existing;

  const passwordHash = await hashPassword(credentials.password);
  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name: credentials.name ?? 'Demo User',
    })
    .returning();
  if (!created) throw new Error('failed to create demo user');
  return created;
}

/**
 * Guarantee the demo account and its workspace exist. Used by the seed script and
 * by `POST /api/auth/demo`, so the one-click demo works even on a deployment that
 * runs with `SEED_DEMO=false`.
 */
export async function ensureDemoWorkspace(
  db: Database,
  credentials: { email: string; password: string; name?: string },
) {
  const user = await ensureDemoUser(db, credentials);

  const [project] = await db
    .select({ id: projects.id, ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.slug, DEMO_PROJECT_SLUG))
    .limit(1);

  // Backfill ownership for a demo project seeded before users existed.
  if (project && !project.ownerId) {
    await db
      .update(projects)
      .set({ ownerId: user.id })
      .where(eq(projects.id, project.id));
  }

  await seedDatabase(db, { force: false, ownerId: user.id });
  return { user };
}

function snapshot(row: {
  key: string;
  enabled: boolean;
  defaultValue: JsonValue;
  rulesJson: unknown;
  overridesJson: unknown;
  version: number;
}) {
  return {
    key: row.key,
    enabled: row.enabled,
    defaultValue: row.defaultValue,
    rules: row.rulesJson,
    overrides: row.overridesJson,
    version: row.version,
  };
}

async function main(): Promise<void> {
  const mode = (process.env.SEED_DEMO ?? '').toLowerCase();

  if (mode === 'false' || mode === 'off' || mode === 'skip') {
    console.log('⏭️  SEED_DEMO is disabled — skipping the demo seed');
    return;
  }

  // Manual runs (`pnpm db:seed`) reset by default; the container passes
  // `--if-missing` so a deploy only seeds a genuinely empty database.
  const ifMissing = process.argv.includes('--if-missing');
  const force =
    mode === 'force' || process.argv.includes('--force') || !ifMissing;

  const url =
    process.env.DATABASE_URL ??
    'postgres://flagforge:flagforge@localhost:5432/flagforge';
  const { db, pool } = createDatabase(url);
  try {
    const demoPassword = process.env.DEMO_PASSWORD ?? 'demo1234';
    const demoUser = await ensureDemoUser(db, {
      email: process.env.DEMO_EMAIL ?? 'demo@flagforge.dev',
      password: demoPassword,
    });

    const seeded = await seedDatabase(db, { force, ownerId: demoUser.id });
    if (seeded) {
      console.log(
        `✅ seeded demo project "${DEMO_PROJECT_SLUG}" (prod + dev, ${SEED_FLAGS.length} flags)`,
      );
      console.log(`   demo prod SDK key: ${DEMO_SDK_KEYS.prod}`);
      console.log(`   demo dev  SDK key: ${DEMO_SDK_KEYS.dev}`);
      console.log(`   demo login:        ${demoUser.email} / ${demoPassword}`);
    } else {
      console.log(
        `ℹ️  demo project "${DEMO_PROJECT_SLUG}" already exists — left untouched (use --force to reset)`,
      );
    }
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (invokedPath.endsWith('/src/db/seed.ts') || invokedPath.endsWith('/dist/db/seed.js')) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('❌ seed failed', err);
      process.exit(1);
    });
}
