import type { HorizontalPodAutoscalerInfo } from '$lib/server/services/kubernetes/types';
import { CheckCircle2, CircleX, Loader, TriangleAlert, HelpCircle } from 'lucide-svelte';

export type HPA = HorizontalPodAutoscalerInfo;

export type HPAWithAge = HPA & { age: string };

/**
 * Derive HPA health status from replicas & conditions
 */
export function getHPAStatus(hpa: HPA): string {
	const ableToScale = hpa.conditions?.find((c) => c.type === 'AbleToScale');
	const scalingActive = hpa.conditions?.find((c) => c.type === 'ScalingActive');

	if (ableToScale?.status === 'False') return 'Unable';
	if (scalingActive?.status === 'False') return 'Inactive';
	if (hpa.currentReplicas === 0 && hpa.desiredReplicas === 0) return 'Idle';
	if (hpa.currentReplicas < hpa.desiredReplicas) return 'Scaling Up';
	if (hpa.currentReplicas > hpa.desiredReplicas) return 'Scaling Down';
	if (hpa.currentReplicas === hpa.desiredReplicas && hpa.currentReplicas > 0) return 'Active';
	return 'Unknown';
}

/**
 * Status color mapping for HPA status badges
 */
export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		Active: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		'Scaling Up': 'bg-blue-500/15 text-blue-400 border-transparent',
		'Scaling Down': 'bg-yellow-500/15 text-yellow-400 border-transparent',
		Idle: 'bg-gray-500/15 text-gray-400 border-transparent',
		Inactive: 'bg-orange-500/15 text-orange-400 border-transparent',
		Unable: 'bg-red-500/15 text-red-400 border-transparent'
	};
	return map[status] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Status icon mapping
 */
export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Active: CheckCircle2,
		'Scaling Up': Loader,
		'Scaling Down': Loader,
		Idle: HelpCircle,
		Inactive: TriangleAlert,
		Unable: CircleX
	};
	return map[status] ?? HelpCircle;
}
