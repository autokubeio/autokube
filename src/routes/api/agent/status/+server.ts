import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConnectedAgents } from '$lib/server/services/agent-connection';
import { authorize } from '$lib/server/services/authorize';

/**
 * GET /api/agent/status
 *
 * Returns the list of currently connected agents (admin only).
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const agents = getConnectedAgents();

	return json({ agents });
};
