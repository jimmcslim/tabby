-- Baseline migration: the schema as the old startup bootstrap left it.
-- Every CREATE is IF NOT EXISTS so this applies as a no-op to a database
-- created by that bootstrap (which has the full schema but no
-- __drizzle_migrations table). Later migrations are plain generated SQL.
CREATE TABLE IF NOT EXISTS `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`icon` text,
	`is_smart` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`domain` text,
	`favicon_url` text,
	`category` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_session_tabs_session_id` ON `session_tabs` (`session_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_auto` integer DEFAULT false NOT NULL,
	`is_previous` integer DEFAULT false NOT NULL,
	`tab_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`chrome_id` text,
	`url` text NOT NULL,
	`title` text,
	`domain` text,
	`favicon_url` text,
	`status` text DEFAULT 'open' NOT NULL,
	`type` text DEFAULT 'page' NOT NULL,
	`category` text,
	`summary` text,
	`og_image` text,
	`description` text,
	`window_id` integer,
	`tab_index` integer,
	`last_accessed_at` text,
	`suspended_state` text,
	`is_article` integer,
	`is_pinned` integer DEFAULT false NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tabs_status` ON `tabs` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tabs_chrome_id` ON `tabs` (`chrome_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tabs_domain` ON `tabs` (`domain`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tabs_category` ON `tabs` (`category`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tabs_to_groups` (
	`tab_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`tab_id`, `group_id`),
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
