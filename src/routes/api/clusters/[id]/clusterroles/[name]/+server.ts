import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteClusterRole } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * DELETE /api/clusters/[id]/clusterroles/[name]
 * Deletes a cluster role by name
 */
export const DELETE: RequestHandler = async ({ params, cookies}) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('access_control', 'delete', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	const name = params.name;
	if (!name) {
		return json({ error: 'Cluster role name is required' }, { status: 400 });
	}

	const result = await deleteClusterRole(clusterId, name);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true });
};
