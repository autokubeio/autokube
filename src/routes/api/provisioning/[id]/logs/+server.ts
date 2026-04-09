import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProvisioningLogs, clearProvisioningLogs } from '$lib/server/queries/provisioned-cluster-logs';
import { getProvisionedCluster } from '$lib/server/queries/provisioned-clusters';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const id = Number(params.id);
	const cluster = await getProvisionedCluster(id);
	if (!cluster) return json({ error: 'Not found' }, { status: 404 });

	const logs = await getProvisioningLogs(id);
	return json({ logs });
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'delete'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const id = Number(params.id);
	const cluster = await getProvisionedCluster(id);
	if (!cluster) return json({ error: 'Not found' }, { status: 404 });

	await clearProvisioningLogs(id);
	return json({ success: true });
};
