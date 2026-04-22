import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { deleteStorageClass } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * DELETE /api/clusters/[id]/storageclasses/[name]
 * Deletes a storage class by name
 */
export const DELETE: RequestHandler = async ({ params, cookies}) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('volumes', 'delete', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const name = params.name;
	if (!name) {
		return json({ success: false, error: 'Storage class name is required' }, { status: 400 });
	}

	const result = await deleteStorageClass(clusterId, name);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true });
};
