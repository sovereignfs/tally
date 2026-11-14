CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`person_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`key_wrap` text,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`sent_at` integer,
	`accepted_by` text,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_idx` ON `invitation` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitation_person_idx` ON `invitation` (`person_id`);--> statement-breakpoint
CREATE INDEX `invitation_group_idx` ON `invitation` (`group_id`);