CREATE TABLE "tally"."account_settings" (
	"account_id" text PRIMARY KEY NOT NULL,
	"primary_currency" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
