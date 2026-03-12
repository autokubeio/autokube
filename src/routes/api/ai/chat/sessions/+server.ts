import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import {
	listChatSessions,
	deleteChatSession,
	getChatMessages
} from '$lib/server/queries/ai-chat';

/** GET /api/ai/chat/sessions?clusterId=X  → list sessions
 *  GET /api/ai/chat/sessions?sessionId=X  → load messages for session */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('cluster', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const sessionId = url.searchParams.get('sessionId');
	if (sessionId) {
		const messages = await getChatMessages(sessionId, 50);
		return json({ messages });
	}

	const clusterId = Number(url.searchParams.get('clusterId'));
	if (!clusterId) return json({ error: 'clusterId or sessionId required' }, { status: 400 });

	const sessions = await listChatSessions(clusterId);
	return json({ sessions });
};

/** DELETE /api/ai/chat/sessions?id=X */
export const DELETE: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('cluster', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });

	await deleteChatSession(id);
	return json({ success: true });
};
