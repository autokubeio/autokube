import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listIngressClasses } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('ingress', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	try {
		const result = await listIngressClasses(clusterId);
		if (!result.success) {
			return json(
				{ success: false, error: result.error || 'Failed to fetch ingress classes' },
				{ status: 500 }
			);
		}
		return json({ success: true, ingressClasses: result.ingressClasses });
	} catch (err) {
		console.error('[API] Failed to list ingress classes:', err);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
