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
		Gauge,
		Info,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import { type HPA, type HPAWithAge, getHPAStatus, getStatusIcon, getStatusColor } from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, hpasColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allHPAs = $state<HPA[]>([]);
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
	let selectedHPA = $state<HPAWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// HPAs with age (reactive to ticker)
	const hpasWithAge = $derived.by((): HPAWithAge[] => {
		const currentTime = timeTicker.now;
		return allHPAs.map((hpa) => ({
			...hpa,
			age: calculateAgeWithTicker(hpa.createdAt, currentTime)
		}));
	});

	// Filtered HPAs
	const filteredHPAs = $derived.by(() => {
		let result = hpasWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((hpa) => hpa.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(hpa) =>
					hpa.name.toLowerCase().includes(query) ||
					hpa.namespace.toLowerCase().includes(query) ||
					hpa.reference.toLowerCase().includes(query)
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof HPA, sortState.direction, {
				createdAt: (val: any) => new Date(val).getTime(),
				currentReplicas: (val: any) => Number(val),
				desiredReplicas: (val: any) => Number(val),
				minPods: (val: any) => Number(val),
				maxPods: (val: any) => Number(val)
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let hpaWatch: ReturnType<typeof useBatchWatch<HPA>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchHPAs();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (hpaWatch) hpaWatch.unsubscribe();

			hpaWatch = useBatchWatch<HPA>({


				clusterId: activeCluster.id,


				resourceType: 'hpas',


				namespace: ns,


				getItems: () => allHPAs,


				setItems: (v) => { allHPAs = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			hpaWatch.subscribe();
		} else {
			allHPAs = [];
			namespaces = [];
			if (hpaWatch) {
				hpaWatch.unsubscribe();
				hpaWatch = null;
			}
		}
	});

	onDestroy(() => {
		hpaWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchNamespaces() {
		if (!activeCluster?.id) return;
		try {
			const res = await fetch(`/api/namespaces?cluster=${activeCluster.id}`);
			const data = await res.json();
			if (data.success && data.namespaces) {
				namespaces = data.namespaces.map((ns: { name: string }) => ns.name).sort();
			}
		} catch (err) {
			console.error('[HPAs] Failed to fetch namespaces:', err);
		}
	}

	async function fetchHPAs() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/hpas?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.hpas) {
				allHPAs = data.hpas;
			} else {
				error = data.error || 'Failed to fetch HPAs';
				allHPAs = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch HPAs';
			allHPAs = [];
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
			const response = await fetch(`/api/hpas/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete HPA');
			}
			toast.success(`HPA "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete HPA: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(hpa: HPAWithAge) {
		selectedHPA = hpa;
		showDetailDialog = true;
	}

	function openYamlEditor(hpa: HPAWithAge) {
		drawerResource = { resourceType: 'hpa', name: hpa.name, namespace: hpa.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchHPAs();
	}
</script>

<svelte:head>
	<title>Horizontal Pod Autoscalers - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Pod Auto Scaling</h1>
			<span class="text-sm text-muted-foreground">
				{filteredHPAs.length} of {hpasWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchHPAs}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns) => { selectedNamespace = ns; fetchHPAs(); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search HPAs..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view HPAs</p>
			</div>
		</div>
	{:else if !loading && !error && allHPAs.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No HPAs found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no horizontal pod autoscalers'
						: `No HPAs in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredHPAs}
				keyField="id"
				name={TableName.hpas}
				columns={hpasColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, hpa: HPAWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Gauge class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{hpa.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={hpa.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = hpa.namespace;
								fetchHPAs();
							}}
						/>
					{:else if column.id === 'reference'}
						<span class="font-mono text-xs text-muted-foreground">{hpa.reference}</span>
					{:else if column.id === 'currentReplicas'}
						{@const status = getHPAStatus(hpa)}
						{@const StatusIcon = getStatusIcon(status)}
						<div class="flex items-center gap-1.5">
							<Badge class="{getStatusColor(status)} px-2 py-0.5" title={status}>
								<StatusIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{hpa.currentReplicas}</span>
							</Badge>
						</div>
					{:else if column.id === 'desiredReplicas'}
						<span class="font-mono text-xs">{hpa.desiredReplicas}</span>
					{:else if column.id === 'minPods'}
						<span class="font-mono text-xs">{hpa.minPods}</span>
					{:else if column.id === 'maxPods'}
						<span class="font-mono text-xs">{hpa.maxPods}</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{hpa.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(hpa);
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
									openDetail(hpa);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={hpa.name}
								loading={deleting}
								onConfirm={() => handleDelete(hpa.name, hpa.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete HPA"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Gauge class="mb-3 h-10 w-10 opacity-40" />
						<p>No HPAs found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading HPAs...
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
			<Dialog.Title>HPA Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedHPA}
			{@const status = getHPAStatus(selectedHPA)}
			{@const StatusIcon = getStatusIcon(status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedHPA.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedHPA.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge class="{getStatusColor(status)} px-2 py-0.5 text-xs" title={status}>
									<StatusIcon class="mr-1 size-3" />
									{status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Scale Target</p>
							<p class="mt-1 font-mono text-sm">{selectedHPA.reference}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Current Replicas</p>
							<p class="mt-1 font-mono text-sm">{selectedHPA.currentReplicas}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Desired Replicas</p>
							<p class="mt-1 font-mono text-sm">{selectedHPA.desiredReplicas}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Min Pods</p>
							<p class="mt-1 text-sm">{selectedHPA.minPods}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Max Pods</p>
							<p class="mt-1 text-sm">{selectedHPA.maxPods}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedHPA.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedHPA.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Metrics -->
				{#if selectedHPA.metrics && selectedHPA.metrics.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Metrics</h3>
						<div class="space-y-2">
							{#each selectedHPA.metrics as metric, i}
								<div class="rounded-md border bg-muted/40 p-3">
									<pre class="overflow-x-auto font-mono text-[11px]">{JSON.stringify(metric, null, 2)}</pre>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Conditions -->
				{#if selectedHPA.conditions?.length}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Conditions</h3>
						<div class="space-y-2">
							{#each selectedHPA.conditions as condition}
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
					{#if Object.keys(selectedHPA.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedHPA.labels) as [k, v]}
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
					{#if Object.keys(selectedHPA.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedHPA.annotations) as [k, v]}
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

{#if activeCluster && showYamlDialog}
	<ResourceDrawer
		bind:open={showYamlDialog}
		clusterId={activeCluster.id}
		resource={drawerResource}
		onClose={closeYamlEditor}
		onSuccess={handleYamlSuccess}
	/>
{/if}
