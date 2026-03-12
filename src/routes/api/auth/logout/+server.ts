import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession } from '$lib/server/queries/sessions';

export const POST: RequestHandler = async ({ cookies }) => {
	try {
		const sessionId = cookies.get('session_id');

		if (sessionId) {
			await deleteSession(sessionId);
		}

		cookies.set('session_id', '', {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			expires: new Date(0)
		});

		return json({ message: 'Logged out' });
	} catch (error) {
		console.error('[API] Logout error:', error);
		return json({ error: 'Logout failed' }, { status: 500 });
	}
};
