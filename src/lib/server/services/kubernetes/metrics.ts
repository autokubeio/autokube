/**
 * Kubernetes Metrics & Cluster Resources
 * Nodes, NodeMetrics, PodMetrics
 */

import type {
	NodeInfo,
	PodMetrics,
	NodeMetrics,
	ListNodesResult,
	ListPodMetricsResult,
	ListNodeMetricsResult
} from './types';
import { makeClusterRequest } from './utils';

// ── Type Definitions ────────────────────────────────────────────────────────

type K8sCondition = {
	type?: string;
	status?: string;
	lastTransitionTime?: string;
	reason?: string;
	message?: string;
};

type K8sNodeList = {
	items: Array<{
		metadata: {
			name: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			taints?: Array<{
				key?: string;
				value?: string;
				effect?: string;
			}>;
			unschedulable?: boolean;
		};
		status?: {
			conditions?: K8sCondition[];
			nodeInfo?: {
				kubeletVersion?: string;
				osImage?: string;
				kernelVersion?: string;
				containerRuntimeVersion?: string;
			};
			capacity?: {
				cpu?: string;
				memory?: string;
				pods?: string;
				'ephemeral-storage'?: string;
			};
			allocatable?: {
				cpu?: string;
				memory?: string;
				pods?: string;
				'ephemeral-storage'?: string;
			};
			addresses?: Array<{
				type?: string;
				address?: string;
			}>;
		};
	}>;
};

type K8sPodMetricsList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
		};
		containers?: Array<{
			name?: string;
			usage?: {
				cpu?: string;
				memory?: string;
			};
		}>;
	}>;
};

type K8sNodeMetricsList = {
	items: Array<{
		metadata: {
			name: string;
		};
		usage?: {
			cpu?: string;
			memory?: string;
		};
	}>;
};

// ── Helper Functions ────────────────────────────────────────────────────────

function extractConditions(status?: { conditions?: K8sCondition[] }) {
	if (!status?.conditions) return [];
	return status.conditions.map((c) => ({
		type: c.type || '',
		status: c.status || '',
		lastTransitionTime: c.lastTransitionTime || '',
		reason: c.reason,
		message: c.message
	}));
}

// Helper to format CPU from nanocores to millicores
function formatCpu(cpuString: string): string {
	if (!cpuString) return '0m';
	if (cpuString.endsWith('n')) {
		const nanocores = parseInt(cpuString.slice(0, -1));
		const millicores = Math.round(nanocores / 1000000);
		return `${millicores}m`;
	}
	return cpuString;
}

// Helper to format memory to Mi
function formatMemory(memoryString: string): string {
	if (!memoryString) return '0Mi';
	if (memoryString.endsWith('Ki')) {
		const kilobytes = parseInt(memoryString.slice(0, -2));
		const megabytes = Math.round(kilobytes / 1024);
		return `${megabytes}Mi`;
	}
	return memoryString;
}

// ── Nodes ───────────────────────────────────────────────────────────────────

export async function listNodes(clusterId: number): Promise<ListNodesResult> {
	const path = '/api/v1/nodes';

	const [result, podsResult] = await Promise.all([
		makeClusterRequest<K8sNodeList>(clusterId, path, 30000),
		makeClusterRequest<{ items: Array<{ spec?: { nodeName?: string } }> }>(clusterId, '/api/v1/pods', 30000)
	]);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch nodes',
			nodes: []
		};
	}

	// Count pods per node
	const podCountByNode = new Map<string, number>();
	if (podsResult.success && podsResult.data) {
		for (const pod of podsResult.data.items) {
			const nodeName = pod.spec?.nodeName;
			if (nodeName) {
				podCountByNode.set(nodeName, (podCountByNode.get(nodeName) || 0) + 1);
			}
		}
	}

	const nodes: NodeInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		// Determine node status
		const conditions = status.conditions || [];
		const readyCondition = conditions.find((c) => c.type === 'Ready');
		const nodeStatus = readyCondition?.status === 'True' ? 'Ready' : 'NotReady';

		// Get node info
		const nodeInfo = status.nodeInfo || {};
		const version = nodeInfo.kubeletVersion || 'Unknown';

		// Get capacity and allocatable
		const capacity = status.capacity || {};
		const allocatable = status.allocatable || {};

		// Get addresses
		const addresses = (status.addresses || []).map((a) => ({
			type: a.type || 'Unknown',
			address: a.address || ''
		}));

		const internalIP = addresses.find((a) => a.type === 'InternalIP')?.address || 'Unknown';

		// Count pods running on this node
		const podsCount = podCountByNode.get(item.metadata.name) || 0;

		return {
			name: item.metadata.name,
			status: nodeStatus,
			roles: item.metadata.labels?.['node-role.kubernetes.io/control-plane']
				? ['control-plane']
				: ['worker'],
			version,
			internalIP,
			osImage: nodeInfo.osImage || 'Unknown',
			kernelVersion: nodeInfo.kernelVersion || 'Unknown',
			containerRuntime: nodeInfo.containerRuntimeVersion || 'Unknown',
			cpuCapacity: capacity.cpu || '0',
			memoryCapacity: capacity.memory || '0',
			podsCapacity: capacity.pods || '0',
			diskCapacity: capacity['ephemeral-storage'] || '0',
			podsCount,
			cpuAllocatable: allocatable.cpu || '0',
			memoryAllocatable: allocatable.memory || '0',
			podsAllocatable: allocatable.pods || '0',
			diskAllocatable: allocatable['ephemeral-storage'] || '0',
			conditions: extractConditions(status),
			addresses,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString(),
			taints: (spec.taints || []).map((t) => ({
				key: t.key || '',
				value: t.value,
				effect: t.effect || ''
			})),
			unschedulable: spec.unschedulable === true
		};
	});

	return { success: true, nodes };
}

// ── PodMetrics ──────────────────────────────────────────────────────────────

export async function listPodMetrics(
	clusterId: number,
	namespace?: string
): Promise<ListPodMetricsResult> {
	// Handle 'all' namespace by treating it as undefined
	const effectiveNamespace = namespace === 'all' ? undefined : namespace;

	const path = effectiveNamespace
		? `/apis/metrics.k8s.io/v1beta1/namespaces/${effectiveNamespace}/pods`
		: '/apis/metrics.k8s.io/v1beta1/pods';

	const result = await makeClusterRequest<K8sPodMetricsList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch pod metrics',
			metrics: []
		};
	}

	const metrics: PodMetrics[] = result.data.items.map((item) => {
		const containers = item.containers || [];

		const containerMetrics = containers.map((container) => ({
			name: container.name || 'unknown',
			cpu: formatCpu(container.usage?.cpu || '0'),
			memory: formatMemory(container.usage?.memory || '0')
		}));

		// Sum total pod metrics
		let totalCpuNano = 0;
		let totalMemoryKi = 0;

		containers.forEach((container) => {
			const cpuStr = container.usage?.cpu || '0';
			const memStr = container.usage?.memory || '0';

			if (cpuStr.endsWith('n')) {
				totalCpuNano += parseInt(cpuStr.slice(0, -1));
			} else if (cpuStr.endsWith('m')) {
				totalCpuNano += parseInt(cpuStr.slice(0, -1)) * 1000000;
			}

			if (memStr.endsWith('Ki')) {
				totalMemoryKi += parseInt(memStr.slice(0, -2));
			} else if (memStr.endsWith('Mi')) {
				totalMemoryKi += parseInt(memStr.slice(0, -2)) * 1024;
			}
		});

		return {
			name: item.metadata.name || 'unknown',
			namespace: item.metadata.namespace || 'default',
			cpu: formatCpu(`${totalCpuNano}n`),
			memory: formatMemory(`${totalMemoryKi}Ki`),
			containers: containerMetrics
		};
	});

	return { success: true, metrics };
}

// ── NodeMetrics ─────────────────────────────────────────────────────────────

export async function listNodeMetrics(clusterId: number): Promise<ListNodeMetricsResult> {
	const path = '/apis/metrics.k8s.io/v1beta1/nodes';

	const result = await makeClusterRequest<K8sNodeMetricsList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch node metrics',
			metrics: []
		};
	}

	const metrics: NodeMetrics[] = result.data.items.map((item) => {
		const usage = item.usage || {};

		return {
			name: item.metadata.name || 'unknown',
			cpu: formatCpu(usage.cpu || '0'),
			memory: formatMemory(usage.memory || '0')
		};
	});

	return { success: true, metrics };
}

// ── Node Operations ──────────────────────────────────────────────────────────

/**
 * Cordon or uncordon a node by setting spec.unschedulable.
 */
export async function cordonNode(
	clusterId: number,
	nodeName: string,
	unschedulable: boolean
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/nodes/${nodeName}`;

	// Use GET + PUT instead of PATCH so it works with agent clusters whose
	// HTTP client may not properly forward non-JSON Content-Type headers.
	const getResult = await makeClusterRequest<Record<string, unknown>>(clusterId, path, 15000);
	if (!getResult.success || !getResult.data) {
		return {
			success: false,
			error: getResult.error ?? `Failed to get node ${nodeName}`
		};
	}

	const node = getResult.data;
	(node.spec as Record<string, unknown>).unschedulable = unschedulable;

	// Remove managedFields to reduce payload and avoid update conflicts
	const metadata = node.metadata as Record<string, unknown>;
	if (metadata) delete metadata.managedFields;

	const body = JSON.stringify(node);
	const result = await makeClusterRequest(clusterId, path, 15000, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to ${unschedulable ? 'cordon' : 'uncordon'} node ${nodeName}`
		};
	}
	return { success: true };
}

/**
 * Drain a node: cordon it, then evict all non-DaemonSet / non-mirror pods.
 * Uses the Eviction API so PodDisruptionBudgets are respected.
 */
export async function drainNode(
	clusterId: number,
	nodeName: string
): Promise<{ success: boolean; evicted: number; skipped: number; error?: string }> {
	// Step 1: cordon
	const cordonResult = await cordonNode(clusterId, nodeName, true);
	if (!cordonResult.success) {
		return { success: false, evicted: 0, skipped: 0, error: cordonResult.error };
	}

	// Step 2: list pods on this node
	const podsResult = await makeClusterRequest<{
		items: Array<{
			metadata: {
				name: string;
				namespace?: string;
				ownerReferences?: Array<{ kind?: string }>;
				annotations?: Record<string, string>;
			};
		}>;
	}>(clusterId, `/api/v1/pods?fieldSelector=spec.nodeName%3D${nodeName}`, 30000);

	if (!podsResult.success || !podsResult.data) {
		return {
			success: false,
			evicted: 0,
			skipped: 0,
			error: podsResult.error ?? 'Failed to list pods on node'
		};
	}

	const pods = podsResult.data.items;
	let evicted = 0;
	let skipped = 0;

	for (const pod of pods) {
		const { name, namespace = 'default', ownerReferences, annotations } = pod.metadata;

		// Skip DaemonSet pods
		if (ownerReferences?.some((ref) => ref.kind === 'DaemonSet')) {
			skipped++;
			continue;
		}

		// Skip mirror pods (static pods)
		if (annotations?.['kubernetes.io/config.mirror']) {
			skipped++;
			continue;
		}

		// Evict via Eviction API
		const evictResult = await makeClusterRequest(
			clusterId,
			`/api/v1/namespaces/${namespace}/pods/${name}/eviction`,
			15000,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiVersion: 'policy/v1',
					kind: 'Eviction',
					metadata: { name, namespace }
				})
			}
		);

		if (evictResult.success) {
			evicted++;
		} else {
			// Fall back to DELETE if eviction returns a non-retryable error
			const deleteResult = await makeClusterRequest(
				clusterId,
				`/api/v1/namespaces/${namespace}/pods/${name}`,
				15000,
				{ method: 'DELETE' }
			);
			if (deleteResult.success) evicted++;
			else skipped++;
		}
	}

	return { success: true, evicted, skipped };
}