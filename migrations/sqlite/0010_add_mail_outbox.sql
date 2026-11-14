CREATE TABLE `mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`to_address` text,
	`template` text NOT NULL,
	`data` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`sent_at` integer,
	`failure_kind` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_due_idx` ON `mail_outbox` (`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `mail_outbox_account_idx` ON `mail_outbox` (`account_id`);