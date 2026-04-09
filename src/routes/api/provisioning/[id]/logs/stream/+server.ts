/**
 * GET /api/provisioning/[id]/logs/stream
 *
 * Server-Sent Events (SSE) endpoint that streams provisioning log lines
 * to the client in real-time.
 *
 * On connect:
 *  1. Historical logs from DB are flushed immediately.
 *  2. If the cluster is still provisioning, the connection stays open and
 *     new lines are forwarded as they arrive via the event bus.
 *  3. When the job finishes, a final `event: done` frame is sent and the
 *     stream closes.
 */

import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { getProvisionedCluster } from '$lib/server/queries/provisioned-clusters';
import { getProvisioningLogs } from '$lib/server/queries/provisioned-cluster-logs';
import { eventBus, DONE_EVENT } from '$lib/server/provisioning/sse/event-bus';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return new Response('Forbidden', { status: 403 });
	}

	const id = Number(params.id);
	const cluster = await getProvisionedCluster(id);
	if (!cluster) return new Response('Not Found', { status: 404 });

	// Fetch historical logs eagerly before the stream is opened
	const historicalLogs = await getProvisioningLogs(id);

	const encoder = new TextEncoder();
	let cleanup: (() => void) | null = null;

	function sseEvent(data: object): Uint8Array {
		return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
	}

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// 1. Replay historical log entries
			for (const log of historicalLogs) {
				controller.enqueue(
					sseEvent({ level: log.level, message: log.message, createdAt: log.createdAt })
				);
			}

			// 2. If the cluster is not (or no longer) provisioning, close immediately
			if (cluster.status !== 'provisioning') {
				controller.close();
				return;
			}

			// 3. Subscribe to live events
			cleanup = eventBus.subscribe(id, (event) => {
				if (event.level === '__done__') {
					// Send a typed done event so the client can react
					try {
						controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
						controller.close();
					} catch {
						// stream already closed
					}
					cleanup?.();
					cleanup = null;
					return;
				}

				try {
					controller.enqueue(sseEvent(event));
				} catch {
					// Stream closed by client — unsubscribe
					cleanup?.();
					cleanup = null;
				}
			});
		},

		cancel() {
			cleanup?.();
			cleanup = null;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no' // disable nginx buffering for SSE
		}
	});
};
