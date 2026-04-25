import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteGatewayClass } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !(await auth.can('gateway', 'delete', clusterId))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	try {
		const result = await deleteGatewayClass(clusterId, params.name);
		if (!result.success) {
			return json(
				{ success: false, error: result.error || 'Failed to delete gateway class' },
				{ status: 500 }
			);
		}
		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete gateway class:', err);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
