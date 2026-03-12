export type StorageClass = {
	id: string;
	name: string;
	provisioner: string;
	reclaimPolicy: string;
	volumeBindingMode: string;
	allowVolumeExpansion: boolean;
	isDefault: boolean;
	parameters: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type StorageClassWithAge = StorageClass & { age: string };

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
 * Get volume binding mode color
 */
export function getBindingModeColor(mode: string): string {
	const map: Record<string, string> = {
		Immediate: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
		WaitForFirstConsumer:
			'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
	};
	return map[mode] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

/**
 * Format volume binding mode for short display
 */
export function formatBindingMode(mode: string): string {
	const map: Record<string, string> = {
		Immediate: 'Immediate',
		WaitForFirstConsumer: 'WaitForConsumer'
	};
	return map[mode] || mode;
}
