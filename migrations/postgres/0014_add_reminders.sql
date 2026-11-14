CREATE TABLE "tally"."reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"from_person_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"day" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_once_idx" ON "tally"."reminder" USING btree ("group_id","from_person_id","to_member_id","day");--> statement-breakpoint
CREATE INDEX "reminder_created_idx" ON "tally"."reminder" USING btree ("created_at");