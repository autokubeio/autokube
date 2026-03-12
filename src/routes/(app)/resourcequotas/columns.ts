export type ResourceQuota = {
	id: string;
	name: string;
	namespace: string;
	hard: Record<string, string>;
	used: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type ResourceQuotaWithAge = ResourceQuota & { age: string };

/**
 * Format a resource name for display (e.g. "requests.cpu" -> "Requests CPU")
 */
export function formatResourceName(name: string): string {
	return name
		.replace(/\./g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get usage percentage for a quota resource
 */
export function getUsagePercent(used: string, hard: string): number {
	const usedNum = parseResourceValue(used);
	const hardNum = parseResourceValue(hard);
	if (hardNum === 0) return 0;
	return Math.min(Math.round((usedNum / hardNum) * 100), 100);
}

/**
 * Get color class based on usage percentage
 */
export function getUsageColor(percent: number): string {
	if (percent >= 90) return 'text-red-600 dark:text-red-400';
	if (percent >= 75) return 'text-amber-600 dark:text-amber-400';
	return 'text-green-600 dark:text-green-400';
}

/**
 * Parse a Kubernetes resource value to a number for comparison.
 * Handles suffixes like Ki, Mi, Gi, m, etc.
 */
function parseResourceValue(val: string): number {
	if (!val) return 0;
	const num = parseFloat(val);
	if (isNaN(num)) return 0;

	if (val.endsWith('Ki')) return num * 1024;
	if (val.endsWith('Mi')) return num * 1024 * 1024;
	if (val.endsWith('Gi')) return num * 1024 * 1024 * 1024;
	if (val.endsWith('Ti')) return num * 1024 * 1024 * 1024 * 1024;
	if (val.endsWith('m')) return num / 1000;
	if (val.endsWith('k')) return num * 1000;
	if (val.endsWith('M')) return num * 1000000;
	if (val.endsWith('G')) return num * 1000000000;

	return num;
}
