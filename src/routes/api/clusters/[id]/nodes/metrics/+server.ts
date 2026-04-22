import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNodeMetrics } from '$lib/server/services/kubernetes';
import { findCluster } from '$lib/server/queries/clusters';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/clusters/[id]/nodes/metrics
 * Returns node metrics (CPU/memory usage) for a cluster
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('nodes', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {

		if (isNaN(clusterId)) {
			return json({ error: 'Invalid cluster ID' }, { status: 400 });
		}

		// Return empty metrics when metrics-server integration is disabled
		const clusterRecord = await findCluster(clusterId);
		if (clusterRecord?.metricsEnabled === false) {
			return json({ success: true, metrics: [] });
		}

		const result = await listNodeMetrics(clusterId);

		if (!result.success) {
			return json({ success: false, error: result.error }, { status: 500 });
		}

		return json({ success: true, metrics: result.metrics });
	} catch (error) {
		console.error('[Node Metrics API] Error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch node metrics'
			},
			{ status: 500 }
		);
	}
};
