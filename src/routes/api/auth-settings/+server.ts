import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadAuthConfig, patchAuthConfig } from '$lib/server/queries/auth-settings';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	try {
		const config = await loadAuthConfig();
		// Unauthenticated requests only get the public flag needed to render the login page
		if (auth.authEnabled && !await auth.can('settings', 'read')) {
			return json({ authEnabled: config.authEnabled });
		}
		return json(config);
	} catch (error) {
		console.error('[API] Failed to load auth settings:', error);
		return json({ error: 'Failed to load auth settings' }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ request, getClientAddress, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const updated = await patchAuthConfig(body);

		await logAuditEvent({
			username: 'system',
			action: 'update',
			entityType: 'settings',
			entityName: 'auth_settings',
			description: 'Updated authentication settings',
			details: body,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(updated);
	} catch (error) {
		console.error('[API] Failed to update auth settings:', error);
		return json({ error: 'Failed to update auth settings' }, { status: 500 });
	}
};
