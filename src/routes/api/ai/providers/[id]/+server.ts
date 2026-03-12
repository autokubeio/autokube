import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateAiProvider, deleteAiProvider } from '$lib/server/queries/ai-providers';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const PATCH: RequestHandler = async ({ params, request, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const id = Number(params.id);
	if (!id) return json({ error: 'Invalid ID' }, { status: 400 });

	try {
		const body = await request.json();
		const updated = await updateAiProvider(id, body);
		if (!updated) return json({ error: 'Provider not found' }, { status: 404 });

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'update',
			entityType: 'settings',
			entityId: String(id),
			entityName: updated.name,
			description: `Updated AI provider "${updated.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ provider: updated });
	} catch (err) {
		console.error('[API] Failed to update AI provider:', err);
		return json({ error: 'Failed to update AI provider' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, request, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('settings', 'delete'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const id = Number(params.id);
	if (!id) return json({ error: 'Invalid ID' }, { status: 400 });

	try {
		await deleteAiProvider(id);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'settings',
			entityId: String(id),
			description: `Deleted AI provider #${id}`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete AI provider:', err);
		return json({ error: 'Failed to delete AI provider' }, { status: 500 });
	}
};
