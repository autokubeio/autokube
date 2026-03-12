export type Role = {
	id: string;
	name: string;
	namespace: string;
	rules: Array<{
		apiGroups?: string[];
		resources?: string[];
		verbs: string[];
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type RoleWithAge = Role & { age: string };

/**
 * Format rule verbs for compact display
 */
export function formatVerbs(verbs: string[]): string {
	if (verbs.includes('*')) return '*';
	return verbs.join(', ');
}

/**
 * Format resources for compact display
 */
export function formatResources(resources?: string[]): string {
	if (!resources || resources.length === 0) return '*';
	return resources.join(', ');
}

/**
 * Format API groups for compact display
 */
export function formatApiGroups(apiGroups?: string[]): string {
	if (!apiGroups || apiGroups.length === 0) return 'core';
	return apiGroups.map((g) => (g === '' ? 'core' : g)).join(', ');
}
