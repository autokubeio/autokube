import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteNamespace } from '$lib/server/services/kubernetes';
import { audit } from '$lib/server/services';
import { authorize } from '$lib/server/services/authorize';

export const DELETE: RequestHandler = async (event) => {
	const { cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'execute')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const { url } = event;

	try {
		const clusterIdParam = url.searchParams.get('cluster');
		const namespaceName = url.searchParams.get('name');

		if (!clusterIdParam) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		if (!namespaceName) {
			return json({ success: false, error: 'Namespace name is required' }, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await deleteNamespace(clusterId, namespaceName);

		if (result.success) {
			await audit(event, 'delete', 'namespace', {
				entityName: namespaceName,
				clusterId,
				description: `Deleted namespace ${namespaceName}`
			});
		}

		return json(result);
	} catch (error) {
		console.error('[API] Error deleting namespace:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to delete namespace'
			},
			{ status: 500 }
		);
	}
};
