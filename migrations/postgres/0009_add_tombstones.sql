CREATE TABLE "tally"."tombstone" (
	"row_table" text NOT NULL,
	"id" text NOT NULL,
	"group_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "tombstone_row_table_id_pk" PRIMARY KEY("row_table","id")
);
--> statement-breakpoint
ALTER TABLE "tally"."grp" ADD COLUMN "pruned_through" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "tombstone_group_seq_idx" ON "tally"."tombstone" USING btree ("group_id","seq");--> statement-breakpoint
CREATE INDEX "tombstone_created_idx" ON "tally"."tombstone" USING btree ("created_at");