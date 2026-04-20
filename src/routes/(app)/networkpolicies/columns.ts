export type NetworkPolicy = {
	name: string;
	namespace: string;
	podSelector: Record<string, any>;
	policyTypes: string[];
	ingress: any[];
	egress: any[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type NetworkPolicyWithAge = NetworkPolicy & { age: string; id: string };

/**
 * Format policy types for display
 */
export function formatPolicyTypes(types: string[]): string {
	return types.length > 0 ? types.join(', ') : 'None';
}

/**
 * Format pod selector for display
 */
export function formatPodSelector(selector: Record<string, any>): string {
	if (!selector || typeof selector !== 'object') return '<none>';
	const matchLabels = selector.matchLabels || selector;
	const entries = Object.entries(matchLabels);
	if (entries.length === 0) return '<all pods>';
	return entries.map(([k, v]) => `${k}=${v}`).join(', ');
}
