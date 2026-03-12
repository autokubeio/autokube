import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listHelmReleases } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async (event) => {
	const { cookies, url } = event;

	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const clusterIdParam = url.searchParams.get('cluster');
		const namespace = url.searchParams.get('namespace') ?? undefined;

		if (!clusterIdParam) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await listHelmReleases(clusterId, namespace === 'all' ? undefined : namespace);

		return json(result);
	} catch (error) {
		console.error('[API] Error fetching Helm releases:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch Helm releases'
			},
			{ status: 500 }
		);
	}
};
