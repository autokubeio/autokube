import { CheckCircle2, CircleX, Loader, HelpCircle } from 'lucide-svelte';

export type StatefulSet = {
	name: string;
	namespace: string;
	ready: string;
	replicas: number;
	readyReplicas: number;
	currentReplicas: number;
	updatedReplicas: number;
	status: string;
	selector: Record<string, string>;
	serviceName: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	containers: Array<{
		name: string;
		image: string;
	}>;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	createdAt: string;
};

export type StatefulSetWithAge = StatefulSet & { age: string };

/**
 * Derive statefulset health status
 */
export function getStatefulSetStatus(sts: StatefulSet): string {
	if (sts.replicas === 0) return 'Scaled Down';
	if (sts.readyReplicas === sts.replicas && sts.replicas > 0) return 'Ready';
	if (sts.readyReplicas === 0) return 'NotReady';
	return 'Partial';
}

/**
 * Status color mapping for statefulset status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Ready: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Partial: 'bg-yellow-500/15 text-yellow-400 border-transparent',
		NotReady: 'bg-red-500/15 text-red-400 border-transparent',
		'Scaled Down': 'bg-gray-500/15 text-gray-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for statefulset status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Ready: CheckCircle2,
		Partial: Loader,
		NotReady: CircleX,
		'Scaled Down': HelpCircle
	};
	return map[status] ?? HelpCircle;
}

/**
 * Status dot class for detail dialog
 */
export const statusDotClass: Record<string, string> = {
	Ready: 'bg-green-500',
	Partial: 'bg-yellow-500',
	NotReady: 'bg-red-500',
	'Scaled Down': 'bg-gray-400'
};
