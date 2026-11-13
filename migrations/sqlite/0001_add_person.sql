CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`core_sub` text,
	`name` text NOT NULL,
	`email` text,
	`added_by` text,
	`claimed_at` integer,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_account_idx` ON `person` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `person_core_sub_idx` ON `person` (`core_sub`);--> statement-breakpoint
CREATE INDEX `person_added_by_idx` ON `person` (`added_by`);