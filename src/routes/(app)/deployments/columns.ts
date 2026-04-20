import type { ColumnConfig } from '$lib/components/data-table-view';
import { CheckCircle2, CircleX, Loader, TriangleAlert, HelpCircle } from 'lucide-svelte';

export type Deployment = {
	name: string;
	namespace: string;
	ready: string;
	upToDate: number;
	available: number;
	replicas: number;
	updatedReplicas: number;
	readyReplicas: number;
	availableReplicas: number;
	strategy: string;
	selector: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	containers: Array<{
		name: string;
		image: string;
		ports?: Array<{ containerPort: number; protocol: string }>;
	}>;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	createdAt: string;
};

export type DeploymentWithAge = Deployment & { age: string; id: string };

/**
 * Derive deployment health status from replicas
 */
export function getDeploymentStatus(d: Deployment): string {
	if (d.replicas === 0) return 'Scaled Down';
	if (d.availableReplicas === d.replicas && d.readyReplicas === d.replicas) return 'Running';
	if (d.availableReplicas === 0) return 'Unavailable';
	if (d.readyReplicas < d.replicas) return 'Progressing';
	return 'Unknown';
}

/**
 * Status color mapping for deployment status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Running: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Progressing: 'bg-yellow-500/15 text-yellow-400 border-transparent',
		Unavailable: 'bg-red-500/15 text-red-400 border-transparent',
		'Scaled Down': 'bg-gray-500/15 text-gray-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for deployment status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Running: CheckCircle2,
		Progressing: Loader,
		Unavailable: CircleX,
		'Scaled Down': TriangleAlert
	};
	return map[status] ?? HelpCircle;
}

/**
 * Status dot class for detail dialog
 */
export const statusDotClass: Record<string, string> = {
	Running: 'bg-green-500',
	Progressing: 'bg-yellow-500',
	Unavailable: 'bg-red-500',
	'Scaled Down': 'bg-gray-400'
};

/**
 * Base column definitions for deployments table
 */
export const deploymentColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', sortable: true, grow: true },
	{ id: 'namespace', label: 'Namespace', sortable: true, width: 120 },
	{ id: 'ready', label: 'Ready', sortable: true, width: 80 },
	{ id: 'upToDate', label: 'Up-to-date', sortable: true, width: 100 },
	{ id: 'available', label: 'Available', sortable: true, width: 100 },
	{ id: 'age', label: 'Age', sortable: true, width: 80 },
	{ id: 'strategy', label: 'Strategy', sortable: true, width: 140 },
	{ id: 'containers', label: 'Containers', sortable: true, width: 220 },
	{ id: 'actions', label: '', width: 170, fixed: 'end' }
];
