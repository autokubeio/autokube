import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listConfigMaps } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/configmaps
 * Query params:
 *   - namespace: (optional) Filter by namespace, or 'all' for all namespaces
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('config', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const namespace = url.searchParams.get('namespace') || 'all';

	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	const ns = namespace === 'all' ? undefined : namespace;
	const result = await listConfigMaps(clusterId, ns);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true, configMaps: result.configMaps });
};
