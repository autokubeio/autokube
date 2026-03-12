/** Host metrics — record, query, and prune CPU / memory snapshots. */

import { db, eq, desc, sql, hostMetrics, clusters, type HostMetric } from '../db';

// ── Constants ───────────────────────────────────────────────────────────────

/** Rows older than this are pruned after every write. */
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 h

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape accepted by `recordSnapshot`. */
export interface MetricSnapshot {
	cpuPercent: number;
	memoryPercent: number;
	memoryUsed: number;
	memoryTotal: number;
	clusterId?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Return true when the cluster row exists (direct query — no circular import). */
async function clusterExists(id: number): Promise<boolean> {
	const [hit] = await db
		.select({ id: clusters.id })
		.from(clusters)
		.where(eq(clusters.id, id))
		.limit(1);
	return !!hit;
}

/** Delete metric rows whose timestamp falls before the retention window. */
async function pruneStale(): Promise<void> {
	const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
	await db.delete(hostMetrics).where(sql`timestamp < ${cutoff}`);
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** Persist a snapshot and prune expired rows. Silently skips if `clusterId` no longer exists. */
export async function recordSnapshot(snap: MetricSnapshot): Promise<void> {
	if (snap.clusterId && !(await clusterExists(snap.clusterId))) return;

	const { cpuPercent, memoryPercent, memoryUsed, memoryTotal, clusterId } = snap;
	await db
		.insert(hostMetrics)
		.values({ clusterId, cpuPercent, memoryPercent, memoryUsed, memoryTotal });
	await pruneStale();
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** Fetch the most recent `cap` snapshots (newest first), optionally scoped to a cluster. */
export async function recentSnapshots(cap = 60, clusterId?: number): Promise<HostMetric[]> {
	const base = db.select().from(hostMetrics).orderBy(desc(hostMetrics.timestamp)).limit(cap);
	return clusterId ? base.where(eq(hostMetrics.clusterId, clusterId)) : base;
}

/** Return the newest single snapshot for a cluster, or `null`. */
export async function latestSnapshot(clusterId: number): Promise<HostMetric | null> {
	const [row] = await db
		.select()
		.from(hostMetrics)
		.where(eq(hostMetrics.clusterId, clusterId))
		.orderBy(desc(hostMetrics.timestamp))
		.limit(1);

	return row ?? null;
}
