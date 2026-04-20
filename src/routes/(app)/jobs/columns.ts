import { CheckCircle2, CircleX, Loader, HelpCircle, PauseCircle } from 'lucide-svelte';

export type Job = {
	name: string;
	namespace: string;
	status: string;
	completions: string;
	duration: string;
	succeeded: number;
	failed: number;
	active: number;
	startTime: string;
	completionTime?: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	containers: Array<{
		name: string;
		image: string;
	}>;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	createdAt: string;
};

export type JobWithAge = Job & { age: string; id: string };

/**
 * Derive job health status
 */
export function getJobStatus(job: Job): string {
	if (job.status === 'Complete') return 'Complete';
	if (job.status === 'Failed') return 'Failed';
	if (job.status === 'Suspended') return 'Suspended';
	return 'Running';
}

/**
 * Status color mapping for job status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Complete: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Running: 'bg-blue-500/15 text-blue-400 border-transparent',
		Failed: 'bg-red-500/15 text-red-400 border-transparent',
		Suspended: 'bg-yellow-500/15 text-yellow-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping for job status badges
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Complete: CheckCircle2,
		Running: Loader,
		Failed: CircleX,
		Suspended: PauseCircle
	};
	return map[status] ?? HelpCircle;
}

/**
 * Status dot class for detail dialog
 */
export const statusDotClass: Record<string, string> = {
	Complete: 'bg-green-500',
	Running: 'bg-blue-500',
	Failed: 'bg-red-500',
	Suspended: 'bg-yellow-500'
};
