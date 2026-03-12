import { CheckCircle2, CircleX, Loader, HelpCircle } from 'lucide-svelte';

export type DaemonSet = {
	name: string;
	namespace: string;
	desired: number;
	current: number;
	ready: number;
	upToDate: number;
	available: number;
	status: string;
	nodeSelector: Record<string, string>;
	selector: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	containers: Array<{
		name: string;
		image: string;
	}>;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	createdAt: string;
};

export type DaemonSetWithAge = DaemonSet & { age: string };

/**
 * Derive daemonset health status
 */
export function getDaemonSetStatus(ds: DaemonSet): string {
	if (ds.desired === 0) return 'NotScheduled';
	if (ds.ready === ds.desired && ds.desired > 0) return 'Ready';
	if (ds.ready === 0) return 'NotReady';
	return 'Partial';
}

/**
 * Status color mapping for daemonset status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Ready: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Partial: 'bg-yellow-500/15 text-yellow-400 border-transparent',
		NotReady: 'bg-red-500/15 text-red-400 border-transparent',
		NotScheduled: 'bg-gray-500/15 text-gray-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for daemonset status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Ready: CheckCircle2,
		Partial: Loader,
		NotReady: CircleX,
		NotScheduled: HelpCircle
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
	NotScheduled: 'bg-gray-400'
};
