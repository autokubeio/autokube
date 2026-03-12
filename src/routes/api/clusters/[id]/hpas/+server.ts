import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listHorizontalPodAutoscalers } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/hpas
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

	const result = await listHorizontalPodAutoscalers(clusterId, namespace);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true, hpas: result.hpas });
};
