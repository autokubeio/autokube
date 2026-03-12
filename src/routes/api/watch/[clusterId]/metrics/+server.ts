/**
 * SSE endpoint for pod metrics
 * Polls metrics-server every 3 seconds and streams changes to the browser
 *
 * GET /api/watch/:clusterId/metrics?namespace=...
 */

import type { RequestEvent } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import type { PodMetrics } from '$lib/server/services/kubernetes';
import { transformPodMetrics } from '$lib/server/services/kubernetes/transformers';
import { findCluster } from '$lib/server/queries/clusters';
import { makeClusterRequest } from '$lib/server/services/kubernetes/utils';
import { authorize } from '$lib/server/services/authorize';

export async function GET({ params, url, request, cookies }: RequestEvent) {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.clusterId || '0');
	const namespace = url.searchParams.get('namespace') || undefined;

	if (isNaN(clusterId)) {
		throw error(400, 'Invalid cluster ID');
	}

	const cluster = await findCluster(clusterId);
	if (!cluster || !cluster.kubeconfig) {
		throw error(404, 'Cluster not found or missing kubeconfig');
	}

	// Return empty stream when metrics-server integration is disabled
	if (cluster.metricsEnabled === false) {
		return json({ success: true, metrics: [] });
	}

	const abortController = new AbortController();

	// Abort when client disconnects
	request.signal.addEventListener('abort', () => {
		abortController.abort();
	});

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: object) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Stream closed, ignore
				}
			};

			// Initial ping so the client knows the connection is alive
			send({ type: 'connected', resource: 'metrics' });

			// Store previous metrics to detect changes
			let previousMetrics = new Map<string, { cpu: string; memory: string }>();

			console.log(
				`[SSE Metrics] Starting metrics stream (cluster ${clusterId}, ns=${namespace ?? 'all'})`
			);

			try {
				// Poll metrics every 3 seconds
				const pollInterval = 3000;

				while (!abortController.signal.aborted) {
					try {
						// Fetch raw metrics from K8s API
						const effectiveNamespace = namespace === 'all' ? undefined : namespace;
						const path = effectiveNamespace
							? `/apis/metrics.k8s.io/v1beta1/namespaces/${effectiveNamespace}/pods`
							: '/apis/metrics.k8s.io/v1beta1/pods';

						const result = await makeClusterRequest<{
							items: Array<{
								metadata: { name: string; namespace?: string };
								containers?: Array<{
									name?: string;
									usage?: { cpu?: string; memory?: string };
								}>;
							}>;
						}>(clusterId, path, 30000);

						if (result.success && result.data?.items) {
							// Transform raw metrics to PodMetrics format
							const currentMetrics = new Map<string, PodMetrics>();

							result.data.items.forEach((rawMetric) => {
								try {
									const transformedMetric = transformPodMetrics(rawMetric);
									const key = `${transformedMetric.namespace}/${transformedMetric.name}`;
									currentMetrics.set(key, transformedMetric);

									// Check if this is new or changed
									const previous = previousMetrics.get(key);
									const current = { cpu: transformedMetric.cpu, memory: transformedMetric.memory };

									if (
										!previous ||
										previous.cpu !== current.cpu ||
										previous.memory !== current.memory
									) {
										// Send as MODIFIED event with full PodMetrics structure
										send({
											type: 'MODIFIED',
											object: transformedMetric
										});
									}
								} catch (err) {
									console.error('[SSE Metrics] Failed to transform metric:', err);
								}
							});

							// Check for deleted pods (metrics disappeared)
							for (const [key, previousMetric] of previousMetrics) {
								if (!currentMetrics.has(key)) {
									send({
										type: 'DELETED',
										object: previousMetric
									});
								}
							}

							// Update previous metrics map
							previousMetrics = new Map();
							for (const [key, metric] of currentMetrics) {
								previousMetrics.set(key, { cpu: metric.cpu, memory: metric.memory });
							}
						}
					} catch (err: any) {
						const errorCode: string = err?.code ?? '';
						const errorMsg: string = err instanceof Error ? err.message : 'Unknown error';
						if (
							errorCode === 'ECONNREFUSED' ||
							errorCode === 'ETIMEDOUT' ||
							errorCode === 'ENOTFOUND'
						) {
							// K8s API unreachable — tell the client to back off
							send({
								type: 'ERROR',
								code: 'CLUSTER_UNREACHABLE',
								error: 'Cannot connect to Kubernetes API server'
							});
							break; // Stop polling - client will reconnect with backoff
						} else if (!errorMsg.includes('404')) {
							console.error('[SSE Metrics] Poll error:', errorMsg);
						}
					}

					// Wait before next poll
					await new Promise<void>((resolve, reject) => {
						const timeout = setTimeout(resolve, pollInterval);
						abortController.signal.addEventListener('abort', () => {
							clearTimeout(timeout);
							reject(new Error('Aborted'));
						});
					});
				}
			} catch (err: any) {
				const errorMsg = err instanceof Error ? err.message : 'Unknown error';
				// Ignore expected abort/disconnect errors
				const isAbort =
					err?.name === 'AbortError' ||
					err?.code === 'ECONNRESET' ||
					errorMsg.includes('aborted') ||
					errorMsg.includes('Aborted');

				if (!isAbort) {
					console.error('[SSE Metrics] Stream error:', err);
					send({ type: 'ERROR', error: errorMsg });
				}
			}

			console.log('[SSE Metrics] Stream ended');

			try {
				controller.close();
			} catch {
				// Already closed
			}
		},
		cancel() {
			// Browser closed the connection
			abortController.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no' // Disable Nginx buffering
		}
	});
}
