import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { suspendJob } from '$lib/server/services/kubernetes';
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
		const { cluster, name, namespace, suspend } = body;

		if (!cluster) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		if (!name) {
			return json({ success: false, error: 'Job name is required' }, { status: 400 });
		}

		if (!namespace) {
			return json({ success: false, error: 'Namespace is required' }, { status: 400 });
		}

		if (typeof suspend !== 'boolean') {
			return json({ success: false, error: 'Suspend must be a boolean' }, { status: 400 });
		}

		const clusterId = parseInt(cluster);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await suspendJob(clusterId, name, namespace, suspend);

		if (result.success) {
			await audit(event, 'update', 'job', {
				entityName: name,
				clusterId,
				description: `${suspend ? 'Suspended' : 'Resumed'} job ${name} in namespace ${namespace}`
			});
		}

		return json(result);
	} catch (error) {
		console.error('[API] Error suspending job:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to suspend job'
			},
			{ status: 500 }
		);
	}
};
