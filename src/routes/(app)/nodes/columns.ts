import { CheckCircle2, CircleX, HelpCircle } from 'lucide-svelte';

export type Node = {
	name: string;
	status: string;
	roles: string[];
	version: string;
	internalIP: string;
	osImage: string;
	kernelVersion: string;
	containerRuntime: string;
	cpuCapacity: string;
	memoryCapacity: string;
	podsCapacity: string;
	diskCapacity: string;
	podsCount: number;
	cpuAllocatable: string;
	memoryAllocatable: string;
	podsAllocatable: string;
	diskAllocatable: string;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	addresses: Array<{ type: string; address: string }>;
	taints: Array<{ key: string; value?: string; effect: string }>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
	unschedulable: boolean;
};

export type NodeWithAge = Node & {
	age: string;
	cpuUsage?: string;
	memoryUsage?: string;
};

/**
 * Status color mapping for node status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Ready: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		NotReady: 'bg-red-500/15 text-red-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for node status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Ready: CheckCircle2,
		NotReady: CircleX
	};
	return map[status] ?? HelpCircle;
}

/**
 * Format roles array as a human-readable string
 */
export function formatRoles(roles: string[]): string {
	if (!roles || roles.length === 0) return '—';
	return roles.join(', ');
}

/**
 * Format capacity value for display
 * CPU: "4" -> "4 cores", Memory: "16384Ki" -> "16 Gi"
 */
export function formatCapacity(value: string, type: 'cpu' | 'memory' | 'pods' | 'disk'): string {
	if (!value || value === '0') return '—';

	if (type === 'cpu') {
		// CPU capacity is in cores (e.g., "4")
		const cores = parseFloat(value);
		if (isNaN(cores)) return value;
		return cores >= 1 ? `${cores}` : `${Math.round(cores * 1000)}m`;
	}

	if (type === 'memory' || type === 'disk') {
		// Memory/Disk in Ki
		if (value.endsWith('Ki')) {
			const ki = parseInt(value.slice(0, -2));
			if (isNaN(ki)) return value;
			const gi = ki / (1024 * 1024);
			if (gi >= 1) return `${gi.toFixed(1)} Gi`;
			const mi = ki / 1024;
			return `${Math.round(mi)} Mi`;
		}
		if (value.endsWith('Mi')) return value;
		if (value.endsWith('Gi')) return value;
		// Raw bytes
		const bytes = parseInt(value);
		if (!isNaN(bytes)) {
			const gi = bytes / (1024 * 1024 * 1024);
			if (gi >= 1) return `${gi.toFixed(1)} Gi`;
			const mi = bytes / (1024 * 1024);
			return `${Math.round(mi)} Mi`;
		}
		return value;
	}

	if (type === 'pods') {
		return value;
	}

	return value;
}
