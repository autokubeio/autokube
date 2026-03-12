import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { createExecSession, destroySession } from '$lib/server/services/kubernetes/exec';

function isNoShellError(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	if (normalized === 'no_shell' || normalized.startsWith('no_shell:')) {
		return true;
	}

	const noShellPatterns = [
		'executable file not found',
		'no such file or directory',
		'not found',
		'oci runtime exec failed',
		'failed to exec',
		'exit code 126',
		'exit code 127',
		'shell exited immediately'
	];

	return noShellPatterns.some((pattern) => normalized.includes(pattern));
}

/**
 * GET /api/clusters/[id]/pods/exec
 * Opens a K8s exec WebSocket and streams stdout/stderr as SSE.
 *
 * Query params:
 *   - namespace:  Pod namespace (default: "default")
 *   - pod:        Pod name (required)
 *   - container:  Container name (required)
 *   - shell:      Shell to use (default: "/bin/sh")
 *   - cols:       Terminal columns (default: 80)
 *   - rows:       Terminal rows (default: 24)
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const clusterId = parseInt(params.id);
	if (isNaN(clusterId)) {
		return new Response('Invalid cluster ID', { status: 400 });
	}

	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('pods', 'exec', clusterId))) {
		return new Response('Permission denied', { status: 403 });
	}

	const namespace = url.searchParams.get('namespace') || 'default';
	const podName = url.searchParams.get('pod');
	const container = url.searchParams.get('container');
	const shell = url.searchParams.get('shell') || '/bin/sh';
	const cols = parseInt(url.searchParams.get('cols') || '80');
	const rows = parseInt(url.searchParams.get('rows') || '24');

	if (!podName) {
		return new Response('Pod name is required', { status: 400 });
	}
	if (!container) {
		return new Response('Container name is required', { status: 400 });
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			createExecSession({
				clusterId,
				namespace,
				pod: podName,
				container,
				shell,
				cols,
				rows,
				onData(channel, data) {
					try {
						const event = channel === 2 ? 'stderr' : 'stdout';
						controller.enqueue(
							encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
						);
					} catch { /* stream closed */ }
				},
				onClose() {
					try {
						controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
						controller.close();
					} catch { /* already closed */ }
				},
				onError(err) {
					try {
						const msg = err.message || '';
						const isNoShell = isNoShellError(msg);
						const event = isNoShell ? 'no_shell' : 'error';
						controller.enqueue(
							encoder.encode(`event: ${event}\ndata: ${JSON.stringify(msg)}\n\n`)
						);
						controller.close();
					} catch { /* already closed */ }
				}
			})
				.then(({ sessionId, shell: resolvedShell }) => {
					// Send the session ID and resolved shell as the first event
					try {
						controller.enqueue(
							encoder.encode(
								`event: connected\ndata: ${JSON.stringify({ sessionId, shell: resolvedShell })}\n\n`
							)
						);
					} catch { /* ignore */ }
				})
				.catch((err) => {
					const msg = err instanceof Error ? err.message : String(err);
					const isNoShell = isNoShellError(msg);
					const eventName = isNoShell ? 'no_shell' : 'error';
					try {
						controller.enqueue(
							encoder.encode(
								`event: ${eventName}\ndata: ${JSON.stringify(msg)}\n\n`
							)
						);
						controller.close();
					} catch { /* ignore */ }
				});
		},
		cancel() {
			// Client disconnected — we can't easily get the sessionId here,
			// but the socket 'close' event will clean up automatically
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};

/**
 * DELETE /api/clusters/[id]/pods/exec?sessionId=xxx
 * Destroys an active exec session.
 */
export const DELETE: RequestHandler = async ({ params, url, cookies }) => {
	const clusterId = parseInt(params.id);
	if (isNaN(clusterId)) {
		return new Response('Invalid cluster ID', { status: 400 });
	}

	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('pods', 'exec', clusterId))) {
		return new Response('Permission denied', { status: 403 });
	}

	const sessionId = url.searchParams.get('sessionId');
	if (!sessionId) {
		return new Response('sessionId is required', { status: 400 });
	}

	destroySession(sessionId);
	return new Response(JSON.stringify({ ok: true }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
