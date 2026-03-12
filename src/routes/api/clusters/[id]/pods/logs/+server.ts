import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { findCluster } from '$lib/server/queries/clusters';
import {
	buildConnectionConfig,
	k8sRequest,
	type KubeconfigData,
	type BearerTokenConnection
} from '$lib/server/services/kubernetes';
import https from 'node:https';

const AGENT_LOG_POLL_INTERVAL = 2000;

function splitLogLines(chunk: string): string[] {
	return chunk
		.split('\n')
		.map((line) => line.replace(/\r$/, ''))
		.filter((line) => line.length > 0);
}

function extractLogTimestamp(line: string): string | null {
	const spaceIndex = line.indexOf(' ');
	if (spaceIndex <= 0) return null;
	const candidate = line.slice(0, spaceIndex);
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(candidate) ? candidate : null;
}

async function waitForNextPoll(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return;

	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, AGENT_LOG_POLL_INTERVAL);

		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};

		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * GET /api/clusters/[id]/pods/logs
 * Streams pod logs as Server-Sent Events.
 *
 * Query params:
 *   - namespace: Pod namespace
 *   - pod:       Pod name (required)
 *   - container: Container name (optional, defaults to first container)
 *   - tailLines: Number of prior lines to tail (default: 200)
 *   - previous:  Stream previous container logs (default: false)
 */
export const GET: RequestHandler = async ({ params, url, cookies, request }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return new Response('Permission denied', { status: 403 });
	}

	const clusterId = parseInt(params.id);
	if (isNaN(clusterId)) {
		return new Response('Invalid cluster ID', { status: 400 });
	}

	const namespace = url.searchParams.get('namespace') || 'default';
	const podName = url.searchParams.get('pod');
	const container = url.searchParams.get('container') || undefined;
	const tailLines = parseInt(url.searchParams.get('tailLines') || '200');
	const sinceSeconds = url.searchParams.get('sinceSeconds') || undefined;
	const previous = url.searchParams.get('previous') === 'true';

	if (!podName) {
		return new Response('Pod name is required', { status: 400 });
	}

	const cluster = await findCluster(clusterId);
	if (!cluster) {
		return new Response('Cluster not found', { status: 404 });
	}

	let config;
	try {
		config = buildConnectionConfig({ ...cluster, authType: cluster.authType ?? undefined });
	} catch (e) {
		return new Response(
			`Failed to build cluster config: ${e instanceof Error ? e.message : 'Unknown error'}`,
			{ status: 500 }
		);
	}

	const qs = new URLSearchParams({
		tailLines: tailLines.toString(),
		timestamps: 'true'
	});
	if (container) qs.set('container', container);
	if (sinceSeconds) qs.set('sinceSeconds', sinceSeconds);
	if (previous) qs.set('previous', 'true');

	const logPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${qs.toString()}`;

	const encoder = new TextEncoder();
	let req: ReturnType<typeof https.request> | null = null;

	const stream = new ReadableStream({
		async start(controller) {
			if (config.authType === 'agent') {
				const agentConfig = config;
				let lastTimestamp = sinceSeconds ? null : null;
				let initialRequest = true;
				const recentlySent = new Set<string>();
				const recentQueue: string[] = [];

				const rememberLine = (line: string) => {
					recentQueue.push(line);
					recentlySent.add(line);
					if (recentQueue.length > 2000) {
						const removed = recentQueue.shift();
						if (removed) recentlySent.delete(removed);
					}
				};

				const sendError = (message: string) => {
					try {
						controller.enqueue(
							encoder.encode(`event: error\ndata: ${JSON.stringify(message)}\n\n`)
						);
						controller.close();
					} catch {}
				};

				try {
					while (!request.signal.aborted) {
						const pollQs = new URLSearchParams({ timestamps: 'true' });
						if (container) pollQs.set('container', container);
						if (previous) pollQs.set('previous', 'true');

						if (initialRequest) {
							pollQs.set('tailLines', tailLines.toString());
							if (sinceSeconds) pollQs.set('sinceSeconds', sinceSeconds);
						} else if (lastTimestamp) {
							pollQs.set('sinceTime', lastTimestamp);
						} else {
							pollQs.set('tailLines', '50');
						}

						const pollPath = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${pollQs.toString()}`;
						const body = await k8sRequest<string>(agentConfig, pollPath, 30_000);
						const lines = splitLogLines(typeof body === 'string' ? body : String(body));

						for (const line of lines) {
							if (!line.trim()) continue;
							const ts = extractLogTimestamp(line);
							if (ts) lastTimestamp = ts;
							if (!initialRequest && recentlySent.has(line)) continue;

							try {
								controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
								rememberLine(line);
							} catch {
								return;
							}
						}

						initialRequest = false;
						await waitForNextPoll(request.signal);
					}
				} catch (err) {
					sendError(err instanceof Error ? err.message : 'Log stream failed');
					return;
				}

				try {
					controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
					controller.close();
				} catch {}
				return;
			}

			const standardConfig = config as KubeconfigData | BearerTokenConnection;
			qs.set('follow', 'true');
			const baseUrl = new URL(logPath, standardConfig.server);
			const skipTLSVerify =
				standardConfig.skipTLSVerify || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

			const reqOptions: https.RequestOptions = {
				hostname: baseUrl.hostname,
				port: baseUrl.port || 443,
				path: baseUrl.pathname + baseUrl.search,
				method: 'GET',
				headers: {
					...(standardConfig.token ? { Authorization: `Bearer ${standardConfig.token}` } : {})
				},
				rejectUnauthorized: !skipTLSVerify,
				servername: baseUrl.hostname
			};

			if (standardConfig.ca) reqOptions.ca = standardConfig.ca;
			if ('cert' in standardConfig && standardConfig.cert) reqOptions.cert = standardConfig.cert;
			if ('key' in standardConfig && standardConfig.key) reqOptions.key = standardConfig.key;

			req = https.request(reqOptions, (res) => {
				// Handle HTTP error responses
				if (res.statusCode && res.statusCode >= 400) {
					let errorData = '';
					res.on('data', (chunk) => (errorData += chunk));
					res.on('end', () => {
						try {
							controller.enqueue(
								encoder.encode(
									`event: error\ndata: ${JSON.stringify(`HTTP ${res.statusCode}: ${errorData}`)}\n\n`
								)
							);
							controller.close();
						} catch {}
					});
					return;
				}

				// Stream log lines as SSE events
				let buffer = '';
				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString('utf8');
					const lines = buffer.split('\n');
					buffer = lines.pop() || ''; // keep incomplete line in buffer
					for (const line of lines) {
						try {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
						} catch {
							return;
						}
					}
				});

				res.on('end', () => {
					try {
						// flush remaining buffer
						if (buffer.trim()) {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(buffer)}\n\n`));
						}
						controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
						controller.close();
					} catch {}
				});

				res.on('error', (err) => {
					try {
						controller.enqueue(
							encoder.encode(`event: error\ndata: ${JSON.stringify(err.message)}\n\n`)
						);
						controller.close();
					} catch {}
				});
			});

			req.on('error', (err) => {
				try {
					controller.enqueue(
						encoder.encode(`event: error\ndata: ${JSON.stringify(err.message)}\n\n`)
					);
					controller.close();
				} catch {}
			});

			req.end();
		},

		cancel() {
			// Client disconnected — tear down the upstream k8s connection
			if (req) {
				req.destroy();
				req = null;
			}
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
