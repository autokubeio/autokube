import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// ─── Column Helpers ──────────────────────────────────────────────────────────

const id = integer('id').primaryKey({ autoIncrement: true });
const bool = (name: string) => integer(name, { mode: 'boolean' });
const createdAt = text('created_at').default(sql`CURRENT_TIMESTAMP`);
const updatedAt = text('updated_at').default(sql`CURRENT_TIMESTAMP`);
const timestamps = { createdAt, updatedAt };

// ─── Clusters ────────────────────────────────────────────────────────────────

export const clusters = sqliteTable('clusters', {
	id,
	name: text('name').notNull().unique(),
	icon: text('icon').default('globe'),
	labels: text('labels'), // JSON string[]
	// Connection
	apiServer: text('api_server'),
	authType: text('auth_type').default('kubeconfig'), // kubeconfig | bearer-token | agent
	kubeconfig: text('kubeconfig'),
	context: text('context'),
	namespace: text('namespace').default('default'),
	bearerToken: text('bearer_token'),
	tlsCa: text('tls_ca'),
	tlsSkipVerify: bool('tls_skip_verify').default(false),
	// Agent mode fields
	agentUrl: text('agent_url'),
	agentToken: text('agent_token'),
	// Metrics
	metricsEnabled: bool('metrics_enabled').default(true),
	// Metric thresholds
	cpuWarnThreshold: integer('cpu_warn_threshold').default(60),
	cpuCritThreshold: integer('cpu_crit_threshold').default(80),
	memWarnThreshold: integer('mem_warn_threshold').default(60),
	memCritThreshold: integer('mem_crit_threshold').default(80),
	// Vulnerability scanning
	scanEnabled: bool('scan_enabled').default(false),
	scannerPreference: text('scanner_preference').default('both'), // grype | trivy | both
	// Provisioning link
	isProvisioned: bool('is_provisioned').default(false),
	provisionedClusterId: integer('provisioned_cluster_id').references(() => provisionedClusters.id, {
		onDelete: 'set null'
	}),
	...timestamps
});

// ─── Provisioned Clusters (Cloud K3s) ────────────────────────────────────────

export const provisionedClusters = sqliteTable('provisioned_clusters', {
	id,
	clusterName: text('cluster_name').notNull().unique(),
	provider: text('provider').notNull(), // hetzner | aws | gcp | …
	k3sVersion: text('k3s_version').notNull().default('v1.32.0+k3s1'),
	kubeconfigPath: text('kubeconfig_path'),
	protectAgainstDeletion: bool('protect_against_deletion').default(true),
	createLoadBalancer: bool('create_load_balancer').default(true),
	apiServerHostname: text('api_server_hostname'),
	providerToken: text('provider_token'), // encrypted
	// JSON config blobs
	networkingConfig: text('networking_config'),
	mastersPoolConfig: text('masters_pool_config'),
	workerPoolsConfig: text('worker_pools_config'),
	addonsConfig: text('addons_config'),
	datastoreConfig: text('datastore_config'),
	// Status
	status: text('status').default('pending'), // pending | provisioning | running | error | deleting
	statusMessage: text('status_message'),
	lastProvisioned: text('last_provisioned'),
	...timestamps
});

export const provisionedClusterLogs = sqliteTable('provisioned_cluster_logs', {
	id,
	provisionedClusterId: integer('provisioned_cluster_id')
		.notNull()
		.references(() => provisionedClusters.id, { onDelete: 'cascade' }),
	message: text('message').notNull(),
	level: text('level').notNull().default('info'), // info | success | warning | error | k3s
	createdAt
});

// ─── Settings & Notifications ────────────────────────────────────────────────

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt
});

export const notificationSettings = sqliteTable('notification_settings', {
	id,
	type: text('type').notNull(),
	name: text('name').notNull(),
	enabled: bool('enabled').default(true),
	config: text('config').notNull(),
	eventTypes: text('event_types'),
	...timestamps
});

export const clusterNotifications = sqliteTable(
	'cluster_notifications',
	{
		id,
		clusterId: integer('cluster_id')
			.notNull()
			.references(() => clusters.id, { onDelete: 'cascade' }),
		notificationId: integer('notification_id')
			.notNull()
			.references(() => notificationSettings.id, { onDelete: 'cascade' }),
		enabled: bool('enabled').default(true),
		eventTypes: text('event_types'),
		notifConfig: text('notif_config'),
		...timestamps
	},
	(t) => ({
		clusterNotifUnique: unique().on(t.clusterId, t.notificationId)
	})
);

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authSettings = sqliteTable('auth_settings', {
	id,
	authEnabled: bool('auth_enabled').default(false),
	defaultProvider: text('default_provider').default('local'),
	sessionTimeout: integer('session_timeout').default(86400),
	...timestamps
});

export const users = sqliteTable('users', {
	id,
	username: text('username').notNull().unique(),
	email: text('email'),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name'),
	avatar: text('avatar'),
	authProvider: text('auth_provider').default('local'),
	mfaEnabled: bool('mfa_enabled').default(false),
	mfaSecret: text('mfa_secret'), // JSON { secret, backupCodes[] }
	isActive: bool('is_active').default(true),
	lastLogin: text('last_login'),
	...timestamps
});

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		expiresAt: text('expires_at').notNull(),
		createdAt
	},
	(t) => ({
		userIdIdx: index('sessions_user_id_idx').on(t.userId),
		expiresAtIdx: index('sessions_expires_at_idx').on(t.expiresAt)
	})
);

export const ldapConfig = sqliteTable('ldap_config', {
	id,
	name: text('name').notNull(),
	enabled: bool('enabled').default(false),
	serverUrl: text('server_url').notNull(),
	bindDn: text('bind_dn'),
	bindPassword: text('bind_password'),
	baseDn: text('base_dn').notNull(),
	userFilter: text('user_filter').default('(uid={{username}})'),
	usernameAttribute: text('username_attribute').default('uid'),
	emailAttribute: text('email_attribute').default('mail'),
	displayNameAttribute: text('display_name_attribute').default('cn'),
	groupBaseDn: text('group_base_dn'),
	groupFilter: text('group_filter'),
	adminGroup: text('admin_group'),
	roleMappings: text('role_mappings'), // JSON { groupDn, roleId }[]
	tlsEnabled: bool('tls_enabled').default(false),
	tlsCa: text('tls_ca'),
	...timestamps
});

export const oidcConfig = sqliteTable('oidc_config', {
	id,
	name: text('name').notNull(),
	enabled: bool('enabled').default(false),
	issuerUrl: text('issuer_url').notNull(),
	clientId: text('client_id').notNull(),
	clientSecret: text('client_secret').notNull(),
	redirectUri: text('redirect_uri').notNull(),
	scopes: text('scopes').default('openid profile email'),
	usernameClaim: text('username_claim').default('preferred_username'),
	emailClaim: text('email_claim').default('email'),
	displayNameClaim: text('display_name_claim').default('name'),
	adminClaim: text('admin_claim'),
	adminValue: text('admin_value'),
	roleMappingsClaim: text('role_mappings_claim').default('groups'),
	roleMappings: text('role_mappings'),
	...timestamps
});

// ─── RBAC ────────────────────────────────────────────────────────────────────

export const roles = sqliteTable('roles', {
	id,
	name: text('name').notNull().unique(),
	description: text('description'),
	isSystem: bool('is_system').default(false),
	permissions: text('permissions').notNull(),
	clusterIds: text('cluster_ids'),
	...timestamps
});

export const userRoles = sqliteTable(
	'user_roles',
	{
		id,
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		roleId: integer('role_id')
			.notNull()
			.references(() => roles.id, { onDelete: 'cascade' }),
		clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'cascade' }),
		createdAt
	},
	(t) => ({
		userRoleClusterUnique: unique().on(t.userId, t.roleId, t.clusterId)
	})
);

// ─── Observability ───────────────────────────────────────────────────────────

export const hostMetrics = sqliteTable(
	'host_metrics',
	{
		id,
		clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'cascade' }),
		cpuPercent: real('cpu_percent').notNull(),
		memoryPercent: real('memory_percent').notNull(),
		memoryUsed: integer('memory_used'),
		memoryTotal: integer('memory_total'),
		timestamp: text('timestamp').default(sql`CURRENT_TIMESTAMP`)
	},
	(t) => ({
		clusterTimestampIdx: index('host_metrics_cluster_timestamp_idx').on(t.clusterId, t.timestamp)
	})
);

export const auditLogs = sqliteTable(
	'audit_logs',
	{
		id,
		userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
		username: text('username').notNull(),
		action: text('action').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id'),
		entityName: text('entity_name'),
		clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'set null' }),
		description: text('description'),
		details: text('details'),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt
	},
	(t) => ({
		userIdIdx: index('audit_logs_user_id_idx').on(t.userId),
		createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt)
	})
);

// ─── User Preferences & SSH Keys ────────────────────────────────────────────

export const userPreferences = sqliteTable(
	'user_preferences',
	{
		id,
		userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
		clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull(), // JSON
		...timestamps
	},
	(t) => [unique().on(t.userId, t.clusterId, t.key)]
);

export const sshKeys = sqliteTable('ssh_keys', {
	id,
	name: text('name').notNull(),
	description: text('description'),
	keyType: text('key_type').notNull(), // ed25519 | rsa
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(), // encrypted
	fingerprint: text('fingerprint').notNull(),
	...timestamps
});

// ─── AI Providers ────────────────────────────────────────────────────────────

export const aiProviders = sqliteTable('ai_providers', {
	id,
	name: text('name').notNull(),
	provider: text('provider').notNull(), // openai | anthropic | openrouter | custom
	model: text('model').notNull().default('gpt-4o'),
	apiKey: text('api_key').notNull(), // AES-256-GCM encrypted
	baseUrl: text('base_url'), // override endpoint (openrouter / custom / local)
	enabled: bool('enabled').default(true),
	isDefault: bool('is_default').default(false),
	...timestamps
});

// ─── AI Chat ─────────────────────────────────────────────────────────────────

export const aiChatSessions = sqliteTable('ai_chat_sessions', {
	id: text('id').primaryKey(), // crypto.randomUUID()
	clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'cascade' }),
	title: text('title').notNull().default('New conversation'),
	...timestamps
});

export const aiChatMessages = sqliteTable(
	'ai_chat_messages',
	{
		id,
		sessionId: text('session_id')
			.notNull()
			.references(() => aiChatSessions.id, { onDelete: 'cascade' }),
		role: text('role').notNull(), // 'user' | 'assistant'
		content: text('content').notNull(),
		createdAt
	},
	(t) => ({
		sessionIdx: index('ai_chat_messages_session_idx').on(t.sessionId)
	})
);

// ─── Image Security Scanning ─────────────────────────────────────────────────

export const imageScans = sqliteTable(
	'image_scans',
	{
		id,
		clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'cascade' }),
		image: text('image').notNull(),
		tag: text('tag'),
		digest: text('digest'),
		status: text('status').notNull().default('pending'), // pending | scanning | completed | failed
		trigger: text('trigger').notNull().default('manual'), // manual | scheduled
		resource: text('resource'),        // e.g. "deployment/nginx"
		resourceNamespace: text('resource_namespace'),
		scanner: text('scanner').default('trivy'),
		summary: text('summary'),           // JSON { critical, high, medium, low, unknown }
		errorMessage: text('error_message'),
		startedAt: text('started_at'),
		completedAt: text('completed_at'),
		...timestamps
	},
	(t) => ({
		clusterIdx: index('image_scans_cluster_idx').on(t.clusterId),
		imageIdx: index('image_scans_image_idx').on(t.image),
		statusIdx: index('image_scans_status_idx').on(t.status)
	})
);

export const imageScanVulnerabilities = sqliteTable(
	'image_scan_vulnerabilities',
	{
		id,
		scanId: integer('scan_id')
			.notNull()
			.references(() => imageScans.id, { onDelete: 'cascade' }),
		vulnerabilityId: text('vulnerability_id').notNull(), // CVE-XXXX-XXXXX
		pkgName: text('pkg_name').notNull(),
		installedVersion: text('installed_version'),
		fixedVersion: text('fixed_version'),
		severity: text('severity').notNull(), // CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN
		title: text('title'),
		description: text('description'),
		primaryUrl: text('primary_url'),
		score: real('score'),                // CVSS score
		createdAt
	},
	(t) => ({
		scanIdx: index('image_scan_vulns_scan_idx').on(t.scanId),
		severityIdx: index('image_scan_vulns_severity_idx').on(t.severity)
	})
);

export const scanSchedules = sqliteTable('scan_schedules', {
	id,
	clusterId: integer('cluster_id').references(() => clusters.id, { onDelete: 'cascade' }),
	enabled: bool('enabled').default(true),
	cronExpression: text('cron_expression').notNull().default('0 2 * * *'), // daily at 2am
	namespaces: text('namespaces'), // JSON string[] — null means all
	lastRunAt: text('last_run_at'),
	nextRunAt: text('next_run_at'),
	...timestamps
});

// ─── Type Exports ────────────────────────────────────────────────────────────

// Cluster types override `labels` from text → string[]
export type ClusterRow = typeof clusters.$inferSelect;
export type Cluster = Omit<ClusterRow, 'labels'> & { labels?: string[] };

export type ProvisionedCluster = typeof provisionedClusters.$inferSelect;
export type NewProvisionedCluster = typeof provisionedClusters.$inferInsert;
export type ProvisionedClusterLog = typeof provisionedClusterLogs.$inferSelect;
export type NewProvisionedClusterLog = typeof provisionedClusterLogs.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type NotificationSetting = typeof notificationSettings.$inferSelect;
export type NewNotificationSetting = typeof notificationSettings.$inferInsert;

export type AuthSetting = typeof authSettings.$inferSelect;
export type NewAuthSetting = typeof authSettings.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type LdapConfig = typeof ldapConfig.$inferSelect;
export type NewLdapConfig = typeof ldapConfig.$inferInsert;
export type OidcConfig = typeof oidcConfig.$inferSelect;
export type NewOidcConfig = typeof oidcConfig.$inferInsert;

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;

export type HostMetric = typeof hostMetrics.$inferSelect;
export type NewHostMetric = typeof hostMetrics.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
export type SshKey = typeof sshKeys.$inferSelect;
export type NewSshKey = typeof sshKeys.$inferInsert;
export type AiProvider = typeof aiProviders.$inferSelect;
export type NewAiProvider = typeof aiProviders.$inferInsert;

export type AiChatSession = typeof aiChatSessions.$inferSelect;
export type NewAiChatSession = typeof aiChatSessions.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type NewAiChatMessage = typeof aiChatMessages.$inferInsert;

export type ImageScan = typeof imageScans.$inferSelect;
export type NewImageScan = typeof imageScans.$inferInsert;
export type ImageScanVulnerability = typeof imageScanVulnerabilities.$inferSelect;
export type NewImageScanVulnerability = typeof imageScanVulnerabilities.$inferInsert;
export type ScanSchedule = typeof scanSchedules.$inferSelect;
export type NewScanSchedule = typeof scanSchedules.$inferInsert;
