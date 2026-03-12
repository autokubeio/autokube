/**
 * Kubernetes Core Resources (Refactored Example)
 * Demonstrates clean implementation using utilities and factories
 */

import type {
	TestConnectionResult,
	ListNamespacesResult,
	ListPodsResult,
	ListDeploymentsResult
} from './types';
import type { KubeconfigData } from './utils';
import { k8sRequest, withKubeconfig, makeClusterRequest } from './utils';

// ── Connection Testing ──────────────────────────────────────────────────────

export async function testKubeconfigConnection(
	kubeconfigContent: string,
	contextName?: string
): Promise<TestConnectionResult> {
	const result = await withKubeconfig(
		kubeconfigContent,
		contextName,
		async (config: KubeconfigData) => {
			const versionData = await k8sRequest<{ gitVersion?: string }>(config, '/version', 10000);
			const nodesData = await k8sRequest<{ items?: unknown[] }>(config, '/api/v1/nodes', 10000);
			const nsData = await k8sRequest<{ items?: unknown[] }>(config, '/api/v1/namespaces', 10000);

			return {
				version: (versionData.gitVersion || 'Unknown').replace('v', ''),
				nodes: nodesData.items?.length || 0,
				namespaces: nsData.items?.length || 0,
				cluster: config.contextName
			};
		}
	);

	if (!result.success) {
		return { success: false, error: result.error };
	}

	return { success: true, info: result.data };
}

// ── Namespaces ──────────────────────────────────────────────────────────────

type K8sNamespaceList = {
	items: Array<{
		metadata: {
			name?: string;
			creationTimestamp: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		status: {
			phase?: string;
		};
	}>;
};

export async function listNamespaces(clusterId: number): Promise<ListNamespacesResult> {
	const namespacesPath = '/api/v1/namespaces';

	const result = await makeClusterRequest<K8sNamespaceList>(clusterId, namespacesPath, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch namespaces'
		};
	}

	const namespaces = result.data.items.map((ns) => {
		const metadata = ns.metadata || {};
		const status = ns.status || {};

		return {
			name: metadata.name || 'unknown',
			status: status.phase || 'Unknown',
			labels: metadata.labels || {},
			annotations: metadata.annotations || {},
			createdAt: metadata.creationTimestamp
		};
	});

	return { success: true, namespaces };
}

export async function deleteNamespace(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const deletePath = `/api/v1/namespaces/${name}`;

	const result = await makeClusterRequest(clusterId, deletePath, 30000, {
		method: 'DELETE'
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete namespace ${name}`
		};
	}

	return { success: true };
}

// ── Pods ────────────────────────────────────────────────────────────────────

type K8sPodList = {
	items: Array<{
		metadata: {
			name?: string;
			namespace?: string;
			creationTimestamp: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec: {
			nodeName?: string;
			containers?: Array<{
				name?: string;
				image?: string;
			}>;
		};
		status: {
			phase?: string;
			podIP?: string;
			containerStatuses?: Array<{
				name?: string;
				ready?: boolean;
				restartCount?: number;
				state?: Record<string, unknown>;
			}>;
			conditions?: Array<{
				type?: string;
				status?: string;
				reason?: string;
				message?: string;
			}>;
		};
	}>;
};

export async function listPods(clusterId: number, namespace?: string): Promise<ListPodsResult> {
	// Build API path based on namespace filter
	const podsPath =
		namespace === 'all' || !namespace ? '/api/v1/pods' : `/api/v1/namespaces/${namespace}/pods`;

	// Fetch pods (supports all three connection types: kubeconfig, bearer-token, agent)
	const podsResult = await makeClusterRequest<K8sPodList>(clusterId, podsPath, 30000);

	// Check if pods fetch was successful
	if (!podsResult.success || !podsResult.data) {
		return {
			success: false,
			error: podsResult.error ?? 'Failed to fetch pods'
		};
	}

	// Transform Kubernetes pods to our format (no metrics)
	const pods = podsResult.data.items.map((pod) => {
		const metadata = pod.metadata || {};
		const spec = pod.spec || {};
		const status = pod.status || {};

		// Calculate container statuses
		const containerStatuses = status.containerStatuses || [];
		const readyCount = containerStatuses.filter((c) => c.ready).length;
		const totalCount = containerStatuses.length;
		const totalRestarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

		const phase = status.phase || 'Unknown';

		// Determine pod status (check for common error states)
		let podStatus = phase;

		// Check for container issues
		const hasWaiting = containerStatuses.some((c) => c.state?.waiting);
		const hasTerminated = containerStatuses.some((c) => c.state?.terminated);

		if (phase === 'Running' && readyCount < totalCount) {
			podStatus = 'NotReady';
		} else if (hasWaiting) {
			const waitingContainer = containerStatuses.find((c) => c.state?.waiting);
			const waitingState = waitingContainer?.state?.waiting as { reason?: string } | undefined;
			podStatus = waitingState?.reason || 'Waiting';
		} else if (hasTerminated && phase !== 'Succeeded') {
			podStatus = 'Error';
		}

		// Extract container details
		const containers = (spec.containers || []).map((container, idx) => {
			const containerStatus = containerStatuses.find((cs) => cs.name === container.name) || {};
			let state = 'Unknown';
			if (containerStatus.state?.running) state = 'Running';
			else if (containerStatus.state?.waiting) state = 'Waiting';
			else if (containerStatus.state?.terminated) state = 'Terminated';

			return {
				name: container.name || `container-${idx}`,
				image: container.image || 'unknown',
				ready: containerStatus.ready || false,
				restartCount: containerStatus.restartCount || 0,
				state
			};
		});

		const createdAt = metadata.creationTimestamp;

		return {
			name: metadata.name || 'unknown',
			namespace: metadata.namespace || 'default',
			status: podStatus,
			phase,
			ready: `${readyCount}/${totalCount}`,
			restarts: totalRestarts,
			node: spec.nodeName || 'N/A',
			ip: status.podIP || 'N/A',
			labels: metadata.labels || {},
			annotations: metadata.annotations || {},
			containers,
			conditions: (status.conditions || []).map((c) => ({
				type: c.type || 'Unknown',
				status: c.status || 'Unknown',
				reason: c.reason,
				message: c.message
			})),
			createdAt
		};
	});

	return { success: true, pods };
}

export async function deletePod(
	clusterId: number,
	name: string,
	namespace: string = 'default'
): Promise<{ success: boolean; error?: string }> {
	const deletePath = `/api/v1/namespaces/${namespace}/pods/${name}`;

	const result = await makeClusterRequest(clusterId, deletePath, 30000, {
		method: 'DELETE'
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete pod ${name}`
		};
	}

	return { success: true };
}

// ── Deployments ─────────────────────────────────────────────────────────────

type K8sDeploymentList = {
	items: Array<{
		metadata: {
			name?: string;
			namespace?: string;
			creationTimestamp: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec: {
			replicas?: number;
			selector?: { matchLabels?: Record<string, string> };
			strategy?: { type?: string };
			template?: {
				spec?: {
					containers?: Array<{
						name?: string;
						image?: string;
						ports?: Array<{ containerPort?: number; protocol?: string }>;
					}>;
				};
			};
		};
		status: {
			replicas?: number;
			updatedReplicas?: number;
			readyReplicas?: number;
			availableReplicas?: number;
			conditions?: Array<{
				type?: string;
				status?: string;
				reason?: string;
				message?: string;
			}>;
		};
	}>;
};

export async function listDeployments(
	clusterId: number,
	namespace?: string
): Promise<ListDeploymentsResult> {
	const deploymentsPath =
		namespace === 'all' || !namespace
			? '/apis/apps/v1/deployments'
			: `/apis/apps/v1/namespaces/${namespace}/deployments`;

	const result = await makeClusterRequest<K8sDeploymentList>(clusterId, deploymentsPath, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch deployments'
		};
	}

	const deployments = result.data.items.map((deployment) => {
		const metadata = deployment.metadata || {};
		const spec = deployment.spec || {};
		const status = deployment.status || {};

		const replicas = spec.replicas || 0;
		const ready = status.readyReplicas || 0;

		return {
			name: metadata.name || 'unknown',
			namespace: metadata.namespace || 'default',
			ready: `${ready}/${replicas}`,
			upToDate: status.updatedReplicas || 0,
			available: status.availableReplicas || 0,
			labels: metadata.labels || {},
			annotations: metadata.annotations || {},
			replicas,
			updatedReplicas: status.updatedReplicas || 0,
			readyReplicas: ready,
			availableReplicas: status.availableReplicas || 0,
			strategy: spec.strategy?.type || 'RollingUpdate',
			selector: spec.selector?.matchLabels || {},
			containers: (spec.template?.spec?.containers || []).map((c) => ({
				name: c.name || 'unknown',
				image: c.image || 'unknown',
				ports: (c.ports || []).map((p) => ({
					containerPort: p.containerPort || 0,
					protocol: p.protocol || 'TCP'
				}))
			})),
			conditions: (status.conditions || []).map((c) => ({
				type: c.type || 'Unknown',
				status: c.status || 'Unknown',
				reason: c.reason,
				message: c.message
			})),
			createdAt: metadata.creationTimestamp
		};
	});

	return { success: true, deployments };
}

export async function deleteDeployment(
	clusterId: number,
	name: string,
	namespace: string = 'default'
): Promise<{ success: boolean; error?: string }> {
	const deletePath = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;

	const result = await makeClusterRequest(clusterId, deletePath, 30000, {
		method: 'DELETE'
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete deployment ${name}`
		};
	}

	return { success: true };
}

export async function scaleDeployment(
	clusterId: number,
	name: string,
	namespace: string,
	replicas: number
): Promise<{ success: boolean; error?: string }> {
	const scalePath = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}/scale`;

	const body = JSON.stringify({
		spec: {
			replicas
		}
	});

	const result = await makeClusterRequest(clusterId, scalePath, 30000, {
		method: 'PATCH',
		body,
		headers: {
			'Content-Type': 'application/merge-patch+json'
		}
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to scale deployment ${name}`
		};
	}

	return { success: true };
}

export async function restartDeployment(
	clusterId: number,
	name: string,
	namespace: string
): Promise<{ success: boolean; error?: string }> {
	const patchPath = `/apis/apps/v1/namespaces/${namespace}/deployments/${name}`;

	const now = new Date().toISOString();
	const body = JSON.stringify({
		spec: {
			template: {
				metadata: {
					annotations: {
						'kubectl.kubernetes.io/restartedAt': now
					}
				}
			}
		}
	});

	const result = await makeClusterRequest(clusterId, patchPath, 30000, {
		method: 'PATCH',
		body,
		headers: {
			'Content-Type': 'application/merge-patch+json'
		}
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to restart deployment ${name}`
		};
	}

	return { success: true };
}
