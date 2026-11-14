CREATE TABLE `reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_person_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`day` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_once_idx` ON `reminder` (`group_id`,`from_person_id`,`to_member_id`,`day`);--> statement-breakpoint
CREATE INDEX `reminder_created_idx` ON `reminder` (`created_at`);