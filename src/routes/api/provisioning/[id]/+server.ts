import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getProvisionedCluster,
	updateProvisionedCluster,
	deleteProvisionedCluster
} from '$lib/server/queries/provisioned-clusters';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

function safeCluster(c: NonNullable<Awaited<ReturnType<typeof getProvisionedCluster>>>) {
	const { providerToken, ...rest } = c;
	return { ...rest, hasProviderToken: !!providerToken };
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const cluster = await getProvisionedCluster(Number(params.id));
	if (!cluster) return json({ error: 'Not found' }, { status: 404 });
	return json({ cluster: safeCluster(cluster) });
};

export const PATCH: RequestHandler = async ({ params, request, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const id = Number(params.id);

		const updated = await updateProvisionedCluster(id, {
			clusterName: body.clusterName,
			k3sVersion: body.k3sVersion,
			protectAgainstDeletion: body.protectAgainstDeletion,
			createLoadBalancer: body.createLoadBalancer,
			apiServerHostname: body.apiServerHostname,
			providerToken: body.providerToken,
			networkingConfig: body.networkingConfig ? JSON.stringify(body.networkingConfig) : undefined,
			mastersPoolConfig: body.mastersPoolConfig
				? JSON.stringify(body.mastersPoolConfig)
				: undefined,
			workerPoolsConfig: body.workerPoolsConfig
				? JSON.stringify(body.workerPoolsConfig)
				: undefined,
			status: body.status,
			statusMessage: body.statusMessage
		});

		if (!updated) return json({ error: 'Not found' }, { status: 404 });

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'update',
			entityType: 'provisioned_cluster',
			entityId: String(id),
			entityName: updated.clusterName,
			ipAddress: null,
			userAgent: null
		});

		return json({ cluster: safeCluster(updated) });
	} catch (err) {
		console.error('[API/provisioning/id] Failed to update:', err);
		return json({ error: 'Failed to update' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'delete'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const id = Number(params.id);
	const cluster = await getProvisionedCluster(id);
	if (!cluster) return json({ error: 'Not found' }, { status: 404 });

	await deleteProvisionedCluster(id);

	await logAuditEvent({
		username: auth.user?.username ?? 'system',
		action: 'delete',
		entityType: 'provisioned_cluster',
		entityId: String(id),
		entityName: cluster.clusterName,
		ipAddress: null,
		userAgent: null
	});

	return json({ success: true });
};
