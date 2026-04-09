<script lang="ts">
	import type { WizardData } from './provisioning-wizard.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { AlertTriangle, Plus, X, Tag, RefreshCw, Key, CheckCircle2 } from 'lucide-svelte';
	import { sshKeysStore } from '$lib/stores/ssh-keys.svelte';
	import { onMount } from 'svelte';
	import LabelPicker, { DEFAULT_LABELS, COLOR_BADGE } from '$lib/components/label-picker.svelte';
	import type { LabelItem } from '$lib/components/label-picker.svelte';

	const { data = $bindable(), errors = {} }: { data: WizardData; errors?: Record<string, string> } = $props();

	const K3S_VERSIONS = [
		'v1.32.0+k3s1',
		'v1.31.5+k3s1',
		'v1.30.9+k3s1',
		'v1.29.13+k3s1'
	];

	let labelItems = $state<LabelItem[]>(
		(data.labels ?? []).map((name) => {
			const preset = DEFAULT_LABELS.find((l) => l.name === name);
			return preset ?? { name, color: 'slate' };
		})
	);

	// Sync labels back to data
	$effect(() => {
		data.labels = labelItems.map((l) => l.name);
	});

	onMount(async () => {
		await sshKeysStore.fetch();
	});

	const sshKeys = $derived(sshKeysStore.keys);
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-sm font-semibold mb-1">General Configuration</h3>
		<p class="text-xs text-muted-foreground">Set the cluster name, K3s version, labels, and SSH access key.</p>
	</div>

	<!-- Cluster Name -->
	<div class="space-y-1.5">
		<Label for="cluster-name" class="text-xs font-medium">Cluster Name <span class="text-red-500">*</span></Label>
		<Input
			id="cluster-name"
			placeholder="my-production-cluster"
			bind:value={data.clusterName}
			class={`text-sm ${errors.clusterName ? 'border-red-500 focus-visible:ring-red-500/30' : ''}`}
		/>
		{#if errors.clusterName}
			<p class="text-xs text-red-500">{errors.clusterName}</p>
		{:else}
			<p class="text-xs text-muted-foreground">Unique name to identify this cluster in AutoKube.</p>
		{/if}
	</div>

	<!-- K3s Version -->
	<div class="space-y-1.5">
		<Label class="text-xs font-medium">K3s Version</Label>
		<Select.Root type="single" bind:value={data.k3sVersion}>
			<Select.Trigger class="text-sm h-9">{data.k3sVersion}</Select.Trigger>
			<Select.Content>
				{#each K3S_VERSIONS as v}
					<Select.Item value={v}>{v}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<!-- SSH Key -->
	<div class="space-y-1.5">
		<div class="flex items-center justify-between">
			<Label class="text-xs font-medium">SSH Key <span class="text-red-500">*</span></Label>
			<button
				type="button"
				onclick={() => sshKeysStore.fetch()}
				class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<RefreshCw class={`size-3 ${sshKeysStore.loading ? 'animate-spin' : ''}`} />
				Refresh
			</button>
		</div>

		{#if sshKeysStore.loading}
			<div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
				<RefreshCw class="size-3.5 animate-spin" />
				Loading SSH keys...
			</div>
		{:else if sshKeys.length === 0}
			<div class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
				<AlertTriangle class="size-4 text-amber-500 mt-0.5 shrink-0" />
				<div>
					<p class="text-xs font-medium text-amber-600">No SSH keys available</p>
					<p class="text-xs text-muted-foreground mt-0.5">
						You need at least one SSH key to provision a cluster.
						<a href="/settings#ssh-keys" class="underline text-primary">Add one in Settings → SSH Keys</a>.
					</p>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-2 max-h-48 overflow-y-auto pr-0.5">
				{#each sshKeys as key}
					{@const isSelected = data.sshKeyId === key.id}
					<button
						type="button"
						onclick={() => (data.sshKeyId = key.id)}
						class={[
							'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all',
							isSelected
								? 'border-primary/60 bg-primary/5 ring-1 ring-primary/30'
								: errors.sshKeyId
									? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10'
									: 'border-border bg-muted/20 hover:bg-muted/40 hover:border-border/80'
						].join(' ')}
					>
						<div class={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isSelected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
							<Key class="size-3.5" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="text-xs font-medium leading-tight truncate">{key.name}</span>
								<span class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase ${key.keyType === 'ed25519' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-blue-500/10 text-blue-600'}`}>
									{key.keyType}
								</span>
							</div>
							<span class="mt-0.5 block font-mono text-[10px] text-muted-foreground truncate">{key.fingerprint}</span>
						</div>
						{#if isSelected}
							<CheckCircle2 class="size-4 shrink-0 text-primary" />
						{/if}
					</button>
				{/each}
			</div>
			{#if errors.sshKeyId}
				<div class="flex items-center gap-1.5">
					<AlertTriangle class="size-3.5 text-red-500 shrink-0" />
					<p class="text-xs text-red-500">{errors.sshKeyId}</p>
				</div>
			{:else if !data.sshKeyId}
				<div class="flex items-center gap-1.5">
					<AlertTriangle class="size-3.5 text-amber-500 shrink-0" />
					<p class="text-xs text-amber-600">An SSH key is required for cluster provisioning.</p>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Labels -->
	<div class="space-y-1.5">
		<Label class="text-xs font-medium flex items-center gap-1">
			<Tag class="size-3.5" />
			Labels
		</Label>
		<LabelPicker bind:labels={labelItems} />
		{#if labelItems.length > 0}
			<div class="flex flex-wrap gap-1 mt-1">
				{#each labelItems as label}
					<span class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR_BADGE[label.color] ?? ''}`}>
						{label.name}
					</span>
				{/each}
			</div>
		{/if}
	</div>
</div>
