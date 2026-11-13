CREATE TABLE "tally"."person" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"core_sub" text,
	"name" text NOT NULL,
	"email" text,
	"added_by" text,
	"claimed_at" bigint,
	"deleted_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_account_idx" ON "tally"."person" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_core_sub_idx" ON "tally"."person" USING btree ("core_sub");--> statement-breakpoint
CREATE INDEX "person_added_by_idx" ON "tally"."person" USING btree ("added_by");