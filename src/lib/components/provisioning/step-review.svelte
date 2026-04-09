<script lang="ts">
	import type { WizardData } from './provisioning-wizard.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { CheckCircle2, Cloud, Settings2, Server, Shield, Plug } from 'lucide-svelte';
	import { sshKeysStore } from '$lib/stores/ssh-keys.svelte';

	const { data }: { data: WizardData } = $props();

	const selectedKey = $derived(sshKeysStore.keys.find((k) => k.id === data.sshKeyId));

	const totalWorkers = $derived(data.workerPools.reduce((s, p) => s + p.count, 0));

	const PROVIDER_LABELS: Record<string, string> = {
		hetzner: 'Hetzner Cloud',
		aws: 'Amazon AWS',
		gcp: 'Google Cloud',
		digitalocean: 'DigitalOcean'
	};

	const CONNECTION_LABELS: Record<string, string> = {
		kubeconfig: 'Kubeconfig',
		agent: 'In-Cluster Agent',
		'bearer-token': 'Bearer Token'
	};
</script>

<div class="space-y-4">
	<div>
		<h3 class="text-sm font-semibold mb-1">Review & Create</h3>
		<p class="text-xs text-muted-foreground">Review your configuration before provisioning the cluster.</p>
	</div>

	<!-- 2-column compact grid -->
	<div class="grid grid-cols-2 gap-3">

		<!-- Provider -->
		<div class="rounded-lg border border-border bg-card p-3">
			<div class="flex items-center gap-1.5 mb-2">
				<Cloud class="size-3.5 text-muted-foreground" />
				<h4 class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Provider</h4>
			</div>
			<p class="text-sm font-medium">{PROVIDER_LABELS[data.provider] ?? data.provider}</p>
			<p class="text-xs text-muted-foreground mt-0.5">{data.providerToken ? 'Custom token provided' : 'Using token from settings'}</p>
		</div>

		<!-- General -->
		<div class="rounded-lg border border-border bg-card p-3">
			<div class="flex items-center gap-1.5 mb-2">
				<Settings2 class="size-3.5 text-muted-foreground" />
				<h4 class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">General</h4>
			</div>
			<div class="space-y-1 text-xs">
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Name</span><span class="font-mono font-medium truncate">{data.clusterName || '—'}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">K3s</span><span class="font-medium">{data.k3sVersion}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">SSH Key</span><span class="font-medium truncate">{selectedKey?.name ?? 'None'}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Labels</span><span class="font-medium">{data.labels.length > 0 ? data.labels.join(', ') : 'None'}</span></div>
			</div>
		</div>

		<!-- Nodes -->
		<div class="rounded-lg border border-border bg-card p-3">
			<div class="flex items-center gap-1.5 mb-2">
				<Server class="size-3.5 text-muted-foreground" />
				<h4 class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Nodes</h4>
			</div>
			<div class="space-y-1 text-xs">
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Masters</span><span class="font-medium">{data.masterCount}× {data.masterInstanceType}</span></div>
				{#each data.workerPools as pool}
					<div class="flex justify-between gap-2"><span class="text-muted-foreground truncate">{pool.name}</span><span class="font-medium">{pool.count}× {pool.instanceType}</span></div>
				{/each}
				<div class="flex justify-between gap-2 pt-1 border-t border-border"><span class="text-muted-foreground">Total</span><span class="font-semibold text-primary">{data.masterCount + totalWorkers} nodes</span></div>
			</div>
		</div>

		<!-- Networking -->
		<div class="rounded-lg border border-border bg-card p-3">
			<div class="flex items-center gap-1.5 mb-2">
				<Shield class="size-3.5 text-muted-foreground" />
				<h4 class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Networking</h4>
			</div>
			<div class="space-y-1 text-xs">
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Zone</span><span class="font-medium">{data.networkZone}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">CNI</span><span class="font-medium">{data.cniPlugin}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Private Network</span><span class="font-medium">{data.usePrivateNetwork ? 'Yes' : 'No'}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Load Balancer</span><span class="font-medium">{data.createLoadBalancer ? 'Yes' : 'No'}</span></div>
				<div class="flex justify-between gap-2"><span class="text-muted-foreground">Firewall Rules</span><span class="font-medium">{data.firewallRules.length}</span></div>
			</div>
		</div>

	</div>

	<!-- Connection — full width -->
	<div class="rounded-lg border border-border bg-card p-3">
		<div class="flex items-center gap-1.5 mb-2">
			<Plug class="size-3.5 text-muted-foreground" />
			<h4 class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Connection</h4>
		</div>
		<div class="flex items-center justify-between text-xs">
			<span class="text-muted-foreground">Type</span>
			<span class="font-medium">{CONNECTION_LABELS[data.connectionType] ?? data.connectionType}</span>
		</div>
	</div>

	<!-- Protect switch — full width -->
	<div class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
		<div>
			<p class="text-xs font-medium">Protect against deletion</p>
			<p class="text-xs text-muted-foreground">Require confirmation before destroying this cluster.</p>
		</div>
		<Switch bind:checked={data.protectAgainstDeletion} />
	</div>
</div>
