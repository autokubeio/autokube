import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEvents } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/events
 * Query params:
 *   - namespace: (optional) Filter by namespace, or 'all' for all namespaces
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.id);
	const namespace = url.searchParams.get('namespace') || 'all';

	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	try {
		const result = await listEvents(clusterId, namespace);

		if (!result.success) {
			// Log only once per unique error (avoid spam during polling)
			if (Math.random() < 0.1) { // 10% sampling for failed clusters
				console.warn(`[Events API] Cluster ${clusterId} events unavailable:`, result.error);
			}
			// Return empty events array instead of 500 error
			return json({ success: true, events: [] });
		}

		return json({ success: true, events: result.events });
	} catch (error) {
		// Silently handle exceptions - cluster is likely offline/misconfigured
		return json({ success: true, events: [] });
	}
};
