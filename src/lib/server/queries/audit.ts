import { db, auditLogs, clusters, inArray, eq, sql, and, desc, asc } from '../db/index';
import {
	parseJsonField,
	stringifyJsonField,
	parseJsonArrayField,
	getCurrentTimestamp
} from '../helpers';

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_RETENTION_DAYS = 90;

// ── Types ───────────────────────────────────────────────────────────────────

export type AuditAction =
	| 'create'
	| 'update'
	| 'delete'
	| 'patch'
	| 'get'
	| 'list'
	| 'watch'
	| 'apply'
	| 'rollback'
	| 'scale'
	| 'restart'
	| 'logs'
	| 'exec'
	| 'port_forward'
	| 'drain'
	| 'cordon'
	| 'uncordon'
	| 'provision'
	| 'terminate'
	| 'upgrade'
	| 'login'
	| 'logout'
	| 'access_granted'
	| 'access_denied'
	| 'configure'
	| 'sync'
	| 'diagnose'
	| 'backup'
	| 'restore'
	| 'suspend'
	| 'resume'
	| 'trigger';

export type AuditEntityType =
	| 'pod'
	| 'deployment'
	| 'service'
	| 'configmap'
	| 'secret'
	| 'ingress'
	| 'namespace'
	| 'node'
	| 'cluster'
	| 'persistentvolume'
	| 'persistentvolumeclaim'
	| 'statefulset'
	| 'daemonset'
	| 'replicaset'
	| 'job'
	| 'cronjob'
	| 'storageclass'
	| 'role'
	| 'rolebinding'
	| 'clusterrole'
	| 'clusterrolebinding'
	| 'user'
	| 'settings'
	| 'oidc_provider'
	| 'ldap_config'
	| 'ssh_key'
	| 'certificate'
	| 'network_policy'
	| 'rbac'
	| 'notification'
	| 'event'
	| 'endpoint'
	| 'endpointslice'
	| 'ingressclass'
	| 'networkpolicy'
	| 'resourcequota'
	| 'limitrange'
	| 'serviceaccount'
	| 'hpa'
	| 'image_scan';

export interface AuditLogData {
	id: number;
	userId: number | null;
	username: string;
	action: AuditAction;
	entityType: AuditEntityType;
	entityId: string | null;
	entityName: string | null;
	clusterId: number | null;
	description: string | null;
	details: Record<string, unknown> | null;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: string;
}

export interface AuditLogCreateData {
	userId?: number | null;
	username: string;
	action: AuditAction;
	entityType: AuditEntityType;
	entityId?: string | null;
	entityName?: string | null;
	clusterId?: number | null;
	description?: string | null;
	details?: Record<string, unknown> | null;
	ipAddress?: string | null;
	userAgent?: string | null;
}

export interface AuditLogFilters {
	username?: string;
	usernames?: string[];
	entityType?: AuditEntityType;
	entityTypes?: AuditEntityType[];
	action?: AuditAction;
	actions?: AuditAction[];
	clusterId?: number;
	labels?: string[];
	fromDate?: string;
	toDate?: string;
	limit?: number;
	offset?: number;
}

export interface AuditLogResult {
	logs: AuditLogData[];
	total: number;
	limit: number;
	offset: number;
}

export type AuditLogWithCluster = AuditLogData & {
	clusterName?: string | null;
	clusterIcon?: string | null;
};

interface AuditLogRow {
	id: number;
	userId: number | null;
	username: string;
	action: string;
	entityType: string;
	entityId: string | null;
	entityName: string | null;
	clusterId: number | null;
	description: string | null;
	details: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: string | null;
	clusterName?: string | null;
	clusterIcon?: string | null;
}

// ── Helper Functions ────────────────────────────────────────────────────────

function mapRowToAuditLog(row: AuditLogRow): AuditLogWithCluster {
	return {
		id: row.id,
		userId: row.userId,
		username: row.username,
		action: row.action as AuditAction,
		entityType: row.entityType as AuditEntityType,
		entityId: row.entityId,
		entityName: row.entityName,
		clusterId: row.clusterId,
		description: row.description,
		details: parseJsonField<Record<string, unknown>>(row.details),
		ipAddress: row.ipAddress,
		userAgent: row.userAgent,
		createdAt: row.createdAt ?? getCurrentTimestamp(),
		clusterName: row.clusterName,
		clusterIcon: row.clusterIcon
	};
}

async function getClustersWithMatchingLabels(labels: string[]): Promise<number[]> {
	const allClusters = await db.select({ id: clusters.id, labels: clusters.labels }).from(clusters);

	return allClusters
		.filter((cluster) => {
			const clusterLabels = parseJsonArrayField<string>(cluster.labels);
			return labels.some((label) => clusterLabels.includes(label));
		})
		.map((cluster) => cluster.id);
}

// ── Public Functions ────────────────────────────────────────────────────────

export async function logAuditEvent(data: AuditLogCreateData): Promise<AuditLogData> {
	const result = await db
		.insert(auditLogs)
		.values({
			userId: data.userId ?? null,
			username: data.username,
			action: data.action,
			entityType: data.entityType,
			entityId: data.entityId ?? null,
			entityName: data.entityName ?? null,
			clusterId: data.clusterId ?? null,
			description: data.description ?? null,
			details: stringifyJsonField(data.details),
			ipAddress: data.ipAddress ?? null,
			userAgent: data.userAgent ?? null
		})
		.returning();

	const auditLog = await getAuditLog(result[0].id);
	if (!auditLog) {
		throw new Error('Failed to retrieve created audit log');
	}

	const { emitAudit } = await import('../helpers/audit-events');
	emitAudit(auditLog);

	return auditLog;
}

export async function getAuditLog(id: number): Promise<AuditLogWithCluster | undefined> {
	const results = await db
		.select({
			id: auditLogs.id,
			userId: auditLogs.userId,
			username: auditLogs.username,
			action: auditLogs.action,
			entityType: auditLogs.entityType,
			entityId: auditLogs.entityId,
			entityName: auditLogs.entityName,
			clusterId: auditLogs.clusterId,
			description: auditLogs.description,
			details: auditLogs.details,
			ipAddress: auditLogs.ipAddress,
			userAgent: auditLogs.userAgent,
			createdAt: auditLogs.createdAt,
			clusterName: clusters.name,
			clusterIcon: clusters.icon
		})
		.from(auditLogs)
		.leftJoin(clusters, eq(auditLogs.clusterId, clusters.id))
		.where(eq(auditLogs.id, id));

	if (!results[0]) return undefined;

	return mapRowToAuditLog(results[0]);
}

export async function getAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogResult> {
	const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
	const offset = filters.offset ?? 0;
	const emptyResult = { logs: [], total: 0, limit, offset };

	// Handle label filtering
	let labelFilteredClusterIds: number[] | undefined;
	if (filters.labels && filters.labels.length > 0) {
		labelFilteredClusterIds = await getClustersWithMatchingLabels(filters.labels);

		// Early return if no clusters match the labels
		if (labelFilteredClusterIds.length === 0) {
			return emptyResult;
		}
	}

	// Build where clause
	const whereClause = buildWhereClause(filters, labelFilteredClusterIds);

	// Validate cluster filter against label filter
	if (filters.clusterId !== undefined && filters.clusterId !== null) {
		if (labelFilteredClusterIds && !labelFilteredClusterIds.includes(filters.clusterId)) {
			return emptyResult;
		}
	}

	// Get total count
	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(auditLogs)
		.where(whereClause);
	const total = Number(countResult[0]?.count) || 0;

	// Get paginated results
	const rows = await db
		.select({
			id: auditLogs.id,
			userId: auditLogs.userId,
			username: auditLogs.username,
			action: auditLogs.action,
			entityType: auditLogs.entityType,
			entityId: auditLogs.entityId,
			entityName: auditLogs.entityName,
			clusterId: auditLogs.clusterId,
			description: auditLogs.description,
			details: auditLogs.details,
			ipAddress: auditLogs.ipAddress,
			userAgent: auditLogs.userAgent,
			createdAt: auditLogs.createdAt,
			clusterName: clusters.name,
			clusterIcon: clusters.icon
		})
		.from(auditLogs)
		.leftJoin(clusters, eq(auditLogs.clusterId, clusters.id))
		.where(whereClause)
		.orderBy(desc(auditLogs.createdAt))
		.limit(limit)
		.offset(offset);

	const logs = rows.map((row) => ({
		...mapRowToAuditLog(row),
		timestamp: row.createdAt
	})) as AuditLogWithCluster[];

	return { logs, total, limit, offset };
}

function buildWhereClause(filters: AuditLogFilters, labelFilteredClusterIds?: number[]) {
	const conditions: ReturnType<typeof eq>[] = [];

	// Username filters
	if (filters.usernames && filters.usernames.length > 0) {
		conditions.push(inArray(auditLogs.username, filters.usernames));
	} else if (filters.username) {
		conditions.push(eq(auditLogs.username, filters.username));
	}

	// Entity type filters
	if (filters.entityTypes && filters.entityTypes.length > 0) {
		conditions.push(inArray(auditLogs.entityType, filters.entityTypes));
	} else if (filters.entityType) {
		conditions.push(eq(auditLogs.entityType, filters.entityType));
	}

	// Action filters
	if (filters.actions && filters.actions.length > 0) {
		conditions.push(inArray(auditLogs.action, filters.actions));
	} else if (filters.action) {
		conditions.push(eq(auditLogs.action, filters.action));
	}

	// Cluster filters
	if (filters.clusterId !== undefined && filters.clusterId !== null) {
		conditions.push(eq(auditLogs.clusterId, filters.clusterId));
	} else if (labelFilteredClusterIds && labelFilteredClusterIds.length > 0) {
		conditions.push(inArray(auditLogs.clusterId, labelFilteredClusterIds));
	}

	// Date range filters
	if (filters.fromDate) {
		conditions.push(sql`${auditLogs.createdAt} >= ${filters.fromDate}`);
	}
	if (filters.toDate) {
		conditions.push(sql`${auditLogs.createdAt} <= ${filters.toDate}`);
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function getAuditLogUsers(): Promise<string[]> {
	const results = await db
		.selectDistinct({ username: auditLogs.username })
		.from(auditLogs)
		.orderBy(asc(auditLogs.username));

	return results.map((row) => row.username);
}

export async function deleteOldAuditLogs(keepDays = DEFAULT_RETENTION_DAYS): Promise<number> {
	const cutoffDate = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();

	const result = await db
		.delete(auditLogs)
		.where(sql`${auditLogs.createdAt} < ${cutoffDate}`)
		.returning({ id: auditLogs.id });

	return result.length;
}
