import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listIngresses } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('ingress', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const namespace = url.searchParams.get('namespace') || 'all';
	const ns = namespace === 'all' ? undefined : namespace;

	try {
		const result = await listIngresses(clusterId, ns);
		if (!result.success) {
			return json(
				{ success: false, error: result.error || 'Failed to fetch ingresses' },
				{ status: 500 }
			);
		}
		return json({ success: true, ingresses: result.ingresses });
	} catch (err) {
		console.error('[API] Failed to list ingresses:', err);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
