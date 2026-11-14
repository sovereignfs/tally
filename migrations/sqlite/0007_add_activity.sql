CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`actor_person_id` text,
	`kind` text NOT NULL,
	`subject_id` text,
	`details` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_group_time_idx` ON `activity` (`group_id`,`created_at`);