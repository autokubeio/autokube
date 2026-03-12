import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { auditLogs } from '$lib/server/db/schema';
import { authorize } from '$lib/server/services/authorize';

export const DELETE: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('audit_logs', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		// Delete all audit events
		await db.delete(auditLogs);

		return json({ success: true });
	} catch (err) {
		console.error('[API] Clear audit log error:', err);
		return json({ error: 'Failed to clear audit log' }, { status: 500 });
	}
};
