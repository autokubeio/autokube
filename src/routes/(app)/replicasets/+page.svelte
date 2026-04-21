<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import NamespaceSelect from '$lib/components/namespace-select.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import { arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Copy,
		Info,
		Trash2,
		Loader2,
		FileCode,
		RotateCw,
		Plus,
		Minus
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type ReplicaSet,
		type ReplicaSetWithAge,
		getReplicaSetStatus,
		getStatusIcon,
		getStatusColor,
		statusDotClass
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, replicaSetsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allReplicaSets = $state<ReplicaSet[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Search debounce
	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSearch(value: string) {
		if (_searchTimer !== null) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => { searchQuery = value; }, 150);
	}

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedReplicaSet = $state<ReplicaSetWithAge | null>(null);
	let deleting = $state(false);
	let scaling = $state(false);
	let restartingKey = $state<string | null>(null);

	// Scale dialog
	let showScaleDialog = $state(false);
	let scaleTarget = $state<ReplicaSetWithAge | null>(null);
	let scaleReplicas = $state(1);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// ReplicaSets with age (reactive to ticker)
	const replicaSetsWithAge = $derived.by((): ReplicaSetWithAge[] => {
		const currentTime = timeTicker.now;
		return allReplicaSets.map((rs) => ({
			...rs,
			id: `${rs.namespace}/${rs.name}`,
			age: calculateAgeWithTicker(rs.createdAt, currentTime)
		}));
	});

	// Filtered replicasets
	const filteredReplicaSets = $derived.by(() => {
		let result = replicaSetsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((rs) => rs.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(rs) =>
					rs.name?.toLowerCase().includes(query) ||
					rs.namespace?.toLowerCase().includes(query) ||
					(rs.containers ?? []).some((c) => c.image?.toLowerCase().includes(query))
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof ReplicaSet, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				desired: (val: number) => Number(val),
				current: (val: number) => Number(val),
				ready: (val: number) => Number(val)
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let replicaSetsWatch: ReturnType<typeof useBatchWatch<ReplicaSet>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchNamespaces(clusterId);
			fetchReplicaSets(clusterId, selectedNamespace);

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (replicaSetsWatch) replicaSetsWatch.unsubscribe();

			replicaSetsWatch = useBatchWatch<ReplicaSet>({


				clusterId,


				resourceType: 'replicasets',


				namespace: ns,


				getItems: () => allReplicaSets,


				setItems: (v) => { allReplicaSets = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			replicaSetsWatch.subscribe();
		} else {
			allReplicaSets = [];
			namespaces = [];
			if (replicaSetsWatch) {
				replicaSetsWatch.unsubscribe();
				replicaSetsWatch = null;
			}
		}
	});

	onDestroy(() => {
		replicaSetsWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchNamespaces(clusterId: number) {
		try {
			const res = await fetch(`/api/namespaces?cluster=${clusterId}`);
			const data = await res.json();
			if (data.success && data.namespaces) {
				namespaces = data.namespaces.map((ns: { name: string }) => ns.name).sort();
			}
		} catch (err) {
			console.error('[ReplicaSets] Failed to fetch namespaces:', err);
		}
	}

	async function fetchReplicaSets(clusterId: number, nsParam: string) {
		loading = true;
		error = null;

		try {
			const ns = nsParam === 'all' ? 'all' : nsParam;
			const res = await fetch(`/api/clusters/${clusterId}/replicasets?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.replicaSets) {
				allReplicaSets = data.replicaSets;
			} else {
				error = data.error || 'Failed to fetch replicasets';
				allReplicaSets = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch replicasets';
			allReplicaSets = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const params = new URLSearchParams({
				cluster: activeCluster.id.toString(),
				name,
				namespace
			});
			const response = await fetch(`/api/replicasets/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete replicaset');
			}
			toast.success(`ReplicaSet "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete replicaset: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	async function handleScale(name: string, namespace: string, replicas: number) {
		if (!activeCluster?.id) return;

		try {
			scaling = true;
			const response = await fetch('/api/replicasets/scale', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cluster: activeCluster.id,
					name,
					namespace,
					replicas
				})
			});
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to scale replicaset');
			}
			toast.success(`ReplicaSet "${name}" scaled to ${replicas} replicas`);
			showScaleDialog = false;
		} catch (err: any) {
			toast.error(`Failed to scale replicaset: ${err.message}`);
		} finally {
			scaling = false;
		}
	}

	async function handleRestart(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			restartingKey = `${name}/${namespace}`;
			const response = await fetch('/api/replicasets/restart', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cluster: activeCluster.id,
					name,
					namespace
				})
			});
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to restart replicaset');
			}
			toast.success(`ReplicaSet "${name}" restarted`);
		} catch (err: any) {
			toast.error(`Failed to restart replicaset: ${err.message}`);
		} finally {
			restartingKey = null;
		}
	}

	function openDetail(rs: ReplicaSetWithAge) {
		selectedReplicaSet = rs;
		showDetailDialog = true;
	}

	function openScaleDialog(rs: ReplicaSetWithAge) {
		scaleTarget = rs;
		scaleReplicas = rs.desired;
		showScaleDialog = true;
	}

	function openYamlEditor(rs: ReplicaSetWithAge) {
		drawerResource = { resourceType: 'replicaset', name: rs.name, namespace: rs.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchReplicaSets(activeClusterId, selectedNamespace);
	}
</script>

<svelte:head>
	<title>ReplicaSets - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">ReplicaSets</h1>
			<span class="text-sm text-muted-foreground">
				{filteredReplicaSets.length} of {replicaSetsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchReplicaSets(activeClusterId, selectedNamespace); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns: string) => { selectedNamespace = ns; if (activeClusterId) fetchReplicaSets(activeClusterId, ns); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search replicasets..."
					class="h-8 w-full pl-8 text-xs sm:w-56"
					value={searchQuery}
					oninput={(e) => scheduleSearch(e.currentTarget.value)}
				/>
			</div>
		</div>
	</div>

	<!-- Error -->
	{#if error}
		<div
			class="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
		>
			<AlertCircle class="size-4 shrink-0" />
			<span class="text-sm">{error}</span>
		</div>
	{/if}

	<!-- Empty states -->
	{#if !loading && !error && !activeCluster}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No cluster selected</h3>
				<p class="text-sm text-muted-foreground">Select a cluster to view replicasets</p>
			</div>
		</div>
	{:else if !loading && !error && allReplicaSets.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No replicasets found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no replicasets'
						: `No replicasets in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredReplicaSets}
				keyField="id"
				name={TableName.replicasets}
				columns={replicaSetsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, replicaset: ReplicaSetWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Copy class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{replicaset.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={replicaset.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = replicaset.namespace;
								if (activeClusterId) fetchReplicaSets(activeClusterId, replicaset.namespace);
							}}
						/>
					{:else if column.id === 'desired'}
						<span class="font-mono text-xs">{replicaset.desired}</span>
					{:else if column.id === 'current'}
						<span class="font-mono text-xs">{replicaset.current}</span>
					{:else if column.id === 'ready'}
						{@const status = getReplicaSetStatus(replicaset)}
						{@const StatusIcon = getStatusIcon(status)}
						<div class="flex items-center gap-1.5">
							<Badge class="{getStatusColor(status)} px-2 py-0.5" title={status}>
								<StatusIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{replicaset.ready}</span>
							</Badge>
						</div>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{replicaset.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openScaleDialog(replicaset);
								}}
								title="Scale"
							>
								<Plus class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								disabled={restartingKey === `${replicaset.name}/${replicaset.namespace}`}
								onclick={(e) => {
									e.stopPropagation();
									handleRestart(replicaset.name, replicaset.namespace);
								}}
								title="Restart"
							>
								<RotateCw class={cn('h-3.5 w-3.5', restartingKey === `${replicaset.name}/${replicaset.namespace}` && 'animate-spin')} />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(replicaset);
								}}
								title="Edit YAML"
							>
								<FileCode class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openDetail(replicaset);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={replicaset.name}
								loading={deleting}
								onConfirm={() => handleDelete(replicaset.name, replicaset.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete replicaset"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Copy class="mb-3 h-10 w-10 opacity-40" />
						<p>No replicasets found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading replicasets...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-h-[90vh] max-w-4xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>ReplicaSet Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedReplicaSet}
			{@const status = getReplicaSetStatus(selectedReplicaSet)}
			{@const RsStatusIcon = getStatusIcon(status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedReplicaSet.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs"
								>{selectedReplicaSet.namespace}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(status)} px-2 py-0.5 text-xs"
									title={status}
								>
									<RsStatusIcon class="mr-1 size-3" />
									{status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Desired</p>
							<p class="mt-1 font-mono text-sm">{selectedReplicaSet.desired}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Current</p>
							<p class="mt-1 font-mono text-sm">{selectedReplicaSet.current}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Ready</p>
							<p class="mt-1 font-mono text-sm">{selectedReplicaSet.ready}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedReplicaSet.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedReplicaSet.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Selector -->
				{#if Object.keys(selectedReplicaSet.selector ?? {}).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Selector</h3>
						<div class="flex flex-wrap gap-1">
							{#each Object.entries(selectedReplicaSet.selector) as [k, v]}
								<Badge variant="secondary" class="text-xs">{k}={v}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Containers -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Containers</h3>
					<div class="space-y-3">
						{#each selectedReplicaSet.containers ?? [] as container}
							<div class="rounded-md border bg-muted/40 p-3">
								<div class="grid grid-cols-2 gap-3">
									<div>
										<p class="text-sm font-medium text-muted-foreground">Name</p>
										<p class="mt-1 font-mono text-sm">{container.name}</p>
									</div>
									<div class="col-span-2">
										<p class="text-sm font-medium text-muted-foreground">Image</p>
										<p class="mt-1 break-all font-mono text-xs">{container.image}</p>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Conditions -->
				{#if (selectedReplicaSet.conditions ?? []).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Conditions</h3>
						<div class="space-y-2">
							{#each selectedReplicaSet.conditions as condition}
								<div class="rounded-md border bg-muted/40 p-2">
									<div class="mb-1 flex items-center gap-2">
										<Badge variant="outline" class="text-xs">{condition.type}</Badge>
										<span
											class={cn(
												'text-xs',
												condition.status === 'True'
													? 'text-emerald-500'
													: condition.status === 'False'
														? 'text-muted-foreground'
														: 'text-yellow-500'
											)}>{condition.status}</span
										>
									</div>
									{#if condition.reason}
										<p class="text-xs text-muted-foreground">Reason: {condition.reason}</p>
									{/if}
									{#if condition.message}
										<p class="mt-1 text-xs text-muted-foreground">{condition.message}</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedReplicaSet.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedReplicaSet.labels) as [k, v]}
								<div class="flex items-start gap-2 text-xs">
									<span class="min-w-0 font-mono break-all text-muted-foreground">{k}:</span>
									<span class="font-mono">{v}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No labels</p>
					{/if}
				</div>

				<!-- Annotations -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Annotations</h3>
					{#if Object.keys(selectedReplicaSet.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedReplicaSet.annotations) as [k, v]}
								{@const parsed = tryPrettyJson(v)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<p class="mb-1 font-mono text-[11px] break-all text-muted-foreground">{k}</p>
									{#if parsed.pretty}
										<pre
											class="overflow-x-auto font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">{parsed.text}</pre>
									{:else}
										<p class="font-mono text-xs break-all">{v}</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No annotations</p>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Scale Dialog -->
<Dialog.Root bind:open={showScaleDialog}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Scale ReplicaSet</Dialog.Title>
			<Dialog.Description>
				{#if scaleTarget}
					Set the number of replicas for <strong>{scaleTarget.name}</strong>
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if scaleTarget}
			<div class="flex items-center justify-center gap-4 py-4">
				<Button
					variant="outline"
					size="icon"
					class="h-10 w-10"
					disabled={scaleReplicas <= 0 || scaling}
					onclick={() => (scaleReplicas = Math.max(0, scaleReplicas - 1))}
				>
					<Minus class="size-4" />
				</Button>
				<div class="text-center">
					<p class="text-4xl font-bold tabular-nums">{scaleReplicas}</p>
					<p class="text-xs text-muted-foreground">replicas</p>
				</div>
				<Button
					variant="outline"
					size="icon"
					class="h-10 w-10"
					disabled={scaling}
					onclick={() => (scaleReplicas += 1)}
				>
					<Plus class="size-4" />
				</Button>
			</div>
			{#if scaleReplicas !== scaleTarget.desired}
				<p class="text-center text-xs text-muted-foreground">
					Current: {scaleTarget.desired} → New: {scaleReplicas}
				</p>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="outline" size="sm" onclick={() => (showScaleDialog = false)}>
					Cancel
				</Button>
				<Button
					size="sm"
					disabled={scaling || scaleReplicas === scaleTarget.desired}
					onclick={() =>
						scaleTarget &&
						handleScale(scaleTarget.name, scaleTarget.namespace, scaleReplicas)}
				>
					{#if scaling}
						<Loader2 class="mr-1.5 size-3 animate-spin" />
					{/if}
					Apply
				</Button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

{#if activeCluster && showYamlDialog}
	<ResourceDrawer
		bind:open={showYamlDialog}
		clusterId={activeCluster.id}
		resource={drawerResource}
		onClose={closeYamlEditor}
		onSuccess={handleYamlSuccess}
	/>
{/if}
