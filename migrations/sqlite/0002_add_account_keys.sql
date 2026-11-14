CREATE TABLE `account_key` (
	`account_id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account_key_wrap` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`version` integer NOT NULL,
	`method` text NOT NULL,
	`credential_id` text,
	`params` text,
	`wrapped` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_key_wrap_account_idx` ON `account_key_wrap` (`account_id`);--> statement-breakpoint
CREATE TABLE `key_request` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`public_key` text NOT NULL,
	`label` text NOT NULL,
	`wrapped` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `key_request_account_idx` ON `key_request` (`account_id`);