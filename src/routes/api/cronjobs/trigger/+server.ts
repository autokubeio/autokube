import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { triggerCronJob } from '$lib/server/services/kubernetes';
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
		const { cluster, name, namespace } = body;

		if (!cluster) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		if (!name) {
			return json({ success: false, error: 'CronJob name is required' }, { status: 400 });
		}

		if (!namespace) {
			return json({ success: false, error: 'Namespace is required' }, { status: 400 });
		}

		const clusterId = parseInt(cluster);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await triggerCronJob(clusterId, name, namespace);

		if (result.success) {
			await audit(event, 'create', 'job', {
				entityName: result.jobName || name,
				clusterId,
				description: `Manually triggered cronjob ${name} in namespace ${namespace}${result.jobName ? ` (created job ${result.jobName})` : ''}`
			});
		}

		return json(result);
	} catch (error) {
		console.error('[API] Error triggering cronjob:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to trigger cronjob'
			},
			{ status: 500 }
		);
	}
};
