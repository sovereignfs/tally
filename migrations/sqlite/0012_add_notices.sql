CREATE TABLE `notice` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`group_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`kind` text NOT NULL,
	`read_at` integer,
	`dismissed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notice_account_time_idx` ON `notice` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notice_group_idx` ON `notice` (`group_id`);--> statement-breakpoint
ALTER TABLE `account_settings` ADD `inbox_seen_at` integer;