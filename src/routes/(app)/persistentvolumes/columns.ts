export type PV = {
	id: string;
	name: string;
	capacity: string;
	accessModes: string[];
	reclaimPolicy: string;
	status: string;
	claim: string;
	storageClass: string;
	volumeMode: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type PVWithAge = PV & { age: string };

/**
 * Get status color for PV phase
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Available: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
		Bound: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
		Released: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
		Failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
	};
	return map[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

/**
 * Get reclaim policy color
 */
export function getReclaimPolicyColor(policy: string): string {
	const map: Record<string, string> = {
		Retain: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
		Delete: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
		Recycle: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
	};
	return map[policy] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

/**
 * Format access modes for display (e.g. "ReadWriteOnce" -> "RWO")
 */
export function formatAccessMode(mode: string): string {
	const map: Record<string, string> = {
		ReadWriteOnce: 'RWO',
		ReadOnlyMany: 'ROX',
		ReadWriteMany: 'RWX',
		ReadWriteOncePod: 'RWOP'
	};
	return map[mode] || mode;
}
