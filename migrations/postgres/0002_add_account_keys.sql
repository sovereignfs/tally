CREATE TABLE "tally"."account_key" (
	"account_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"version" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally"."account_key_wrap" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"version" bigint NOT NULL,
	"method" text NOT NULL,
	"credential_id" text,
	"params" text,
	"wrapped" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tally"."key_request" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"public_key" text NOT NULL,
	"label" text NOT NULL,
	"wrapped" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_key_wrap_account_idx" ON "tally"."account_key_wrap" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "key_request_account_idx" ON "tally"."key_request" USING btree ("account_id");