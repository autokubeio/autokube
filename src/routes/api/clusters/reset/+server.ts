import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { clusters } from '$lib/server/db/schema';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const POST: RequestHandler = async ({ getClientAddress, request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		// Delete all clusters
		await db.delete(clusters);

		// Log audit event
		await logAuditEvent({
			username: 'system',
			action: 'delete',
			entityType: 'cluster',
			entityName: 'all',
			description: 'Reset all cluster connections',
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ success: true });
	} catch (err) {
		console.error('[API] Reset connections error:', err);
		return json({ error: 'Failed to reset cluster connections' }, { status: 500 });
	}
};
