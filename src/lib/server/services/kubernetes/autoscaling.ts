/**
 * Kubernetes Autoscaling Resources
 * HorizontalPodAutoscalers
 */

import type { ListHorizontalPodAutoscalersResult } from './types';
import { makeClusterRequest } from './utils';

// ── HorizontalPodAutoscalers ────────────────────────────────────────────────

type K8sHPAList = {
	items: Array<{
		metadata: {
			name?: string;
			namespace?: string;
			creationTimestamp: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec: {
			minReplicas?: number;
			maxReplicas?: number;
			scaleTargetRef?: {
				kind?: string;
				name?: string;
			};
			metrics?: unknown[];
		};
		status: {
			currentReplicas?: number;
			desiredReplicas?: number;
			conditions?: Array<{
				type?: string;
				status?: string;
				reason?: string;
				message?: string;
			}>;
		};
	}>;
};

export async function listHorizontalPodAutoscalers(
	clusterId: number,
	namespace?: string
): Promise<ListHorizontalPodAutoscalersResult> {
	const hpaPath =
		namespace === 'all' || !namespace
			? '/apis/autoscaling/v2/horizontalpodautoscalers'
			: `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers`;

	const result = await makeClusterRequest<K8sHPAList>(clusterId, hpaPath, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch horizontal pod autoscalers'
		};
	}

	const hpas = result.data.items.map((item) => {
		const metadata = item.metadata || {};
		const spec = item.spec || {};
		const status = item.status || {};

		const scaleTargetRef = spec.scaleTargetRef || {};
		const reference = `${scaleTargetRef.kind || 'Unknown'}/${scaleTargetRef.name || 'Unknown'}`;

		return {
			id: `${metadata.namespace || 'default'}/${metadata.name || 'unknown'}`,
			name: metadata.name || 'unknown',
			namespace: metadata.namespace || 'default',
			reference,
			minPods: spec.minReplicas || 0,
			maxPods: spec.maxReplicas || 0,
			currentReplicas: status.currentReplicas || 0,
			desiredReplicas: status.desiredReplicas || 0,
			labels: metadata.labels || {},
			annotations: metadata.annotations || {},
			metrics: spec.metrics || [],
			conditions: (status.conditions || []).map((c) => ({
				type: c.type || 'Unknown',
				status: c.status || 'Unknown',
				reason: c.reason,
				message: c.message
			})),
			createdAt: metadata.creationTimestamp
		};
	});

	return { success: true, hpas };
}

export async function deleteHorizontalPodAutoscaler(
	clusterId: number,
	name: string,
	namespace: string = 'default'
): Promise<{ success: boolean; error?: string }> {
	const deletePath = `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/${name}`;

	const result = await makeClusterRequest(clusterId, deletePath, 30000, {
		method: 'DELETE'
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete HPA ${name}`
		};
	}

	return { success: true };
}
