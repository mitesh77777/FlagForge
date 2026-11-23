ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "sdk_key_prev_hash" text;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "sdk_key_prev_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_sdk_key_prev_hash_idx" ON "environments" USING btree ("sdk_key_prev_hash");
