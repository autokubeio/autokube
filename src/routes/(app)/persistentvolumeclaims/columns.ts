export type PVC = {
	id: string;
	name: string;
	namespace: string;
	status: string;
	volume: string;
	capacity: string;
	accessModes: string[];
	storageClass: string;
	volumeMode: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type PVCWithAge = PVC & { age: string };

/**
 * Get status color for PVC phase
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Bound: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
		Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
		Lost: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
	};
	return map[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
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
