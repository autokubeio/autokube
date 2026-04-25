import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteGateway } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const DELETE: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !(await auth.can('gateway', 'delete', clusterId))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const name = params.name;
	const namespace = url.searchParams.get('namespace') || 'default';

	try {
		const result = await deleteGateway(clusterId, name, namespace);
		if (!result.success) {
			return json(
				{ success: false, error: result.error || 'Failed to delete gateway' },
				{ status: 500 }
			);
		}
		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete gateway:', err);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
