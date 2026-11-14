CREATE TABLE `grp` (
	`id` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`color` text NOT NULL,
	`default_currency` text NOT NULL,
	`simplify_debts` integer NOT NULL,
	`closed_at` integer,
	`key_epoch` integer NOT NULL,
	`seq` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `key_wrap` (
	`group_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`account_id` text NOT NULL,
	`wrapped` text NOT NULL,
	`wrapped_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `epoch`, `account_id`)
);
--> statement-breakpoint
CREATE INDEX `key_wrap_account_idx` ON `key_wrap` (`account_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text,
	`notify` text NOT NULL,
	`added_by` text,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_person_idx` ON `member` (`person_id`);--> statement-breakpoint
CREATE INDEX `member_group_idx` ON `member` (`group_id`);