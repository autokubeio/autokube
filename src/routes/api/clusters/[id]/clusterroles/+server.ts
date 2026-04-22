import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listClusterRoles } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/clusterroles
 * Returns all cluster roles for a cluster
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('access_control', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	const result = await listClusterRoles(clusterId);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true, clusterRoles: result.clusterRoles });
};
