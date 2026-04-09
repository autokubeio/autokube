/** Provisioned Clusters CRUD — create, read, update and delete cloud-provisioned K3s clusters. */

import {
	db,
	eq,
	desc,
	provisionedClusters,
	type ProvisionedCluster,
	type NewProvisionedCluster
} from '../db';
import { encrypt, decrypt } from '../helpers/encryption';

// ── Types ───────────────────────────────────────────────────────────────────

export type { ProvisionedCluster, NewProvisionedCluster };

export type ProvisionedClusterStatus =
	| 'pending'
	| 'provisioning'
	| 'running'
	| 'error'
	| 'deleting';

export interface MasterPoolConfig {
	count: number;
	instanceType: string;
	location: string;
}

export interface WorkerPool {
	name: string;
	count: number;
	instanceType: string;
	location: string;
}

export interface NetworkingConfig {
	networkZone?: string;
	cniPlugin?: string;
	usePrivateNetwork?: boolean;
	flannelBackend?: string;
	allowedPorts?: FirewallRule[];
}

export interface FirewallRule {
	port: string;
	protocol: 'tcp' | 'udp' | 'icmp';
	direction: 'inbound' | 'outbound';
	description?: string;
	sourceIps?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapRow(row: ProvisionedCluster): ProvisionedCluster {
	return {
		...row,
		providerToken: decrypt(row.providerToken)
	};
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function listProvisionedClusters(): Promise<ProvisionedCluster[]> {
	const rows = await db
		.select()
		.from(provisionedClusters)
		.orderBy(desc(provisionedClusters.createdAt));
	return rows.map(mapRow);
}

export async function getProvisionedCluster(id: number): Promise<ProvisionedCluster | null> {
	const [row] = await db
		.select()
		.from(provisionedClusters)
		.where(eq(provisionedClusters.id, id))
		.limit(1);
	return row ? mapRow(row) : null;
}

export async function getProvisionedClusterByName(
	name: string
): Promise<ProvisionedCluster | null> {
	const [row] = await db
		.select()
		.from(provisionedClusters)
		.where(eq(provisionedClusters.clusterName, name))
		.limit(1);
	return row ? mapRow(row) : null;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function insertProvisionedCluster(
	input: Omit<NewProvisionedCluster, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ProvisionedCluster> {
	const [row] = await db
		.insert(provisionedClusters)
		.values({
			...input,
			providerToken: input.providerToken ? encrypt(input.providerToken) : null
		})
		.returning();
	return mapRow(row);
}

export async function updateProvisionedCluster(
	id: number,
	patch: Partial<ProvisionedCluster>
): Promise<ProvisionedCluster | null> {
	const payload: Record<string, unknown> = {
		...patch,
		updatedAt: new Date().toISOString()
	};

	if (patch.providerToken !== undefined) {
		payload.providerToken = patch.providerToken ? encrypt(patch.providerToken) : null;
	}

	// Remove undefined values
	for (const k of Object.keys(payload)) {
		if (payload[k] === undefined) delete payload[k];
	}

	const [row] = await db
		.update(provisionedClusters)
		.set(payload)
		.where(eq(provisionedClusters.id, id))
		.returning();
	return row ? mapRow(row) : null;
}

export async function deleteProvisionedCluster(id: number): Promise<void> {
	await db.delete(provisionedClusters).where(eq(provisionedClusters.id, id));
}

export async function updateProvisionedClusterStatus(
	id: number,
	status: ProvisionedClusterStatus,
	statusMessage?: string,
	apiServerHostname?: string
): Promise<void> {
	await db
		.update(provisionedClusters)
		.set({
			status,
			statusMessage: statusMessage ?? null,
			...(apiServerHostname !== undefined ? { apiServerHostname } : {}),
			updatedAt: new Date().toISOString()
		})
		.where(eq(provisionedClusters.id, id));
}
