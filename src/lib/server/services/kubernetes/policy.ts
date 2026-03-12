/**
 * Kubernetes Policy Resources
 * NetworkPolicies
 */

import type { ListNetworkPoliciesResult } from './types';
import { makeClusterRequest } from './utils';

// ── NetworkPolicies ─────────────────────────────────────────────────────────

type K8sNetworkPolicyList = {
	items: Array<{
		metadata: {
			name?: string;
			namespace?: string;
			creationTimestamp: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec: {
			podSelector?: unknown;
			policyTypes?: string[];
			ingress?: unknown[];
			egress?: unknown[];
		};
	}>;
};

export async function listNetworkPolicies(
	clusterId: number,
	namespace?: string
): Promise<ListNetworkPoliciesResult> {
	const networkPoliciesPath =
		namespace === 'all' || !namespace
			? '/apis/networking.k8s.io/v1/networkpolicies'
			: `/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies`;

	const result = await makeClusterRequest<K8sNetworkPolicyList>(
		clusterId,
		networkPoliciesPath,
		30000
	);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch network policies'
		};
	}

	const networkPolicies = result.data.items.map((item) => {
		const metadata = item.metadata || {};
		const spec = item.spec || {};

		return {
			name: metadata.name || 'unknown',
			namespace: metadata.namespace || 'default',
			podSelector: spec.podSelector || {},
			policyTypes: spec.policyTypes || [],
			ingress: spec.ingress || [],
			egress: spec.egress || [],
			labels: metadata.labels || {},
			annotations: metadata.annotations || {},
			createdAt: metadata.creationTimestamp
		};
	});

	return { success: true, networkPolicies };
}

export async function deleteNetworkPolicy(
	clusterId: number,
	name: string,
	namespace: string = 'default'
): Promise<{ success: boolean; error?: string }> {
	const deletePath = `/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies/${name}`;

	const result = await makeClusterRequest(clusterId, deletePath, 30000, {
		method: 'DELETE'
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete network policy ${name}`
		};
	}

	return { success: true };
}
