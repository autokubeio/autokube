import type { ColumnConfig } from '$lib/components/data-table-view';
import {
	CheckCircle2,
	CircleX,
	Loader,
	TriangleAlert,
	HelpCircle
} from 'lucide-svelte';

export type Pod = {
	name: string;
	namespace: string;
	status: string;
	phase: string;
	ready: string;
	restarts: number;
	age: string;
	node: string;
	ip: string;
	cpu?: string;
	memory?: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	containers: Array<{
		name: string;
		image: string;
		ready: boolean;
		restartCount: number;
		state: string;
	}>;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	createdAt: string;
};

export type PodWithAge = Pod & { age: string; id: string };

/**
 * Status color mapping for pod status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Running: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Pending: 'bg-yellow-500/15 text-yellow-400 border-transparent',
		Failed: 'bg-red-500/15 text-red-400 border-transparent',
		Succeeded: 'bg-blue-500/15 text-blue-400 border-transparent',
		Terminating: 'bg-orange-500/15 text-orange-400 border-transparent',
		CrashLoopBackOff: 'bg-red-500/15 text-red-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for pod status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Running: CheckCircle2,
		Pending: Loader,
		Failed: CircleX,
		Succeeded: CheckCircle2,
		Terminating: TriangleAlert,
		CrashLoopBackOff: CircleX
	};
	return map[status] ?? HelpCircle;
}

/**
 * Pod status dot class (for detail dialog)
 */
export const statusDotClass: Record<string, string> = {
	Running: 'bg-green-500',
	Pending: 'bg-yellow-500',
	Failed: 'bg-red-500',
	CrashLoopBackOff: 'bg-red-500',
	Terminating: 'bg-gray-400'
};

/**
 * Base column definitions for pods table
 */
export const podColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', sortable: true, grow: true },
	{ id: 'namespace', label: 'Namespace', sortable: true, width: 120 },
	{ id: 'status', label: 'Status', sortable: true, width: 160 },
	{ id: 'ready', label: 'Ready', sortable: true, width: 70 },
	{ id: 'restarts', label: 'Restarts', sortable: true, width: 80 },
	{ id: 'cpu', label: 'CPU', sortable: true, width: 150 },
	{ id: 'memory', label: 'Memory', sortable: true, width: 150 },
	{ id: 'age', label: 'Age', sortable: true, width: 65 },
	{ id: 'node', label: 'Node', sortable: true, width: 90 },
	{ id: 'ip', label: 'IP', sortable: true, width: 115 },
	{ id: 'actions', label: '', width: 140, fixed: 'end' }
];
