import { CheckCircle2, PauseCircle, HelpCircle } from 'lucide-svelte';

export type CronJob = {
	name: string;
	namespace: string;
	status: string;
	schedule: string;
	suspend: boolean;
	lastSchedule?: string;
	active: number;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	containers: Array<{
		name: string;
		image: string;
	}>;
	createdAt: string;
};

export type CronJobWithAge = CronJob & { age: string };

/**
 * Derive cronjob health status
 */
export function getCronJobStatus(cj: CronJob): string {
	if (cj.suspend) return 'Suspended';
	return 'Active';
}

/**
 * Status color mapping for cronjob status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Active: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Suspended: 'bg-yellow-500/15 text-yellow-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for cronjob status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Active: CheckCircle2,
		Suspended: PauseCircle
	};
	return map[status] ?? HelpCircle;
}

/**
 * Status dot class for detail dialog
 */
export const statusDotClass: Record<string, string> = {
	Active: 'bg-green-500',
	Suspended: 'bg-yellow-500'
};
