import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { listNodes, listNodeMetrics } from '$lib/server/services/kubernetes';
import { makeClusterRequest } from '$lib/server/services/kubernetes/utils';

interface K8sPodItem {
	metadata: {
		name?: string;
		namespace?: string;
		labels?: Record<string, string>;
		creationTimestamp?: string;
		ownerReferences?: Array<{ kind: string; name: string }>;
	};
	spec: {
		nodeName?: string;
		containers?: Array<{
			name: string;
			resources?: {
				requests?: { cpu?: string; memory?: string };
				limits?: { cpu?: string; memory?: string };
			};
		}>;
	};
	status: {
		phase?: string;
		containerStatuses?: Array<{ ready: boolean; restartCount: number }>;
	};
}

/**
 * GET /api/clusters/[id]/pod-distribution
 * Returns nodes with their pods, resource usage, and metrics for distribution visualization
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	const clusterId = parseInt(params.id);
	if (auth.authEnabled && !(await auth.can('pods', 'read', clusterId))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	try {
		// Fetch nodes, pods, and metrics in parallel
		const [nodesResult, podsResult, metricsResult] = await Promise.all([
			listNodes(clusterId),
			makeClusterRequest<{ items: K8sPodItem[] }>(clusterId, '/api/v1/pods', 30000),
			listNodeMetrics(clusterId)
		]);

		if (!nodesResult.success) {
			return json({ success: false, error: nodesResult.error || 'Failed to fetch nodes' }, { status: 500 });
		}

		// Build metrics map (nodeName -> usage)
		const nodeMetricsMap = new Map<string, { cpu: string; memory: string }>();
		if (metricsResult.success && metricsResult.metrics) {
			for (const m of metricsResult.metrics) {
				nodeMetricsMap.set(m.name, { cpu: m.cpu, memory: m.memory });
			}
		}

		// Group pods by node
		const podsByNode = new Map<string, Array<{
			name: string;
			namespace: string;
			phase: string;
			ready: string;
			restarts: number;
			ownerKind: string;
			ownerName: string;
			cpuRequest: string;
			memoryRequest: string;
			createdAt: string;
		}>>();

		if (podsResult.success && podsResult.data) {
			for (const pod of podsResult.data.items) {
				const nodeName = pod.spec?.nodeName;
				if (!nodeName) continue;

				const containerStatuses = pod.status?.containerStatuses || [];
				const readyCount = containerStatuses.filter((c) => c.ready).length;
				const totalCount = containerStatuses.length;
				const totalRestarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

				// Sum resource requests across containers
				let totalCpuRequest = 0;
				let totalMemoryRequest = 0;
				for (const container of pod.spec?.containers || []) {
					const requests = container.resources?.requests;
					if (requests?.cpu) {
						totalCpuRequest += parseCpuToMillicores(requests.cpu);
					}
					if (requests?.memory) {
						totalMemoryRequest += parseMemoryToBytes(requests.memory);
					}
				}

				const owner = pod.metadata?.ownerReferences?.[0];

				if (!podsByNode.has(nodeName)) podsByNode.set(nodeName, []);
				podsByNode.get(nodeName)!.push({
					name: pod.metadata?.name || 'unknown',
					namespace: pod.metadata?.namespace || 'default',
					phase: pod.status?.phase || 'Unknown',
					ready: `${readyCount}/${totalCount}`,
					restarts: totalRestarts,
					ownerKind: owner?.kind || '',
					ownerName: owner?.name || '',
					cpuRequest: totalCpuRequest > 0 ? `${totalCpuRequest}m` : '0m',
					memoryRequest: totalMemoryRequest > 0 ? `${Math.round(totalMemoryRequest / (1024 * 1024))}Mi` : '0Mi',
					createdAt: pod.metadata?.creationTimestamp || ''
				});
			}
		}

		// Build response: nodes with their pods and metrics
		const nodes = (nodesResult.nodes ?? []).map((node) => {
			const pods = podsByNode.get(node.name) || [];
			const metrics = nodeMetricsMap.get(node.name);

			return {
				name: node.name,
				status: node.status,
				roles: node.roles,
				version: node.version,
				internalIP: node.internalIP,
				cpuCapacity: node.cpuCapacity,
				memoryCapacity: node.memoryCapacity,
				podsCapacity: node.podsCapacity,
				cpuAllocatable: node.cpuAllocatable,
				memoryAllocatable: node.memoryAllocatable,
				podsAllocatable: node.podsAllocatable,
				unschedulable: node.unschedulable,
				taints: node.taints,
				cpuUsage: metrics?.cpu || '',
				memoryUsage: metrics?.memory || '',
				pods,
				podCount: pods.length
			};
		});

		return json({ success: true, nodes });
	} catch (err) {
		console.error('[PodDistribution] Error:', err);
		return json({ success: false, error: 'Failed to fetch pod distribution data' }, { status: 500 });
	}
};

function parseCpuToMillicores(cpu: string): number {
	if (!cpu) return 0;
	if (cpu.endsWith('m')) return parseInt(cpu.slice(0, -1)) || 0;
	if (cpu.endsWith('n')) return Math.round((parseInt(cpu.slice(0, -1)) || 0) / 1_000_000);
	const cores = parseFloat(cpu);
	return isNaN(cores) ? 0 : Math.round(cores * 1000);
}

function parseMemoryToBytes(mem: string): number {
	if (!mem) return 0;
	if (mem.endsWith('Ki')) return (parseInt(mem.slice(0, -2)) || 0) * 1024;
	if (mem.endsWith('Mi')) return (parseInt(mem.slice(0, -2)) || 0) * 1024 * 1024;
	if (mem.endsWith('Gi')) return (parseInt(mem.slice(0, -2)) || 0) * 1024 * 1024 * 1024;
	if (mem.endsWith('Ti')) return (parseInt(mem.slice(0, -2)) || 0) * 1024 * 1024 * 1024 * 1024;
	return parseInt(mem) || 0;
}
