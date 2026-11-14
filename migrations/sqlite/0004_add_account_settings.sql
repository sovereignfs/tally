CREATE TABLE `account_settings` (
	`account_id` text PRIMARY KEY NOT NULL,
	`primary_currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
