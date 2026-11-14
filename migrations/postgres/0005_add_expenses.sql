CREATE TABLE "tally"."applied_mutation" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"group_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "applied_mutation_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "tally"."expense" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"date" text NOT NULL,
	"category" text NOT NULL,
	"sealed" text NOT NULL,
	"method" text NOT NULL,
	"version" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally"."expense_payer" (
	"expense_id" text NOT NULL,
	"member_id" text NOT NULL,
	"group_id" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "expense_payer_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tally"."expense_share" (
	"expense_id" text NOT NULL,
	"member_id" text NOT NULL,
	"group_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"units" bigint,
	CONSTRAINT "expense_share_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "tally"."payment" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"from_member_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"date" text NOT NULL,
	"sealed" text,
	"version" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" bigint,
	"seq" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally"."revision" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"subject" text NOT NULL,
	"subject_id" text NOT NULL,
	"version" bigint NOT NULL,
	"kind" text NOT NULL,
	"snapshot" text NOT NULL,
	"actor_person_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "applied_mutation_created_idx" ON "tally"."applied_mutation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "expense_group_seq_idx" ON "tally"."expense" USING btree ("group_id","seq");--> statement-breakpoint
CREATE INDEX "expense_group_date_idx" ON "tally"."expense" USING btree ("group_id","date");--> statement-breakpoint
CREATE INDEX "payment_group_seq_idx" ON "tally"."payment" USING btree ("group_id","seq");--> statement-breakpoint
CREATE INDEX "payment_group_date_idx" ON "tally"."payment" USING btree ("group_id","date");--> statement-breakpoint
CREATE INDEX "revision_subject_idx" ON "tally"."revision" USING btree ("subject_id");