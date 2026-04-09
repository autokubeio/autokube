import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listProvisionedClusters,
	insertProvisionedCluster
} from '$lib/server/queries/provisioned-clusters';
import { db, eq, clusters } from '$lib/server/db';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const rows = await listProvisionedClusters();

		// Determine which provisioned clusters have a linked cluster row + kubeconfig
		const linkedRows = await db
			.select({ provisionedClusterId: clusters.provisionedClusterId, kubeconfig: clusters.kubeconfig })
			.from(clusters)
			.where(eq(clusters.isProvisioned, true));

		const kubeconfigMap = new Map<number, boolean>();
		const hasClusterRowMap = new Map<number, boolean>();
		for (const r of linkedRows) {
			if (r.provisionedClusterId != null) {
				hasClusterRowMap.set(r.provisionedClusterId, true);
				kubeconfigMap.set(r.provisionedClusterId, !!r.kubeconfig);
			}
		}

		return json({
			clusters: rows.map((c) => {
				const { providerToken, ...rest } = c;
				return {
					...rest,
					hasProviderToken: !!providerToken,
					hasKubeconfig: kubeconfigMap.get(c.id) ?? false,
					hasClusterRow: hasClusterRowMap.get(c.id) ?? false
				};
			})
		});
	} catch (err) {
		console.error('[API/provisioning] Failed to list:', err);
		return json({ error: 'Failed to list provisioned clusters' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'create'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();

		if (!body.clusterName?.trim()) {
			return json({ error: 'Cluster name is required' }, { status: 400 });
		}
		if (!body.provider) {
			return json({ error: 'Provider is required' }, { status: 400 });
		}

		const cluster = await insertProvisionedCluster({
			clusterName: body.clusterName.trim(),
			provider: body.provider,
			k3sVersion: body.k3sVersion ?? 'v1.32.0+k3s1',
			kubeconfigPath: null,
			protectAgainstDeletion: body.protectAgainstDeletion ?? true,
			createLoadBalancer: body.createLoadBalancer ?? true,
			apiServerHostname: body.apiServerHostname ?? null,
			providerToken: body.providerToken ?? null,
			networkingConfig: body.networkingConfig ? JSON.stringify(body.networkingConfig) : null,
			mastersPoolConfig: body.mastersPoolConfig ? JSON.stringify(body.mastersPoolConfig) : null,
			workerPoolsConfig: body.workerPoolsConfig ? JSON.stringify(body.workerPoolsConfig) : null,
			addonsConfig: body.addonsConfig ? JSON.stringify(body.addonsConfig) : null,
			datastoreConfig: body.datastoreConfig ? JSON.stringify(body.datastoreConfig) : null,
			status: 'pending',
			statusMessage: null,
			lastProvisioned: null
		});

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'provisioned_cluster',
			entityId: String(cluster.id),
			entityName: cluster.clusterName,
			ipAddress: null,
			userAgent: null
		});

		return json({ cluster: { ...cluster, providerToken: undefined, hasProviderToken: !!cluster.providerToken, hasKubeconfig: false } }, { status: 201 });
	} catch (err) {
		console.error('[API/provisioning] Failed to create:', err);
		return json({ error: 'Failed to create provisioned cluster' }, { status: 500 });
	}
};
