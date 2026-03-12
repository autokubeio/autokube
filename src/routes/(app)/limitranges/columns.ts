export type LimitEntry = {
	type: string;
	max?: Record<string, string>;
	min?: Record<string, string>;
	default?: Record<string, string>;
	defaultRequest?: Record<string, string>;
};

export type LimitRange = {
	id: string;
	name: string;
	namespace: string;
	limits: LimitEntry[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type LimitRangeWithAge = LimitRange & { age: string };

/**
 * Get a color class for a limit type (Container, Pod, PersistentVolumeClaim)
 */
export function getLimitTypeColor(type: string): string {
	const map: Record<string, string> = {
		Container:
			'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
		Pod: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
		PersistentVolumeClaim:
			'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
	};
	return map[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

/**
 * Get a short label for PersistentVolumeClaim
 */
export function getLimitTypeShort(type: string): string {
	if (type === 'PersistentVolumeClaim') return 'PVC';
	return type;
}
