import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEndpointSlices } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.id);
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const namespace = url.searchParams.get('namespace') || 'all';
	const ns = namespace === 'all' ? undefined : namespace;

	try {
		const result = await listEndpointSlices(clusterId, ns);
		if (!result.success) {
			return json(
				{ success: false, error: result.error || 'Failed to fetch endpoint slices' },
				{ status: 500 }
			);
		}
		return json({ success: true, endpointSlices: result.endpointSlices });
	} catch (err) {
		console.error('[API] Failed to list endpoint slices:', err);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
