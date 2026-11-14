CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`subject` text NOT NULL,
	`subject_id` text NOT NULL,
	`author_person_id` text NOT NULL,
	`sealed` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `comment_subject_idx` ON `comment` (`subject_id`);--> statement-breakpoint
CREATE INDEX `comment_group_seq_idx` ON `comment` (`group_id`,`seq`);