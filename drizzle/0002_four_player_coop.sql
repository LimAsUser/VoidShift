CREATE TABLE `room_members` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`slot` integer NOT NULL,
	`token_hash` text NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`offer_sdp` text,
	`answer_sdp` text,
	`offline_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_members_room_slot_unique` ON `room_members` (`room_code`,`slot`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `protocol_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `status` text DEFAULT 'lobby' NOT NULL;