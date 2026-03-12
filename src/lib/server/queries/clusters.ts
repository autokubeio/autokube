/**
 * Cluster Operations
 * Database operations for managing Kubernetes clusters
 */

import { db, eq, desc, clusters, hostMetrics, type ClusterRow, type Cluster } from '../db';
import { encrypt, decrypt } from '../helpers/encryption';
import { asc } from '$lib/server/db';

// ── Types ───────────────────────────────────────────────────────────────────

/** Keys whose values are encrypted at rest. */
type SensitiveKey = Extract<keyof Cluster, 'kubeconfig' | 'bearerToken' | 'tlsCa' | 'agentToken'>;

/** Fields that hold encrypted secrets. */
const SENSITIVE_FIELDS: readonly SensitiveKey[] = [
	'kubeconfig',
	'bearerToken',
	'tlsCa',
	'agentToken'
];

/** Scalar (non-encrypted, non-serialised) columns that can be patched directly. */
const SCALAR_FIELDS: ReadonlyArray<keyof Cluster> = [
	'name',
	'icon',
	'apiServer',
	'authType',
	'context',
	'namespace',
	'tlsSkipVerify',
	'metricsEnabled',
	'isProvisioned',
	'provisionedClusterId',
	'cpuWarnThreshold',
	'cpuCritThreshold',
	'memWarnThreshold',
	'memCritThreshold'
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Decrypt sensitive columns and deserialise JSON `labels`. */
function mapClusterRow(row: ClusterRow): Cluster {
	return {
		...row,
		labels: row.labels ? JSON.parse(row.labels) : [],
		kubeconfig: decrypt(row.kubeconfig),
		bearerToken: decrypt(row.bearerToken),
		tlsCa: decrypt(row.tlsCa),
		agentToken: decrypt(row.agentToken)
	};
}

/** Encrypt defined sensitive fields, skipping `undefined` entries. */
function sealSecrets(data: Partial<Cluster>): Record<string, string | null> {
	const sealed: Record<string, string | null> = {};

	for (const field of SENSITIVE_FIELDS) {
		const value = data[field];
		if (value !== undefined) {
			sealed[field] = value ? encrypt(value) : null;
		}
	}

	return sealed;
}

/** Build a Drizzle-compatible update payload from a partial Cluster. */
function buildPatch(patch: Partial<Cluster>): Record<string, unknown> {
	const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	for (const col of SCALAR_FIELDS) {
		if (patch[col] !== undefined) payload[col] = patch[col];
	}

	if (patch.labels !== undefined) {
		payload.labels = patch.labels ? JSON.stringify(patch.labels) : null;
	}

	Object.assign(payload, sealSecrets(patch));
	return payload;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listClusters(): Promise<Cluster[]> {
	const rows = await db.select().from(clusters).orderBy(asc(clusters.createdAt));
	return rows.map(mapClusterRow);
}

export async function clustersExist(): Promise<boolean> {
	const rows = await db.select({ id: clusters.id }).from(clusters).limit(1);
	return rows.length > 0;
}

export async function findCluster(id: number): Promise<Cluster | undefined> {
	const [row] = await db.select().from(clusters).where(eq(clusters.id, id));
	return row ? mapClusterRow(row) : undefined;
}

export async function findClusterByName(name: string): Promise<Cluster | undefined> {
	const [row] = await db.select().from(clusters).where(eq(clusters.name, name));
	return row ? mapClusterRow(row) : undefined;
}

/**
 * Find a cluster by its (encrypted) agent token.
 * Scans all agent-type clusters, decrypts tokens, and compares.
 */
export async function findClusterByToken(
	plainToken: string
): Promise<Cluster | undefined> {
	const rows = await db
		.select()
		.from(clusters)
		.where(eq(clusters.authType, 'agent'));

	for (const row of rows) {
		const mapped = mapClusterRow(row);
		if (mapped.agentToken === plainToken) {
			return mapped;
		}
	}
	return undefined;
}

export async function insertCluster(
	input: Omit<Cluster, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Cluster> {
	const sealed = sealSecrets(input);

	const [row] = await db
		.insert(clusters)
		.values({
			name: input.name,
			icon: input.icon || 'globe',
			labels: input.labels ? JSON.stringify(input.labels) : null,
			apiServer: input.apiServer || null,
			authType: input.authType || 'kubeconfig',
			kubeconfig: sealed.kubeconfig || null,
			context: input.context || null,
			namespace: input.namespace || 'default',
			bearerToken: sealed.bearerToken || null,
			tlsCa: sealed.tlsCa || null,
			tlsSkipVerify: input.tlsSkipVerify ?? false,
			isProvisioned: input.isProvisioned ?? false,
			provisionedClusterId: input.provisionedClusterId || null,
			agentUrl: input.agentUrl || null,
			agentToken: sealed.agentToken || null,
			cpuWarnThreshold: input.cpuWarnThreshold ?? 60,
			cpuCritThreshold: input.cpuCritThreshold ?? 80,
			memWarnThreshold: input.memWarnThreshold ?? 60,
			memCritThreshold: input.memCritThreshold ?? 80
		})
		.returning();

	return mapClusterRow(row);
}

export async function patchCluster(
	id: number,
	patch: Partial<Cluster>
): Promise<Cluster | undefined> {
	await db.update(clusters).set(buildPatch(patch)).where(eq(clusters.id, id));
	return findCluster(id);
}

export async function destroyCluster(id: number): Promise<void> {
	const existing = await findCluster(id);
	if (!existing) return;

	// Clean up related records that lack cascade delete
	try {
		await db.delete(hostMetrics).where(eq(hostMetrics.clusterId, id));
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error('[DB] Failed to cleanup host metrics for cluster:', msg);
	}

	await db.delete(clusters).where(eq(clusters.id, id));
}
