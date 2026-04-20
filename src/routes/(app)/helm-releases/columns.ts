import { CheckCircle2, CircleX, Loader, TriangleAlert, HelpCircle, Clock } from 'lucide-svelte';
import type { ColumnConfig } from '$lib/components/data-table-view';

export type HelmRelease = {
	name: string;
	namespace: string;
	chart: string;
	chartVersion: string;
	appVersion: string;
	status: string;
	revision: number;
	updatedAt: string;
	createdAt: string;
	description: string;
};

export type HelmReleaseWithAge = HelmRelease & { age: string; id: string };

export function getStatusColor(status: string): string {
	const map: Record<string, string> = {
		deployed:           'bg-emerald-500/15 text-emerald-400 border-transparent',
		failed:             'bg-red-500/15 text-red-400 border-transparent',
		'pending-install':  'bg-yellow-500/15 text-yellow-400 border-transparent',
		'pending-upgrade':  'bg-yellow-500/15 text-yellow-400 border-transparent',
		'pending-rollback': 'bg-yellow-500/15 text-yellow-400 border-transparent',
		superseded:         'bg-zinc-500/15 text-zinc-400 border-transparent',
		uninstalling:       'bg-orange-500/15 text-orange-400 border-transparent'
	};
	return map[status] ?? 'bg-zinc-500/15 text-zinc-400 border-transparent';
}

export function getStatusIcon(status: string) {
	const map: Record<string, typeof CheckCircle2> = {
		deployed:           CheckCircle2,
		failed:             CircleX,
		'pending-install':  Loader,
		'pending-upgrade':  Loader,
		'pending-rollback': Loader,
		superseded:         Clock,
		uninstalling:       TriangleAlert
	};
	return map[status] ?? HelpCircle;
}
