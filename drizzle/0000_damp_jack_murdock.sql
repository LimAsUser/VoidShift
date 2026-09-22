CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`offer_sdp` text NOT NULL,
	`answer_sdp` text,
	`claimed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
