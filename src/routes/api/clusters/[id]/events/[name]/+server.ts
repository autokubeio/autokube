import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteEvent } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * DELETE /api/clusters/[id]/events/[name]
 * Query params:
 *   - namespace: (required) The namespace of the event
 */
export const DELETE: RequestHandler = async ({ params, url, cookies}) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.can('events', 'delete', clusterId)) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const name = params.name;
	const namespace = url.searchParams.get('namespace') || 'default';

	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	if (!name) {
		return json({ error: 'Event name is required' }, { status: 400 });
	}

	const result = await deleteEvent(clusterId, name, namespace);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	return json({ success: true });
};
