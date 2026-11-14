CREATE TABLE "tally"."grp" (
	"id" text PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"color" text NOT NULL,
	"default_currency" text NOT NULL,
	"simplify_debts" boolean NOT NULL,
	"closed_at" bigint,
	"key_epoch" bigint NOT NULL,
	"seq" bigint NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally"."key_wrap" (
	"group_id" text NOT NULL,
	"epoch" bigint NOT NULL,
	"account_id" text NOT NULL,
	"wrapped" text NOT NULL,
	"wrapped_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "key_wrap_group_id_epoch_account_id_pk" PRIMARY KEY("group_id","epoch","account_id")
);
--> statement-breakpoint
CREATE TABLE "tally"."member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"person_id" text NOT NULL,
	"role" text,
	"notify" text NOT NULL,
	"added_by" text,
	"joined_at" bigint NOT NULL,
	"left_at" bigint,
	"seq" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "key_wrap_account_idx" ON "tally"."key_wrap" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "member_person_idx" ON "tally"."member" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "member_group_idx" ON "tally"."member" USING btree ("group_id");