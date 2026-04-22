import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPersistentVolumes } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/persistentvolumes
 * Returns all persistent volumes for a cluster
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('volumes', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const result = await listPersistentVolumes(clusterId);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true, persistentVolumes: result.persistentVolumes });
};
