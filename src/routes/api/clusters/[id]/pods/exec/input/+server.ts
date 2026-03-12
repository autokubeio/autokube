import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { sendStdin, getSession } from '$lib/server/services/kubernetes/exec';

/**
 * POST /api/clusters/[id]/pods/exec/input
 * Sends stdin data to an active exec session.
 *
 * Body: { sessionId: string, data: string }
 */
export const POST: RequestHandler = async ({ request, cookies, params }) => {
	const clusterId = parseInt(params.id);
	if (isNaN(clusterId)) {
		return new Response('Invalid cluster ID', { status: 400 });
	}

	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('pods', 'exec', clusterId))) {
		return new Response('Permission denied', { status: 403 });
	}

	let body: { sessionId?: string; data?: string };
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON body', { status: 400 });
	}

	const { sessionId, data } = body;
	if (!sessionId || typeof data !== 'string') {
		return new Response('sessionId and data are required', { status: 400 });
	}

	const session = getSession(sessionId);
	if (!session) {
		return new Response('Session not found or expired', { status: 404 });
	}

	const ok = sendStdin(sessionId, data);
	return new Response(JSON.stringify({ ok }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
