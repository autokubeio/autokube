<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import { clustersStore, type ClusterPublic } from '$lib/stores/clusters.svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import ClusterDialog from '$lib/components/cluster-dialog.svelte';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { DEFAULT_LABELS, COLOR_BADGE, COLOR_DOT } from '$lib/components/label-picker.svelte';
	import { getIconComponent } from '$lib/utils/icons';
	import {
		RefreshCw,
		Plus,
		Pencil,
		Trash2,
		Server,
		Plug,
		Loader2,
		CheckCircle2,
		AlertCircle
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	// ── Dialog state ──────────────────────────────────────────────────────────

	let dialogOpen = $state(false);
	let editingCluster = $state<ClusterPublic | undefined>(undefined);

	function openAdd() {
		editingCluster = undefined;
		dialogOpen = true;
	}

	function openEdit(cluster: ClusterPublic) {
		editingCluster = cluster;
		dialogOpen = true;
	}

	// ── Test connection ───────────────────────────────────────────────────────

	type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'disconnected' | 'error';
	let connectionStatus = $state<Record<number, ConnectionStatus>>({});
	let connectionErrors = $state<Record<number, string>>({});
	let testingClusters = $state<Set<number>>(new Set());
	let testingAll = $state(false);

	async function handleTestCluster(clusterId: number) {
		testingClusters.add(clusterId);
		testingClusters = testingClusters;
		connectionStatus[clusterId] = 'testing';
		delete connectionErrors[clusterId];

		try {
			const res = await fetch('/api/clusters/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clusterId })
			});

			const data = await res.json();

			if (data.success) {
				connectionStatus[clusterId] = 'connected';
				delete connectionErrors[clusterId];
			} else {
				connectionStatus[clusterId] = 'disconnected';
				connectionErrors[clusterId] = data.error || 'Connection failed';
			}
		} catch (err) {
			connectionStatus[clusterId] = 'error';
			connectionErrors[clusterId] = err instanceof Error ? err.message : 'Network error';
		} finally {
			testingClusters.delete(clusterId);
			testingClusters = testingClusters;
		}
	}

	async function handleTestAllClusters() {
		testingAll = true;
		const promises = clustersStore.clusters.map((cluster) => handleTestCluster(cluster.id));
		await Promise.allSettled(promises);
		testingAll = false;
	}

	// ── Delete ────────────────────────────────────────────────────────────────

	let deletingId = $state<number | null>(null);

	async function handleDelete(id: number) {
		deletingId = id;
		try {
			await clustersStore.delete(id);
			clusterStore.remove(id);
		} finally {
			deletingId = null;
		}
	}

	// ── Auth type display ─────────────────────────────────────────────────────

	function authLabel(authType?: string | null) {
		if (authType === 'agent') return 'agent';
		if (authType === 'in-cluster') return 'in-cluster';
		if (authType === 'bearer-token') return 'bearer-token';
		return 'kubeconfig';
	}

	// ── Format date ───────────────────────────────────────────────────────────

	function formatDate(iso?: string | null) {
		if (!iso) return '—';
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}

	onMount(async () => {
		await clustersStore.fetch();
		// Automatically test all clusters after loading
		if (clustersStore.clusters.length > 0) {
			handleTestAllClusters();
		}
	});
</script>

<!-- Header -->
<div class="flex items-start justify-between">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold">Connected Clusters</h2>
			<Badge variant="secondary" class="text-xs">{clustersStore.clusters.length}</Badge>
		</div>
		<p class="mt-0.5 text-sm text-muted-foreground">Manage your Kubernetes cluster connections.</p>
	</div>
	<div class="flex items-center gap-2">
		<Button
			variant="outline"
			size="sm"
			class="gap-1.5 text-xs"
			onclick={handleTestAllClusters}
			disabled={testingAll || clustersStore.clusters.length === 0}
		>
			{#if testingAll}
				<Loader2 class="size-3 animate-spin" />
			{:else}
				<Plug class="size-3" />
			{/if}
			Test All
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="gap-1.5 text-xs"
			onclick={() => clustersStore.fetch()}
			disabled={clustersStore.loading}
		>
			<RefreshCw class={cn('size-3', clustersStore.loading && 'animate-spin')} />
			Refresh
		</Button>
		<Button size="sm" class="gap-1.5 text-xs" onclick={openAdd}>
			<Plus class="size-3" />
			Add Cluster
		</Button>
	</div>
</div>

<!-- Error -->
{#if clustersStore.error}
	<div class="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
		{clustersStore.error}
	</div>
{/if}

<!-- Cluster list -->
<div class="mt-4 space-y-2">
	{#if clustersStore.loading && clustersStore.clusters.length === 0}
		<div class="flex items-center justify-center py-12">
			<Loader2 class="size-4 animate-spin text-muted-foreground" />
		</div>
	{:else if clustersStore.clusters.length === 0}
		<div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12">
			<Server class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No clusters connected yet</p>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openAdd}>
				<Plus class="size-3" /> Add your first cluster
			</Button>
		</div>
	{:else}
		{#each clustersStore.clusters as cluster (cluster.id)}
			{@const ClusterIcon = getIconComponent(cluster.icon ?? 'globe')}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<!-- Icon -->
				<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
					<ClusterIcon class="size-4 text-muted-foreground" />
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="font-mono text-sm font-medium">{cluster.name}</span>
						<Badge variant="secondary" class="font-mono text-[10px]">{authLabel(cluster.authType)}</Badge>
						<Badge variant="outline" class="font-mono text-[10px]">{cluster.namespace ?? 'default'}</Badge>
						{#each cluster.labels ?? [] as label (label)}
							{@const preset = DEFAULT_LABELS.find((d) => d.name === label)}
							{@const color = preset?.color ?? 'blue'}
							<Badge class={cn('text-[10px]', COLOR_BADGE[color] ?? COLOR_BADGE.blue)} variant="outline">
								<span class={cn('mr-1 inline-block size-1.5 rounded-full', COLOR_DOT[color] ?? COLOR_DOT.blue)}></span>
								{label}
							</Badge>
						{/each}
					</div>
					<p class="mt-0.5 truncate text-xs text-muted-foreground">
						{#if cluster.apiServer}{cluster.apiServer}{:else}Added {formatDate(cluster.createdAt)}{/if}
					</p>
				</div>

				<!-- Connection status -->
				<div class="shrink-0">
					{#if connectionStatus[cluster.id] === 'testing'}
						<Badge variant="secondary" class="gap-1 text-[10px]">
							<Loader2 class="size-2.5 animate-spin" />Testing
						</Badge>
					{:else if connectionStatus[cluster.id] === 'connected'}
						<Badge class="gap-1 border-emerald-500/50 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
							<span class="size-1.5 rounded-full bg-emerald-500"></span>Connected
						</Badge>
					{:else if connectionStatus[cluster.id] === 'disconnected'}
						<Badge class="gap-1 border-red-500/50 bg-red-500/10 text-[10px] text-red-600 dark:text-red-400" title={connectionErrors[cluster.id]}>
							<span class="size-1.5 rounded-full bg-red-500"></span>Disconnected
						</Badge>
					{:else if connectionStatus[cluster.id] === 'error'}
						<Badge class="gap-1 border-orange-500/50 bg-orange-500/10 text-[10px] text-orange-600 dark:text-orange-400" title={connectionErrors[cluster.id]}>
							<span class="size-1.5 rounded-full bg-orange-500"></span>Error
						</Badge>
					{:else}
						<Badge variant="outline" class="gap-1 text-[10px] text-muted-foreground">
							<span class="size-1.5 rounded-full bg-muted-foreground/40"></span>Unknown
						</Badge>
					{/if}
				</div>

				<!-- Actions -->
				<div class="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						class={cn(
							'size-7',
							connectionStatus[cluster.id] === 'connected' ? 'text-emerald-500 hover:text-emerald-600'
							: (connectionStatus[cluster.id] === 'disconnected' || connectionStatus[cluster.id] === 'error') ? 'text-destructive hover:text-destructive'
							: 'text-muted-foreground hover:text-foreground'
						)}
						title={connectionStatus[cluster.id] === 'connected' ? 'Connected — click to retest'
							: connectionStatus[cluster.id] === 'disconnected' ? (connectionErrors[cluster.id] || 'Disconnected — click to retest')
							: connectionStatus[cluster.id] === 'error' ? (connectionErrors[cluster.id] || 'Error — click to retest')
							: 'Test connection'}
						onclick={() => handleTestCluster(cluster.id)}
						disabled={testingClusters.has(cluster.id)}
					>
						{#if connectionStatus[cluster.id] === 'testing'}
							<Loader2 class="size-3.5 animate-spin" />
						{:else if connectionStatus[cluster.id] === 'connected'}
							<CheckCircle2 class="size-3.5" />
						{:else if connectionStatus[cluster.id] === 'disconnected' || connectionStatus[cluster.id] === 'error'}
							<AlertCircle class="size-3.5" />
						{:else}
							<Plug class="size-3.5" />
						{/if}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						onclick={() => openEdit(cluster)}
					>
						<Pencil class="size-3.5" />
					</Button>
					<ConfirmDelete
						title={cluster.name}
						loading={deletingId === cluster.id}
						onConfirm={() => handleDelete(cluster.id)}
					>
						{#snippet children()}
							<Button
								variant="ghost"
								size="icon"
								class="size-7 text-muted-foreground hover:text-destructive"
								disabled={deletingId === cluster.id}
							>
								{#if deletingId === cluster.id}
									<Loader2 class="size-3.5 animate-spin" />
								{:else}
									<Trash2 class="size-3.5" />
								{/if}
							</Button>
						{/snippet}
					</ConfirmDelete>
				</div>
			</div>
		{/each}
	{/if}
</div>

<!-- Dialog -->
<ClusterDialog
	bind:open={dialogOpen}
	cluster={editingCluster}
	onSuccess={async (id) => {
		await clustersStore.fetch();
		handleTestCluster(id);
		clusterStore.addOrRefresh(id);
	}}
/>
