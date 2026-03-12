CREATE TABLE "ai_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" integer,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text DEFAULT 'gpt-4o' NOT NULL,
	"api_key" text NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"cluster_id" integer,
	"description" text,
	"details" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_enabled" boolean DEFAULT false,
	"default_provider" text DEFAULT 'local',
	"session_timeout" integer DEFAULT 86400,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cluster_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"notification_id" integer NOT NULL,
	"enabled" boolean DEFAULT true,
	"event_types" text,
	"notif_config" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "cluster_notifications_cluster_id_notification_id_unique" UNIQUE("cluster_id","notification_id")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'globe',
	"labels" text,
	"api_server" text,
	"auth_type" text DEFAULT 'kubeconfig',
	"kubeconfig" text,
	"context" text,
	"namespace" text DEFAULT 'default',
	"bearer_token" text,
	"tls_ca" text,
	"tls_skip_verify" boolean DEFAULT false,
	"agent_url" text,
	"agent_token" text,
	"metrics_enabled" boolean DEFAULT true,
	"cpu_warn_threshold" integer DEFAULT 60,
	"cpu_crit_threshold" integer DEFAULT 80,
	"mem_warn_threshold" integer DEFAULT 60,
	"mem_crit_threshold" integer DEFAULT 80,
	"is_provisioned" boolean DEFAULT false,
	"provisioned_cluster_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "clusters_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "host_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer,
	"cpu_percent" real NOT NULL,
	"memory_percent" real NOT NULL,
	"memory_used" integer,
	"memory_total" integer,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ldap_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false,
	"server_url" text NOT NULL,
	"bind_dn" text,
	"bind_password" text,
	"base_dn" text NOT NULL,
	"user_filter" text DEFAULT '(uid={{username}})',
	"username_attribute" text DEFAULT 'uid',
	"email_attribute" text DEFAULT 'mail',
	"display_name_attribute" text DEFAULT 'cn',
	"group_base_dn" text,
	"group_filter" text,
	"admin_group" text,
	"role_mappings" text,
	"tls_enabled" boolean DEFAULT false,
	"tls_ca" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"config" text NOT NULL,
	"event_types" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oidc_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false,
	"issuer_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scopes" text DEFAULT 'openid profile email',
	"username_claim" text DEFAULT 'preferred_username',
	"email_claim" text DEFAULT 'email',
	"display_name_claim" text DEFAULT 'name',
	"admin_claim" text,
	"admin_value" text,
	"role_mappings_claim" text DEFAULT 'groups',
	"role_mappings" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provisioned_cluster_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provisioned_cluster_id" integer NOT NULL,
	"message" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provisioned_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_name" text NOT NULL,
	"provider" text NOT NULL,
	"k3s_version" text DEFAULT 'v1.32.0+k3s1' NOT NULL,
	"kubeconfig_path" text,
	"protect_against_deletion" boolean DEFAULT true,
	"create_load_balancer" boolean DEFAULT true,
	"api_server_hostname" text,
	"provider_token" text,
	"networking_config" text,
	"masters_pool_config" text,
	"worker_pools_config" text,
	"addons_config" text,
	"datastore_config" text,
	"status" text DEFAULT 'pending',
	"status_message" text,
	"last_provisioned" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "provisioned_clusters_cluster_name_unique" UNIQUE("cluster_name")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false,
	"permissions" text NOT NULL,
	"cluster_ids" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"key_type" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"cluster_id" integer,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_preferences_user_id_cluster_id_key_unique" UNIQUE("user_id","cluster_id","key")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"cluster_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_roles_user_id_role_id_cluster_id_unique" UNIQUE("user_id","role_id","cluster_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"display_name" text,
	"avatar" text,
	"auth_provider" text DEFAULT 'local',
	"mfa_enabled" boolean DEFAULT false,
	"mfa_secret" text,
	"is_active" boolean DEFAULT true,
	"last_login" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_session_id_ai_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_notifications" ADD CONSTRAINT "cluster_notifications_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_notifications" ADD CONSTRAINT "cluster_notifications_notification_id_notification_settings_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_provisioned_cluster_id_provisioned_clusters_id_fk" FOREIGN KEY ("provisioned_cluster_id") REFERENCES "public"."provisioned_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_metrics" ADD CONSTRAINT "host_metrics_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_cluster_logs" ADD CONSTRAINT "provisioned_cluster_logs_provisioned_cluster_id_provisioned_clusters_id_fk" FOREIGN KEY ("provisioned_cluster_id") REFERENCES "public"."provisioned_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_chat_messages_session_idx" ON "ai_chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "host_metrics_cluster_timestamp_idx" ON "host_metrics" USING btree ("cluster_id","timestamp");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");