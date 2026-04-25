/**
 * SSE endpoint for Kubernetes resource watch
 * Streams real-time events from Kubernetes API to the browser
 *
 * GET /api/watch/:clusterId/:resource?namespace=...
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { watchResourceByCluster, getWatchPath } from '$lib/server/services/kubernetes';
import { findCluster } from '$lib/server/queries/clusters';
import {
	transformPod,
	transformNamespace,
	transformDeployment,
	transformDaemonSet,
	transformStatefulSet,
	transformReplicaSet,
	transformJob,
	transformCronJob,
	transformNode,
	transformEvent,
	transformService,
	transformEndpoint,
	transformEndpointSlice,
	transformIngress,
	transformIngressClass,
	transformNetworkPolicy,
	transformConfigMap,
	transformSecret,
	transformResourceQuota,
	transformLimitRange,
	transformPVC,
	transformPV,
	transformStorageClass,
	transformServiceAccount,
	transformRole,
	transformClusterRole,
	transformRoleBinding,
	transformClusterRoleBinding
} from '$lib/server/services/kubernetes/transformers';
import {
	transformGateway,
	transformGatewayClass,
	transformHTTPRoute,
	transformGRPCRoute,
	transformReferenceGrant,
	transformBackendTLSPolicy,
	transformBackendTrafficPolicy
} from '$lib/server/services/kubernetes/gateway-api';
import type { WatchEvent } from '$lib/server/services/kubernetes/watch';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, url, request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.clusterId);
	const { resource } = params;
	const namespace = url.searchParams.get('namespace') || undefined;

	if (isNaN(clusterId)) {
		throw error(400, 'Invalid cluster ID');
	}

	let watchPath: string;
	try {
		watchPath = getWatchPath(resource, namespace);
	} catch {
		throw error(400, `Unknown resource type: ${resource}`);
	}

	const abortController = new AbortController();

	// Abort K8s watch when client disconnects
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
			send({ type: 'connected', resource });

			// Resolve cluster name for better log messages
			let clusterLabel = `#${clusterId}`;
			try {
				const c = await findCluster(clusterId);
				if (c) clusterLabel = `"${c.name}" (#${clusterId})`;
			} catch {
				/* ignore */
			}

			console.log(
				`[SSE] Starting watch for ${resource} (cluster ${clusterLabel}, ns=${namespace ?? 'all'})`
			);

			let watchAttempt = 0;
			while (!abortController.signal.aborted) {
				if (watchAttempt > 0) {
					console.log(
						`[SSE] Reconnecting watch for ${resource} (cluster ${clusterLabel}, attempt ${watchAttempt})`
					);
				}
				watchAttempt++;
				try {
					await watchResourceByCluster(
						clusterId,
						watchPath,
						(event: WatchEvent) => {
							// Transform the event object to match application models
							let transformedEvent = event;

							if (resource === 'pods' && event.object) {
								try {
									const transformedPod = transformPod(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedPod
									};
								} catch (err) {
									console.error('[SSE] Failed to transform pod:', err);
								}
							} else if (resource === 'namespaces' && event.object) {
								try {
									const transformedNs = transformNamespace(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedNs
									};
								} catch (err) {
									console.error('[SSE] Failed to transform namespace:', err);
								}
							} else if (resource === 'deployments' && event.object) {
								try {
									const transformedDeploy = transformDeployment(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedDeploy
									};
								} catch (err) {
									console.error('[SSE] Failed to transform deployment:', err);
								}
							} else if (resource === 'daemonsets' && event.object) {
								try {
									const transformedDs = transformDaemonSet(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedDs
									};
								} catch (err) {
									console.error('[SSE] Failed to transform daemonset:', err);
								}
							} else if (resource === 'statefulsets' && event.object) {
								try {
									const transformedSts = transformStatefulSet(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedSts
									};
								} catch (err) {
									console.error('[SSE] Failed to transform statefulset:', err);
								}
							} else if (resource === 'replicasets' && event.object) {
								try {
									const transformedRs = transformReplicaSet(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedRs
									};
								} catch (err) {
									console.error('[SSE] Failed to transform replicaset:', err);
								}
							} else if (resource === 'jobs' && event.object) {
								try {
									const transformedJob = transformJob(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedJob
									};
								} catch (err) {
									console.error('[SSE] Failed to transform job:', err);
								}
							} else if (resource === 'cronjobs' && event.object) {
								try {
									const transformedCronJob = transformCronJob(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedCronJob
									};
								} catch (err) {
									console.error('[SSE] Failed to transform cronjob:', err);
								}
							} else if (resource === 'nodes' && event.object) {
								try {
									const transformedNode = transformNode(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedNode
									};
								} catch (err) {
									console.error('[SSE] Failed to transform node:', err);
								}
							} else if (resource === 'events' && event.object) {
								try {
									const transformedEvt = transformEvent(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedEvt
									};
								} catch (err) {
									console.error('[SSE] Failed to transform event:', err);
								}
							} else if (resource === 'services' && event.object) {
								try {
									const transformedSvc = transformService(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedSvc
									};
								} catch (err) {
									console.error('[SSE] Failed to transform service:', err);
								}
							} else if (resource === 'endpoints' && event.object) {
								try {
									const transformedEp = transformEndpoint(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedEp
									};
								} catch (err) {
									console.error('[SSE] Failed to transform endpoint:', err);
								}
							} else if (resource === 'endpointslices' && event.object) {
								try {
									const transformedSlice = transformEndpointSlice(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedSlice
									};
								} catch (err) {
									console.error('[SSE] Failed to transform endpoint slice:', err);
								}
							} else if (resource === 'ingresses' && event.object) {
								try {
									const transformedIng = transformIngress(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedIng
									};
								} catch (err) {
									console.error('[SSE] Failed to transform ingress:', err);
								}
							} else if (resource === 'ingressclasses' && event.object) {
								try {
									const transformedIc = transformIngressClass(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedIc
									};
								} catch (err) {
									console.error('[SSE] Failed to transform ingress class:', err);
								}
							} else if (resource === 'networkpolicies' && event.object) {
								try {
									const transformedNp = transformNetworkPolicy(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedNp
									};
								} catch (err) {
									console.error('[SSE] Failed to transform network policy:', err);
								}
							} else if (resource === 'configmaps' && event.object) {
								try {
									const transformedCm = transformConfigMap(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedCm
									};
								} catch (err) {
									console.error('[SSE] Failed to transform config map:', err);
								}
							} else if (resource === 'secrets' && event.object) {
								try {
									const transformedSecret = transformSecret(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedSecret
									};
								} catch (err) {
									console.error('[SSE] Failed to transform secret:', err);
								}
							} else if (resource === 'resourcequotas' && event.object) {
								try {
									const transformedRq = transformResourceQuota(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedRq
									};
								} catch (err) {
									console.error('[SSE] Failed to transform resource quota:', err);
								}
							} else if (resource === 'limitranges' && event.object) {
								try {
									const transformedLr = transformLimitRange(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedLr
									};
								} catch (err) {
									console.error('[SSE] Failed to transform limit range:', err);
								}
							} else if (resource === 'persistentvolumeclaims' && event.object) {
								try {
									const transformedPvc = transformPVC(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedPvc
									};
								} catch (err) {
									console.error('[SSE] Failed to transform PVC:', err);
								}
							} else if (resource === 'persistentvolumes' && event.object) {
								try {
									const transformedPv = transformPV(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedPv
									};
								} catch (err) {
									console.error('[SSE] Failed to transform PV:', err);
								}
							} else if (resource === 'storageclasses' && event.object) {
								try {
									const transformedSc = transformStorageClass(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedSc
									};
								} catch (err) {
									console.error('[SSE] Failed to transform storage class:', err);
								}
							} else if (resource === 'serviceaccounts' && event.object) {
								try {
									const transformedSa = transformServiceAccount(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedSa
									};
								} catch (err) {
									console.error('[SSE] Failed to transform service account:', err);
								}
							} else if (resource === 'roles' && event.object) {
								try {
									const transformedRole = transformRole(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedRole
									};
								} catch (err) {
									console.error('[SSE] Failed to transform role:', err);
								}
							} else if (resource === 'clusterroles' && event.object) {
								try {
									const transformedCr = transformClusterRole(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedCr
									};
								} catch (err) {
									console.error('[SSE] Failed to transform cluster role:', err);
								}
							} else if (resource === 'rolebindings' && event.object) {
								try {
									const transformedRb = transformRoleBinding(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedRb
									};
								} catch (err) {
									console.error('[SSE] Failed to transform role binding:', err);
								}
							} else if (resource === 'clusterrolebindings' && event.object) {
								try {
									const transformedCrb = transformClusterRoleBinding(event.object);
									transformedEvent = {
										type: event.type,
										object: transformedCrb
									};
								} catch (err) {
									console.error('[SSE] Failed to transform cluster role binding:', err);
								}
							} else if (resource === 'gateways' && event.object) {
								try {
									transformedEvent = { type: event.type, object: transformGateway(event.object) };
								} catch (err) {
									console.error('[SSE] Failed to transform gateway:', err);
								}
							} else if (resource === 'gatewayclasses' && event.object) {
								try {
									transformedEvent = {
										type: event.type,
										object: transformGatewayClass(event.object)
									};
								} catch (err) {
									console.error('[SSE] Failed to transform gatewayclass:', err);
								}
							} else if (resource === 'httproutes' && event.object) {
								try {
									transformedEvent = { type: event.type, object: transformHTTPRoute(event.object) };
								} catch (err) {
									console.error('[SSE] Failed to transform httproute:', err);
								}
							} else if (resource === 'grpcroutes' && event.object) {
								try {
									transformedEvent = { type: event.type, object: transformGRPCRoute(event.object) };
								} catch (err) {
									console.error('[SSE] Failed to transform grpcroute:', err);
								}
							} else if (resource === 'referencegrants' && event.object) {
								try {
									transformedEvent = {
										type: event.type,
										object: transformReferenceGrant(event.object)
									};
								} catch (err) {
									console.error('[SSE] Failed to transform referencegrant:', err);
								}
							} else if (resource === 'backendtlspolicies' && event.object) {
								try {
									transformedEvent = {
										type: event.type,
										object: transformBackendTLSPolicy(event.object)
									};
								} catch (err) {
									console.error('[SSE] Failed to transform backendtlspolicy:', err);
								}
							} else if (resource === 'backendtrafficpolicies' && event.object) {
								try {
									transformedEvent = {
										type: event.type,
										object: transformBackendTrafficPolicy(event.object)
									};
								} catch (err) {
									console.error('[SSE] Failed to transform backendtrafficpolicy:', err);
								}
							}

							send(transformedEvent);
						},
						abortController.signal
					);

					if (!abortController.signal.aborted) {
						// Watch expired naturally (K8s closed the stream after timeoutSeconds)
						await new Promise((r) => setTimeout(r, 500));
					}
				} catch (err: any) {
					const code: string = err?.code ?? '';
					const msg: string = err?.message ?? '';
					const isAbort =
						err?.name === 'AbortError' ||
						code === 'ERR_ABORTED' ||
						code === 'ECONNRESET' ||
						msg.includes('aborted');

					// Errors that will never self-heal without user reconfiguration
					const isConfigError =
						code === 'AGENT_NOT_SUPPORTED' ||
						code === 'CONFIG_ERROR' ||
						msg.includes('not found') ||
						msg.includes('Invalid kubeconfig') ||
						(msg.includes('kubeconfig') && msg.includes('required')) ||
						msg.includes('could not be decrypted') ||
						msg.includes('encryption key') ||
						msg.includes('Kubeconfig missing') ||
						msg.includes('No context specified') ||
						msg.includes('not found in kubeconfig') ||
						msg.includes('Unsupported auth type');

					// Transient server-side errors (503, 502, 500…)
					const isServerError =
						msg.toLowerCase().includes('http 5') || msg.toLowerCase().includes('server error');

					if (isAbort) {
						// Normal client disconnect — exit loop silently
						break;
					} else if (isConfigError) {
						// Permanent config error — tell client to stop retrying, then exit
						console.warn(`[SSE] Config error for ${resource} (cluster ${clusterLabel}): ${msg}`);
						send({ type: 'ERROR', code: 'CONFIG_ERROR', error: msg });
						break;
					} else if (
						code === 'ECONNREFUSED' ||
						code === 'ETIMEDOUT' ||
						code === 'ENOTFOUND' ||
						code === 'FailedToOpenSocket' ||
						msg.includes('Was there a typo in the url or port')
					) {
						// K8s API unreachable — tell the client, pause, then reconnect
						console.warn(
							`[SSE] Cluster unreachable for ${resource} (cluster ${clusterLabel}): ${code || msg}`
						);
						send({
							type: 'ERROR',
							code: 'CLUSTER_UNREACHABLE',
							error: 'Cannot connect to Kubernetes API server'
						});
						await new Promise((r) => setTimeout(r, 5000));
					} else if (isServerError) {
						// K8s API returned 5xx — transient, back off and retry silently
						console.warn(
							`[SSE] K8s 5xx for ${resource} (cluster ${clusterLabel}): ${msg} — retrying in 10s`
						);
						await new Promise((r) => setTimeout(r, 10_000));
					} else {
						console.error(`[SSE] Watch error for ${resource} (cluster ${clusterLabel}):`, err);
						send({ type: 'ERROR', code: 'WATCH_ERROR', error: msg || 'Unknown watch error' });
						await new Promise((r) => setTimeout(r, 3000));
					}
				}
			} // end while

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
};
