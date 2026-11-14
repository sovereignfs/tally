CREATE TABLE `tombstone` (
	`row_table` text NOT NULL,
	`id` text NOT NULL,
	`group_id` text NOT NULL,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`row_table`, `id`)
);
--> statement-breakpoint
CREATE INDEX `tombstone_group_seq_idx` ON `tombstone` (`group_id`,`seq`);--> statement-breakpoint
CREATE INDEX `tombstone_created_idx` ON `tombstone` (`created_at`);--> statement-breakpoint
ALTER TABLE `grp` ADD `pruned_through` integer DEFAULT 0 NOT NULL;