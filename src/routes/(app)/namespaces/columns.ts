import { AlertCircle, CheckCircle2, XCircle } from 'lucide-svelte';

export interface Namespace extends Record<string, unknown> {
	name: string;
	status: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
}

export interface NamespaceWithAge extends Namespace {
	age: string;
}

export function getStatusIcon(status: string) {
	if (status === 'Active') return CheckCircle2;
	if (status === 'Terminating') return XCircle;
	return AlertCircle;
}

export function getStatusColor(status: string) {
	if (status === 'Active') return 'text-emerald-500 bg-emerald-500/10';
	if (status === 'Terminating') return 'text-yellow-500 bg-yellow-500/10';
	return 'text-muted-foreground bg-muted';
}