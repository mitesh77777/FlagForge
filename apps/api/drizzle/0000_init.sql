CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sdk_key_hash" text NOT NULL,
	"sdk_key_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"default_value" jsonb DEFAULT 'false'::jsonb NOT NULL,
	"rules_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overrides_json" jsonb DEFAULT '{"allowlist":[],"blocklist":[]}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"flag_key" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flags" ADD CONSTRAINT "flags_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_project_id_name_key" ON "environments" USING btree ("project_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_sdk_key_hash_idx" ON "environments" USING btree ("sdk_key_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "flags_environment_id_key_key" ON "flags" USING btree ("environment_id","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_environment_id_created_at_idx" ON "audit_logs" USING btree ("environment_id","created_at");
