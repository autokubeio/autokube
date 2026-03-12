import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteStatefulSet } from '$lib/server/services/kubernetes';
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
		const stsName = url.searchParams.get('name');
		const namespace = url.searchParams.get('namespace');

		if (!clusterIdParam) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		if (!stsName) {
			return json({ success: false, error: 'StatefulSet name is required' }, { status: 400 });
		}

		if (!namespace) {
			return json({ success: false, error: 'Namespace is required' }, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await deleteStatefulSet(clusterId, stsName, namespace);

		if (result.success) {
			await audit(event, 'delete', 'statefulset', {
				entityName: stsName,
				clusterId,
				description: `Deleted statefulset ${stsName} in namespace ${namespace}`
			});
		}

		return json(result);
	} catch (error) {
		console.error('[API] Error deleting statefulset:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to delete statefulset'
			},
			{ status: 500 }
		);
	}
};
