import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNamespaces } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ url, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const clusterIdParam = url.searchParams.get('cluster');

		if (!clusterIdParam) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await listNamespaces(clusterId);
		return json(result);
	} catch (error) {
		console.error('[API] Error fetching namespaces:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch namespaces'
			},
			{ status: 500 }
		);
	}
};
