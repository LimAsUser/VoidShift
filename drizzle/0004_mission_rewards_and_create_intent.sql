CREATE TABLE `mission_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`claim_token_hash` text NOT NULL,
	`outcome` text,
	`hunter` integer DEFAULT 0 NOT NULL,
	`monster` integer DEFAULT 0 NOT NULL,
	`heavy` integer DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_receipts_player_unique` ON `mission_receipts` (`mission_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `mission_receipts_expiry_idx` ON `mission_receipts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`difficulty` text NOT NULL,
	`report_token_hash` text NOT NULL,
	`registration_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `missions_expiry_idx` ON `missions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `create_intent_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_create_intent_unique` ON `rooms` (`create_intent_hash`);