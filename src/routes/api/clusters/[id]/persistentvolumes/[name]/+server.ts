import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deletePersistentVolume } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * DELETE /api/clusters/[id]/persistentvolumes/[name]
 * Deletes a persistent volume by name
 */
export const DELETE: RequestHandler = async ({ params, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.id);
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const name = params.name;
	if (!name) {
		return json({ success: false, error: 'PV name is required' }, { status: 400 });
	}

	const result = await deletePersistentVolume(clusterId, name);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true });
};
