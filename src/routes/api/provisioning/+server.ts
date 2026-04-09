import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listProvisionedClusters,
	insertProvisionedCluster
} from '$lib/server/queries/provisioned-clusters';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

/** Strip provider token before sending to client. */
function safeCluster(c: Awaited<ReturnType<typeof insertProvisionedCluster>>) {
	const { providerToken, ...rest } = c;
	return { ...rest, hasProviderToken: !!providerToken };
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const rows = await listProvisionedClusters();
		return json({ clusters: rows.map(safeCluster) });
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

		return json({ cluster: safeCluster(cluster) }, { status: 201 });
	} catch (err) {
		console.error('[API/provisioning] Failed to create:', err);
		return json({ error: 'Failed to create provisioned cluster' }, { status: 500 });
	}
};
