/**
 * SSE endpoint for real-time image scan status updates.
 * Polls the DB every 2 seconds and emits a `change` event whenever the scan
 * list changes (new scan, status update, deletion).
 *
 * GET /api/image-scans/stream?clusterId=1
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { db, sql, eq, imageScans } from '$lib/server/db';

/** How often to poll the DB (ms) */
const POLL_INTERVAL_MS = 2_000;

/** How often to send a heartbeat comment to keep the connection alive (ms) */
const HEARTBEAT_INTERVAL_MS = 15_000;

export const GET: RequestHandler = async ({ url, request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'view'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterIdParam = url.searchParams.get('clusterId');
	const clusterId = clusterIdParam ? Number(clusterIdParam) : undefined;

	const abortController = new AbortController();
	request.signal.addEventListener('abort', () => abortController.abort());

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;

			const send = (data: object) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					closed = true;
				}
			};

			const sendHeartbeat = () => {
				if (closed) return;
				try {
					// SSE comment — keeps the connection alive without triggering onmessage
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					closed = true;
				}
			};

			// Fingerprint: "total:max_updated_at:active_count"
			// Changes when: a scan is added/deleted, a status changes, or a summary is written
			const getFingerprint = async (): Promise<string> => {
				const condition = clusterId
					? eq(imageScans.clusterId, clusterId)
					: undefined;

				const [row] = await db
					.select({
						total: sql<number>`COUNT(*)`,
						latestChange: sql<string>`MAX(${imageScans.updatedAt})`,
						activeCount: sql<number>`SUM(CASE WHEN ${imageScans.status} IN ('pending','scanning') THEN 1 ELSE 0 END)`
					})
					.from(imageScans)
					.where(condition);

				return `${row?.total ?? 0}:${row?.latestChange ?? ''}:${row?.activeCount ?? 0}`;
			};

			abortController.signal.addEventListener('abort', () => {
				closed = true;
				try { controller.close(); } catch { /* already closed */ }
			});

			// Send initial connected event
			send({ type: 'connected' });

			// Snapshot
			let prevFingerprint = await getFingerprint();

			// Heartbeat timer
			const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

			// Poll timer
			const pollTimer = setInterval(async () => {
				if (closed || abortController.signal.aborted) {
					clearInterval(pollTimer);
					clearInterval(heartbeatTimer);
					return;
				}
				try {
					const fp = await getFingerprint();
					if (fp !== prevFingerprint) {
						prevFingerprint = fp;
						send({ type: 'change' });
					}
				} catch (err) {
					console.error('[SSE] Image scan stream poll error:', err);
				}
			}, POLL_INTERVAL_MS);

			// Cleanup on abort
			abortController.signal.addEventListener('abort', () => {
				clearInterval(pollTimer);
				clearInterval(heartbeatTimer);
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no' // disable nginx buffering
		}
	});
};
