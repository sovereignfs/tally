CREATE TABLE "tally"."mail_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"to_address" text,
	"template" text NOT NULL,
	"data" text NOT NULL,
	"attempts" bigint NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	"sent_at" bigint,
	"failure_kind" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "tally"."mail_outbox" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_account_idx" ON "tally"."mail_outbox" USING btree ("account_id");