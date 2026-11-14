CREATE TABLE "tally"."activity" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"actor_person_id" text,
	"kind" text NOT NULL,
	"subject_id" text,
	"details" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_group_time_idx" ON "tally"."activity" USING btree ("group_id","created_at");