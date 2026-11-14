CREATE TABLE "tally"."comment" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"subject" text NOT NULL,
	"subject_id" text NOT NULL,
	"author_person_id" text NOT NULL,
	"sealed" text NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comment_subject_idx" ON "tally"."comment" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "comment_group_seq_idx" ON "tally"."comment" USING btree ("group_id","seq");