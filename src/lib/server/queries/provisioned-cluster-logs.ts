/** Provisioning log CRUD — append, query, and clear log entries for provisioned clusters. */

import { db, eq, asc, provisionedClusterLogs, type ProvisionedClusterLog } from '../db';

// ── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'k3s';

// ── Queries ─────────────────────────────────────────────────────────────────

/** Fetch all logs for a cluster, oldest first. */
export async function getProvisioningLogs(clusterId: number): Promise<ProvisionedClusterLog[]> {
	return db
		.select()
		.from(provisionedClusterLogs)
		.where(eq(provisionedClusterLogs.provisionedClusterId, clusterId))
		.orderBy(asc(provisionedClusterLogs.createdAt));
}

/** Return logs as a single newline-delimited string (e.g. for download or display). */
export async function getFormattedLogs(clusterId: number): Promise<string> {
	const entries = await getProvisioningLogs(clusterId);
	return entries.map((e) => `[${e.createdAt}] ${e.message}`).join('\n');
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Append a log entry. Returns the inserted row. */
export async function addProvisioningLog(
	clusterId: number,
	message: string,
	level: LogLevel = 'info'
): Promise<ProvisionedClusterLog> {
	const [row] = await db
		.insert(provisionedClusterLogs)
		.values({ provisionedClusterId: clusterId, message, level })
		.returning();
	return row;
}

/** Delete every log entry for a cluster. */
export async function clearProvisioningLogs(clusterId: number): Promise<void> {
	await db
		.delete(provisionedClusterLogs)
		.where(eq(provisionedClusterLogs.provisionedClusterId, clusterId));
}
