import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPodMetrics } from '$lib/server/services/kubernetes';
import { findCluster } from '$lib/server/queries/clusters';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('pods', 'read', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const namespace = url.searchParams.get('namespace') || undefined;

		// Return empty metrics when metrics-server integration is disabled
		const cluster = await findCluster(clusterId);
		if (cluster?.metricsEnabled === false) {
			return json({ success: true, metrics: [] });
		}

		const result = await listPodMetrics(clusterId, namespace);

		if (!result.success) {
			return json({ success: false, error: result.error }, { status: 500 });
		}

		return json({ success: true, metrics: result.metrics });
	} catch (error) {
		console.error('[Pods Metrics API] Error:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch pod metrics'
			},
			{ status: 500 }
		);
	}
};
