<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		namespace: string | null | undefined;
		onclick?: (e: MouseEvent) => void;
		class?: string;
	}

	let { namespace, onclick, class: className }: Props = $props();

	const ns = $derived(namespace ?? '');

	/**
	 * Returns Tailwind color classes based on namespace naming conventions.
	 * Returns null when no environment pattern is matched (use default outline style).
	 */
	function getNamespaceColor(name: string): string | null {
		const n = name.toLowerCase();

		// Production variants
		if (n === 'prod' || n.includes('production') || n.startsWith('prod-') || n.endsWith('-prod'))
			return 'border-rose-500/60 text-rose-600 dark:text-rose-400 bg-rose-500/5 hover:bg-rose-500/15';

		// Staging / UAT variants
		if (
			n === 'staging' ||
			n === 'stage' ||
			n === 'uat' ||
			n.startsWith('staging-') ||
			n.endsWith('-staging') ||
			n.startsWith('stage-') ||
			n.endsWith('-stage')
		)
			return 'border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/5 hover:bg-amber-500/15';

		// Development variants
		if (
			n === 'dev' ||
			n === 'develop' ||
			n === 'development' ||
			n === 'local' ||
			n === 'sandbox' ||
			n.startsWith('dev-') ||
			n.endsWith('-dev')
		)
			return 'border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/15';

		// Kubernetes system namespaces
		if (
			n === 'kube-system' ||
			n === 'kube-public' ||
			n === 'kube-node-lease' ||
			n.startsWith('kube-')
		)
			return 'border-sky-500/60 text-sky-600 dark:text-sky-400 bg-sky-500/5 hover:bg-sky-500/15';

		// Default k8s namespace
		if (n === 'default')
			return 'border-violet-500/60 text-violet-600 dark:text-violet-400 bg-violet-500/5 hover:bg-violet-500/15';

		return null;
	}

	const colorClass = $derived(settingsStore.showNamespaceBadges ? getNamespaceColor(ns) : null);
</script>

{#if onclick}
	{#if settingsStore.showNamespaceBadges}
		<Badge
			variant="outline"
			class={cn(
				'cursor-pointer px-1.5 py-0 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
				colorClass,
				className
			)}
			{onclick}
			title="Click to filter by this namespace"
		>
			{ns}
		</Badge>
	{:else}
		<button
			type="button"
			class={cn('cursor-pointer truncate bg-transparent text-xs text-muted-foreground hover:text-foreground', className)}
			{onclick}
			title="Click to filter by this namespace"
		>
			{ns}
		</button>
	{/if}
{:else}
	{#if settingsStore.showNamespaceBadges}
		<Badge
			variant="outline"
			class={cn('px-1.5 py-0 text-xs', colorClass, className)}
		>
			{ns}
		</Badge>
	{:else}
		<span class={cn('truncate text-xs text-muted-foreground', className)}>{ns}</span>
	{/if}
{/if}
