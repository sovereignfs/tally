CREATE TABLE "tally"."notice" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"group_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"kind" text NOT NULL,
	"read_at" bigint,
	"dismissed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tally"."account_settings" ADD COLUMN "inbox_seen_at" bigint;--> statement-breakpoint
CREATE INDEX "notice_account_time_idx" ON "tally"."notice" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "notice_group_idx" ON "tally"."notice" USING btree ("group_id");