import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scaleReplicaSet } from '$lib/server/services/kubernetes';
import { audit } from '$lib/server/services';
import { authorize } from '$lib/server/services/authorize';

export const POST: RequestHandler = async (event) => {
	const { cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'execute')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await event.request.json();
		const { cluster, name, namespace, replicas } = body;

		if (!cluster) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		if (!name) {
			return json({ success: false, error: 'ReplicaSet name is required' }, { status: 400 });
		}

		if (!namespace) {
			return json({ success: false, error: 'Namespace is required' }, { status: 400 });
		}

		if (replicas === undefined || replicas === null || replicas < 0) {
			return json({ success: false, error: 'Valid replica count is required' }, { status: 400 });
		}

		const clusterId = parseInt(cluster);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await scaleReplicaSet(clusterId, name, namespace, replicas);

		if (result.success) {
			await audit(event, 'update', 'replicaset', {
				entityName: name,
				clusterId,
				description: `Scaled replicaset ${name} to ${replicas} replicas in namespace ${namespace}`
			});
		}

		return json(result);
	} catch (error) {
		console.error('[API] Error scaling replicaset:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to scale replicaset'
			},
			{ status: 500 }
		);
	}
};
