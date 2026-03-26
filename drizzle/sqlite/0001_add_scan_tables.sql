ALTER TABLE `clusters` ADD `scan_enabled` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `clusters` ADD `scanner_preference` text DEFAULT 'both';--> statement-breakpoint
CREATE TABLE `image_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer REFERENCES clusters(`id`) ON DELETE cascade,
	`image` text NOT NULL,
	`tag` text,
	`digest` text,
	`status` text NOT NULL DEFAULT 'pending',
	`trigger` text NOT NULL DEFAULT 'manual',
	`resource` text,
	`resource_namespace` text,
	`scanner` text DEFAULT 'trivy',
	`summary` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `image_scans_cluster_idx` ON `image_scans` (`cluster_id`);--> statement-breakpoint
CREATE INDEX `image_scans_image_idx` ON `image_scans` (`image`);--> statement-breakpoint
CREATE INDEX `image_scans_status_idx` ON `image_scans` (`status`);--> statement-breakpoint
CREATE TABLE `image_scan_vulnerabilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL REFERENCES image_scans(`id`) ON DELETE cascade,
	`vulnerability_id` text NOT NULL,
	`pkg_name` text NOT NULL,
	`installed_version` text,
	`fixed_version` text,
	`severity` text NOT NULL,
	`title` text,
	`description` text,
	`primary_url` text,
	`score` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `image_scan_vulns_scan_idx` ON `image_scan_vulnerabilities` (`scan_id`);--> statement-breakpoint
CREATE INDEX `image_scan_vulns_severity_idx` ON `image_scan_vulnerabilities` (`severity`);--> statement-breakpoint
CREATE TABLE `scan_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer REFERENCES clusters(`id`) ON DELETE cascade,
	`enabled` integer DEFAULT true,
	`cron_expression` text NOT NULL DEFAULT '0 2 * * *',
	`namespaces` text,
	`last_run_at` text,
	`next_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
