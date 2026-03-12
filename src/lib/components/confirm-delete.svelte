<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import type { Snippet } from 'svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	let {
		title,
		description = 'This action cannot be undone.',
		loading = false,
		onConfirm,
		children
	}: {
		title: string;
		description?: string;
		loading?: boolean;
		onConfirm: () => void;
		children: Snippet;
	} = $props();

	let open = $state(false);
</script>

{#if !settingsStore.confirmDelete}
	<!-- Bypass confirmation — call onConfirm directly -->
	<div
		role="button"
		tabindex="0"
		onclick={(e) => { e.stopPropagation(); onConfirm(); }}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onConfirm(); } }}
	>
		{@render children()}
	</div>
{:else}
<Popover.Root bind:open>
	<Popover.Trigger onclick={(e) => e.stopPropagation()}>
		{@render children()}
	</Popover.Trigger>
	<Popover.Content side="top" sideOffset={6} class="w-auto min-w-44 p-3">
		<p class="text-xs font-semibold">Delete "{title}"?</p>
		<p class="mt-0.5 text-xs text-muted-foreground">{description}</p>
		<div class="mt-2 flex justify-end gap-1.5">
			<Button
				variant="outline"
				size="sm"
				class="h-6 px-2 text-xs"
				onclick={() => (open = false)}
				disabled={loading}
			>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				class="h-6 px-2 text-xs"
				onclick={() => {
					onConfirm();
					open = false;
				}}
				disabled={loading}
			>
				{loading ? 'Deleting…' : 'Delete'}
			</Button>
		</div>
	</Popover.Content>
</Popover.Root>
{/if}
