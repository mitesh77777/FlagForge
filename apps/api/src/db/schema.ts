import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FlagOverrides, JsonValue, TargetingRule } from '@flagforge/evaluator';

/**
 * ── users ─────────────────────────────────────────────────────────────────────
 * Account records for the control plane. Passwords are stored as scrypt hashes
 * (see `lib/password.ts`); the raw password is never persisted or logged.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_key').on(t.email),
  }),
);

/**
 * ── projects ──────────────────────────────────────────────────────────────────
 * Top-level tenant boundary. `owner_id` scopes every control-plane query to a
 * single account; a project with a null owner is an orphan and is invisible.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index('projects_owner_id_idx').on(t.ownerId),
  }),
);

/**
 * ── environments ──────────────────────────────────────────────────────────────
 * A project contains N environments (dev / staging / prod). Each environment has
 * its own SDK key. Only the SHA-256 **hash** is stored; the raw key is shown once.
 */
export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 hex of the raw SDK key. Used for O(1) auth lookup. */
    sdkKeyHash: text('sdk_key_hash').notNull(),
    /**
     * The outgoing key, retained for a bounded grace window so a rotation does
     * not break clients that have not yet picked up the new key. Cleared by the
     * next rotation, and ignored once `sdkKeyPrevExpiresAt` has passed.
     */
    sdkKeyPrevHash: text('sdk_key_prev_hash'),
    /** When the outgoing key stops authenticating. `null` = never expires. */
    sdkKeyPrevExpiresAt: timestamp('sdk_key_prev_expires_at', {
      withTimezone: true,
    }),
    /** Non-secret display prefix, e.g. `ff_live_demo`. */
    sdkKeyPrefix: text('sdk_key_prefix').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    projectNameUnique: uniqueIndex('environments_project_id_name_key').on(
      t.projectId,
      t.name,
    ),
    sdkKeyHashIdx: index('environments_sdk_key_hash_idx').on(t.sdkKeyHash),
    sdkKeyPrevHashIdx: index('environments_sdk_key_prev_hash_idx').on(
      t.sdkKeyPrevHash,
    ),
  }),
);

/**
 * ── flags ─────────────────────────────────────────────────────────────────────
 * The unit of configuration. `rules_json` / `overrides_json` hold the evaluator
 * AST. `version` increments on every control-plane mutation and drives cache
 * invalidation and SSE change detection. `enabled` is the global kill switch.
 */
export const flags = pgTable(
  'flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    enabled: boolean('enabled').notNull().default(false),
    defaultValue: jsonb('default_value')
      .$type<JsonValue>()
      .notNull()
      .default(sql`'false'::jsonb`),
    rulesJson: jsonb('rules_json')
      .$type<TargetingRule[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    overridesJson: jsonb('overrides_json')
      .$type<FlagOverrides>()
      .notNull()
      .default(sql`'{"allowlist":[],"blocklist":[]}'::jsonb`),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    envKeyUnique: uniqueIndex('flags_environment_id_key_key').on(
      t.environmentId,
      t.key,
    ),
  }),
);

/**
 * ── audit_logs ────────────────────────────────────────────────────────────────
 * Immutable, append-only history. Written *inside* the same transaction as the
 * flag mutation so the record can never drift from the change it describes.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    flagKey: text('flag_key').notNull(),
    actorEmail: text('actor_email').notNull(),
    /** e.g. `flag.created`, `flag.updated`, `flag.toggled`. */
    action: text('action').notNull(),
    beforeJson: jsonb('before_json').$type<JsonValue>(),
    afterJson: jsonb('after_json').$type<JsonValue>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    envCreatedIdx: index('audit_logs_environment_id_created_at_idx').on(
      t.environmentId,
      t.createdAt,
    ),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;
export type Flag = typeof flags.$inferSelect;
export type NewFlag = typeof flags.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
