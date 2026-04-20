import { AlertTriangle, CheckCircle2, Info, HelpCircle } from 'lucide-svelte';

export type K8sEvent = {
	name: string;
	namespace: string;
	type: string;
	reason: string;
	message: string;
	source: string;
	count: number;
	firstSeen: string;
	lastSeen: string;
	involvedObject: {
		kind: string;
		name: string;
		namespace?: string;
	};
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
};

export type K8sEventWithAge = K8sEvent & { age: string; id: string };

/**
 * Event type color mapping
 */
export function getTypeColor(type: string): string {
	const map: Record<string, string> = {
		Normal: 'bg-emerald-500/15 text-emerald-400 border-transparent',
		Warning: 'bg-yellow-500/15 text-yellow-400 border-transparent'
	};
	return map[type] ?? 'bg-gray-500/15 text-gray-400 border-transparent';
}

/**
 * Event type icon mapping
 */
export function getTypeIcon(type: string) {
	const map: Record<string, typeof CheckCircle2> = {
		Normal: CheckCircle2,
		Warning: AlertTriangle,
		Info: Info
	};
	return map[type] ?? HelpCircle;
}

/**
 * Format the involved object as "Kind/Name"
 */
export function formatInvolvedObject(obj: K8sEvent['involvedObject']): string {
	return `${obj.kind}/${obj.name}`;
}
