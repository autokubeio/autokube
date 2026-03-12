import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAuditLogs, getAuditLogUsers } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ url, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('audit_logs', 'view')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const searchParams = url.searchParams;

		// Check if this is a request for distinct users
		if (searchParams.get('distinct') === 'users') {
			const users = await getAuditLogUsers();
			return json({ users });
		}

		// Build filters from query params
		const actions = searchParams.get('actions');
		const entityTypes = searchParams.get('entityTypes');
		const clusterId = searchParams.get('clusterId');
		const username = searchParams.get('username');
		const search = searchParams.get('search');
		const fromDate = searchParams.get('fromDate');
		const toDate = searchParams.get('toDate');
		const limit = searchParams.get('limit');
		const offset = searchParams.get('offset');

		const result = await getAuditLogs({
			...(actions && { actions: actions.split(',') as never[] }),
			...(entityTypes && { entityTypes: entityTypes.split(',') as never[] }),
			...(clusterId && { clusterId: Number(clusterId) }),
			...(username && { username }),
			...(fromDate && { fromDate }),
			...(toDate && { toDate }),
			...(limit && { limit: Number(limit) }),
			...(offset && { offset: Number(offset) })
		});

		// If search query provided, filter results in-memory (name / user match)
		if (search) {
			const q = search.toLowerCase();
			result.logs = result.logs.filter(
				(log) =>
					log.entityName?.toLowerCase().includes(q) ||
					log.username.toLowerCase().includes(q) ||
					log.description?.toLowerCase().includes(q)
			);
			result.total = result.logs.length;
		}

		return json(result);
	} catch (error) {
		console.error('[API] Failed to fetch audit logs:', error);
		return json({ error: 'Failed to fetch audit logs' }, { status: 500 });
	}
};
