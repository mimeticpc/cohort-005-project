CREATE TABLE `refunds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refund_request_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`refund_request_id`) REFERENCES `refund_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_refund_request_unique` ON `refunds` (`refund_request_id`);--> statement-breakpoint
ALTER TABLE `enrollments` ADD `ended_at` text;--> statement-breakpoint
ALTER TABLE `refund_requests` DROP COLUMN `amount_refunded`;