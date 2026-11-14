CREATE TABLE "tally"."invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"person_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"key_wrap" text,
	"created_by" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"sent_at" bigint,
	"accepted_by" text,
	"accepted_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_idx" ON "tally"."invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_person_idx" ON "tally"."invitation" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "invitation_group_idx" ON "tally"."invitation" USING btree ("group_id");