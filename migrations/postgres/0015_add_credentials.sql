CREATE TABLE "tally"."credential" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"purpose" text NOT NULL,
	"sealed" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"locked_until" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_account_purpose_idx" ON "tally"."credential" USING btree ("account_id","purpose");--> statement-breakpoint
CREATE INDEX "credential_key_idx" ON "tally"."credential" USING btree ("key_fingerprint");