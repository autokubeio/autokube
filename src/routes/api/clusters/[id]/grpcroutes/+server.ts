import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listGRPCRoutes } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !(await auth.can('gateway', 'read', clusterId))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const namespace = url.searchParams.get('namespace') || 'all';
	const ns = namespace === 'all' ? undefined : namespace;

	try {
		const result = await listGRPCRoutes(clusterId, ns);
		if (!result.success) {
			return json(
				{ success: false, error: result.error || 'Failed to fetch GRPCRoutes' },
				{ status: 500 }
			);
		}
		return json({
			success: true,
			grpcRoutes: result.grpcRoutes,
			crdMissing: result.crdMissing ?? false
		});
	} catch (err) {
		console.error('[API] Failed to list GRPCRoutes:', err);
		return json({ success: false, error: 'Internal server error' }, { status: 500 });
	}
};
