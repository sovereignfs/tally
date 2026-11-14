CREATE TABLE `applied_mutation` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`group_id` text NOT NULL,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `applied_mutation_created_idx` ON `applied_mutation` (`created_at`);--> statement-breakpoint
CREATE TABLE `expense` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`sealed` text NOT NULL,
	`method` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expense_group_seq_idx` ON `expense` (`group_id`,`seq`);--> statement-breakpoint
CREATE INDEX `expense_group_date_idx` ON `expense` (`group_id`,`date`);--> statement-breakpoint
CREATE TABLE `expense_payer` (
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`group_id` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `expense_share` (
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`group_id` text NOT NULL,
	`amount` integer NOT NULL,
	`units` integer,
	PRIMARY KEY(`expense_id`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_member_id` text NOT NULL,
	`to_member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`sealed` text,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` integer,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_group_seq_idx` ON `payment` (`group_id`,`seq`);--> statement-breakpoint
CREATE INDEX `payment_group_date_idx` ON `payment` (`group_id`,`date`);--> statement-breakpoint
CREATE TABLE `revision` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`subject` text NOT NULL,
	`subject_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`snapshot` text NOT NULL,
	`actor_person_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revision_subject_idx` ON `revision` (`subject_id`);