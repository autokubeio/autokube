import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteHorizontalPodAutoscaler } from '$lib/server/services/kubernetes';
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
		const hpaName = url.searchParams.get('name');
		const namespace = url.searchParams.get('namespace');

		if (!clusterIdParam) {
			return json({ success: false, error: 'Cluster ID is required' }, { status: 400 });
		}

		if (!hpaName) {
			return json({ success: false, error: 'HPA name is required' }, { status: 400 });
		}

		if (!namespace) {
			return json({ success: false, error: 'Namespace is required' }, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
		}

		const result = await deleteHorizontalPodAutoscaler(clusterId, hpaName, namespace);

		if (result.success) {
			await audit(event, 'delete', 'hpa', {
				entityName: hpaName,
				clusterId
			});
			return json({ success: true });
		}

		return json({ success: false, error: result.error }, { status: 500 });
	} catch (err) {
		console.error('[HPA] Delete error:', err);
		return json(
			{ success: false, error: err instanceof Error ? err.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
