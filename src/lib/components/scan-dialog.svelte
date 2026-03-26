<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Loader2, ShieldCheck } from 'lucide-svelte';
	import { imageScansStore } from '$lib/stores/image-scans.svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		onSuccess?: () => void;
	}

	let { open = $bindable(false), onSuccess }: Props = $props();
	let image = $state('');
	let selectedClusterId = $state<string>('');
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});

	$effect(() => {
		if (open) {
			image = '';
			selectedClusterId = clusterStore.active?.id ? String(clusterStore.active.id) : '';
			errors = {};
		}
	});

	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!image.trim()) e.image = 'Image name is required';
		if (!selectedClusterId) e.cluster = 'A cluster must be selected — scans run inside the cluster';
		errors = e;
		return Object.keys(e).length === 0;
	}

	async function handleSubmit() {
		if (!validate()) return;
		saving = true;
		try {
			await imageScansStore.startScan(image.trim(), {
				clusterId: selectedClusterId ? Number(selectedClusterId) : undefined
			});
			toast.success(`Scan completed for ${image.trim()}`);
			open = false;
			onSuccess?.();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Scan failed');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<ShieldCheck class="size-5" />
				Scan Container Image
			</Dialog.Title>
			<Dialog.Description>
			Scan a container image for vulnerabilities. The scan runs as a Job inside the selected cluster.
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="scan-image">Image</Label>
				<Input
					id="scan-image"
					placeholder="e.g. nginx:1.25 or ghcr.io/org/app:latest"
					bind:value={image}
					class={errors.image ? 'border-destructive' : ''}
				/>
				{#if errors.image}
					<p class="text-xs text-destructive">{errors.image}</p>
				{/if}
			</div>

			{#if clusterStore.active}
				<div class="space-y-2">
					<Label for="scan-cluster">Cluster</Label>
					<Input
						id="scan-cluster"
						value={clusterStore.active.name}
						disabled
						class="bg-muted"
					/>
					<p class="text-[11px] text-muted-foreground">Scan will run inside: {clusterStore.active.name}</p>
				</div>
			{:else}
				<p class="text-xs text-destructive">No cluster selected. Select a cluster from the status bar first.</p>
			{/if}

			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={saving || !clusterStore.active}>
					{#if saving}
						<Loader2 class="size-4 animate-spin" />
						Scanning…
					{:else}
						<ShieldCheck class="size-4" />
						Start Scan
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
