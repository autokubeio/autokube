import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services';

export const GET: RequestHandler = async ({ cookies }) => {
	try {
		const ctx = await authorize(cookies);

		if (!ctx.authEnabled) {
			return json({ authEnabled: false, user: null });
		}

		if (!ctx.isAuthenticated || !ctx.user) {
			return json({ error: 'Not authenticated' }, { status: 401 });
		}

		return json({
			authEnabled: true,
			user: ctx.user
		});
	} catch (error) {
		console.error('[API] Auth/me error:', error);
		return json({ error: 'Failed to get session' }, { status: 500 });
	}
};
