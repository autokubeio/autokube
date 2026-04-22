import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { makeClusterRequest } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';
import { findCluster } from '$lib/server/queries/clusters';

type K8sVersion = {
	major: string;
	minor: string;
	gitVersion?: string;
};

type K8sNodeList = {
	items: Array<{
		metadata: { name: string };
		status: {
			conditions?: Array<{
				type: string;
				status: string;
			}>;
			capacity?: {
				cpu?: string;
				memory?: string;
				'ephemeral-storage'?: string;
			};
			allocatable?: {
				cpu?: string;
				memory?: string;
				'ephemeral-storage'?: string;
			};
		};
	}>;
};

type K8sNamespaceList = {
	items: Array<{
		metadata: { name: string };
	}>;
};

type K8sPodList = {
	items: Array<{
		metadata: { name: string; namespace: string };
		status: { phase?: string };
	}>;
};

type K8sNodeMetricsList = {
	items: Array<{
		metadata: { name: string };
		usage?: {
			cpu?: string;
			memory?: string;
		};
	}>;
};

/** Parse CPU string to millicores */
function parseCpuToMillicores(cpu: string): number {
	if (!cpu) return 0;
	// Nanocores (e.g. "3500000000n") → millicores
	if (cpu.endsWith('n')) {
		const nc = parseInt(cpu.slice(0, -1));
		return isNaN(nc) ? 0 : Math.round(nc / 1_000_000);
	}
	// Millicores (e.g. "3500m")
	if (cpu.endsWith('m')) {
		const mc = parseInt(cpu.slice(0, -1));
		return isNaN(mc) ? 0 : mc;
	}
	// Bare number: standard K8s capacity returns whole cores (e.g. "4").
	// Some non-standard metrics servers return fractional millicores without a
	// unit suffix (e.g. "109617.3" meaning 109617 millicores, not 109617 cores).
	// Heuristic: no realistic single node has >1000 CPU cores, so values above
	// that threshold are treated as millicores rather than cores.
	const val = parseFloat(cpu);
	if (isNaN(val)) return 0;
	if (val > 1000) return Math.round(val);
	return Math.round(val * 1000);
}

/** Parse memory string to bytes */
function parseMemoryToBytes(mem: string): number {
	if (!mem) return 0;
	if (mem.endsWith('Ki')) return parseInt(mem) * 1024;
	if (mem.endsWith('Mi')) return parseInt(mem) * 1024 * 1024;
	if (mem.endsWith('Gi')) return parseInt(mem) * 1024 * 1024 * 1024;
	if (mem.endsWith('Ti')) return parseInt(mem) * 1024 * 1024 * 1024 * 1024;
	return parseInt(mem) || 0;
}

/**
 * GET /api/clusters/[id]/info
 * Get cluster metadata: version, node count, namespace count, health status
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !await auth.canAccessCluster(clusterId)) {
		return json({ error: 'Cluster access denied' }, { status: 403 });
	}

	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	try {
		// Check if metrics-server integration is enabled for this cluster
		const clusterRecord = await findCluster(clusterId);
		const metricsEnabled = clusterRecord?.metricsEnabled !== false;

		// Fetch version, nodes, namespaces, pods, and node metrics in parallel
		const [versionResult, nodesResult, namespacesResult, podsResult, nodeMetricsResult] =
			await Promise.allSettled([
				makeClusterRequest<K8sVersion>(clusterId, '/version', 10000),
				makeClusterRequest<K8sNodeList>(clusterId, '/api/v1/nodes', 10000),
				makeClusterRequest<K8sNamespaceList>(clusterId, '/api/v1/namespaces', 10000),
				makeClusterRequest<K8sPodList>(clusterId, '/api/v1/pods', 10000),
				metricsEnabled
					? makeClusterRequest<K8sNodeMetricsList>(
							clusterId,
							'/apis/metrics.k8s.io/v1beta1/nodes',
							10000
						)
					: Promise.reject(new Error('metrics disabled'))
			]);

		// Extract version
		let version = 'Unknown';
		let status: 'connected' | 'disconnected' | 'warning' | 'unknown' = 'unknown';

		if (
			versionResult.status === 'fulfilled' &&
			versionResult.value.success &&
			versionResult.value.data
		) {
			const v = versionResult.value.data;
			version = v.gitVersion || `v${v.major}.${v.minor}`;
			status = 'connected';
		} else {
			status = 'disconnected';
		}

		// Count nodes and check health + aggregate capacity
		let nodes = 0;
		let health: 'Healthy' | 'Degraded' | 'Unhealthy' | 'Unknown' = 'Unknown';
		let cpuCapacityMillis = 0;
		let memCapacityBytes = 0;
		let diskCapacityBytes = 0;
		let diskAllocatableBytes = 0;

		if (nodesResult.status === 'fulfilled' && nodesResult.value.success && nodesResult.value.data) {
			const nodeList = nodesResult.value.data.items;
			nodes = nodeList.length;

			// Check node health
			const readyNodes = nodeList.filter((node) => {
				const readyCondition = node.status.conditions?.find((c) => c.type === 'Ready');
				return readyCondition?.status === 'True';
			});

			if (nodes > 0) {
				const readyRatio = readyNodes.length / nodes;
				if (readyRatio === 1) {
					health = 'Healthy';
				} else if (readyRatio >= 0.5) {
					health = 'Degraded';
					status = 'warning';
				} else {
					health = 'Unhealthy';
					status = 'warning';
				}
			}

			// Aggregate capacity from all nodes
			for (const node of nodeList) {
				const cap = node.status.capacity;
				const alloc = node.status.allocatable;
				if (cap) {
					cpuCapacityMillis += parseCpuToMillicores(cap.cpu || '0');
					memCapacityBytes += parseMemoryToBytes(cap.memory || '0');
					diskCapacityBytes += parseMemoryToBytes(cap['ephemeral-storage'] || '0');
				}
				if (alloc) {
					diskAllocatableBytes += parseMemoryToBytes(alloc['ephemeral-storage'] || '0');
				}
			}
		}

		// Count namespaces
		let namespaces = 0;
		if (
			namespacesResult.status === 'fulfilled' &&
			namespacesResult.value.success &&
			namespacesResult.value.data
		) {
			namespaces = namespacesResult.value.data.items.length;
		}

		// Count pods
		let pods = 0;
		let runningPods = 0;
		if (podsResult.status === 'fulfilled' && podsResult.value.success && podsResult.value.data) {
			pods = podsResult.value.data.items.length;
			runningPods = podsResult.value.data.items.filter((p) => p.status.phase === 'Running').length;
		}

		// Aggregate node metrics usage
		let cpuUsageMillis = 0;
		let memUsageBytes = 0;
		let metricsAvailable = false;

		if (
			nodeMetricsResult.status === 'fulfilled' &&
			nodeMetricsResult.value.success &&
			nodeMetricsResult.value.data
		) {
			metricsAvailable = true;
			for (const node of nodeMetricsResult.value.data.items) {
				const usage = node.usage;
				if (usage) {
					cpuUsageMillis += parseCpuToMillicores(usage.cpu || '0');
					memUsageBytes += parseMemoryToBytes(usage.memory || '0');
				}
			}
		}

		return json({
			version,
			nodes,
			namespaces,
			pods,
			runningPods,
			status,
			health,
			cpuCapacity: Math.round(cpuCapacityMillis),
			cpuUsage: Math.round(cpuUsageMillis),
			memoryCapacity: memCapacityBytes,
			memoryUsage: memUsageBytes,
			diskCapacity: diskCapacityBytes,
			diskUsage: diskCapacityBytes - diskAllocatableBytes,
			metricsAvailable
		});
	} catch (error) {
		console.error('[API] Cluster info error:', error);
		return json({
			version: 'Unknown',
			pods: 0,
			runningPods: 0,
			nodes: 0,
			namespaces: 0,
			status: 'disconnected',
			health: 'Unknown',
			cpuCapacity: 0,
			cpuUsage: 0,
			memoryCapacity: 0,
			memoryUsage: 0,
			diskCapacity: 0,
			diskUsage: 0,
			metricsAvailable: false
		});
	}
};
