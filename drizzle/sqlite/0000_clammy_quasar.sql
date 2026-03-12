CREATE TABLE `ai_chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`session_id`) REFERENCES `ai_chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_chat_messages_session_idx` ON `ai_chat_messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `ai_chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_id` integer,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text DEFAULT 'gpt-4o' NOT NULL,
	`api_key` text NOT NULL,
	`base_url` text,
	`enabled` integer DEFAULT true,
	`is_default` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`username` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`entity_name` text,
	`cluster_id` integer,
	`description` text,
	`details` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_user_id_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`auth_enabled` integer DEFAULT false,
	`default_provider` text DEFAULT 'local',
	`session_timeout` integer DEFAULT 86400,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `cluster_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer NOT NULL,
	`notification_id` integer NOT NULL,
	`enabled` integer DEFAULT true,
	`event_types` text,
	`notif_config` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notification_id`) REFERENCES `notification_settings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cluster_notifications_cluster_id_notification_id_unique` ON `cluster_notifications` (`cluster_id`,`notification_id`);--> statement-breakpoint
CREATE TABLE `clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'globe',
	`labels` text,
	`api_server` text,
	`auth_type` text DEFAULT 'kubeconfig',
	`kubeconfig` text,
	`context` text,
	`namespace` text DEFAULT 'default',
	`bearer_token` text,
	`tls_ca` text,
	`tls_skip_verify` integer DEFAULT false,
	`agent_url` text,
	`agent_token` text,
	`metrics_enabled` integer DEFAULT true,
	`cpu_warn_threshold` integer DEFAULT 60,
	`cpu_crit_threshold` integer DEFAULT 80,
	`mem_warn_threshold` integer DEFAULT 60,
	`mem_crit_threshold` integer DEFAULT 80,
	`is_provisioned` integer DEFAULT false,
	`provisioned_cluster_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`provisioned_cluster_id`) REFERENCES `provisioned_clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `clusters_name_unique` ON `clusters` (`name`);--> statement-breakpoint
CREATE TABLE `host_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_id` integer,
	`cpu_percent` real NOT NULL,
	`memory_percent` real NOT NULL,
	`memory_used` integer,
	`memory_total` integer,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `host_metrics_cluster_timestamp_idx` ON `host_metrics` (`cluster_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `ldap_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false,
	`server_url` text NOT NULL,
	`bind_dn` text,
	`bind_password` text,
	`base_dn` text NOT NULL,
	`user_filter` text DEFAULT '(uid={{username}})',
	`username_attribute` text DEFAULT 'uid',
	`email_attribute` text DEFAULT 'mail',
	`display_name_attribute` text DEFAULT 'cn',
	`group_base_dn` text,
	`group_filter` text,
	`admin_group` text,
	`role_mappings` text,
	`tls_enabled` integer DEFAULT false,
	`tls_ca` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true,
	`config` text NOT NULL,
	`event_types` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `oidc_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false,
	`issuer_url` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scopes` text DEFAULT 'openid profile email',
	`username_claim` text DEFAULT 'preferred_username',
	`email_claim` text DEFAULT 'email',
	`display_name_claim` text DEFAULT 'name',
	`admin_claim` text,
	`admin_value` text,
	`role_mappings_claim` text DEFAULT 'groups',
	`role_mappings` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `provisioned_cluster_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provisioned_cluster_id` integer NOT NULL,
	`message` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`provisioned_cluster_id`) REFERENCES `provisioned_clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provisioned_clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cluster_name` text NOT NULL,
	`provider` text NOT NULL,
	`k3s_version` text DEFAULT 'v1.32.0+k3s1' NOT NULL,
	`kubeconfig_path` text,
	`protect_against_deletion` integer DEFAULT true,
	`create_load_balancer` integer DEFAULT true,
	`api_server_hostname` text,
	`provider_token` text,
	`networking_config` text,
	`masters_pool_config` text,
	`worker_pools_config` text,
	`addons_config` text,
	`datastore_config` text,
	`status` text DEFAULT 'pending',
	`status_message` text,
	`last_provisioned` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `provisioned_clusters_cluster_name_unique` ON `provisioned_clusters` (`cluster_name`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false,
	`permissions` text NOT NULL,
	`cluster_ids` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`key_type` text NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`cluster_id` integer,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_preferences_user_id_cluster_id_key_unique` ON `user_preferences` (`user_id`,`cluster_id`,`key`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	`cluster_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_roles_user_id_role_id_cluster_id_unique` ON `user_roles` (`user_id`,`role_id`,`cluster_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`password_hash` text NOT NULL,
	`display_name` text,
	`avatar` text,
	`auth_provider` text DEFAULT 'local',
	`mfa_enabled` integer DEFAULT false,
	`mfa_secret` text,
	`is_active` integer DEFAULT true,
	`last_login` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);