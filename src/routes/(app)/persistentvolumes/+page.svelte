<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
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
		Database,
		Info,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type PV,
		type PVWithAge,
		getStatusColor,
		getReclaimPolicyColor,
		formatAccessMode
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, persistentVolumesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allPVs = $state<PV[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let searchQuery = $state('');

	// Search debounce
	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSearch(value: string) {
		if (_searchTimer !== null) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => { searchQuery = value; }, 150);
	}

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedPV = $state<PVWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// PVs with age
	const pvsWithAge = $derived.by((): PVWithAge[] => {
		const currentTime = timeTicker.now;
		return allPVs.map((pv) => ({
			...pv,
			age: calculateAgeWithTicker(pv.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredPVs = $derived.by(() => {
		let result = pvsWithAge;

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(pv) =>
					pv.name.toLowerCase().includes(query) ||
					pv.status.toLowerCase().includes(query) ||
					pv.claim.toLowerCase().includes(query) ||
					pv.storageClass.toLowerCase().includes(query) ||
					pv.reclaimPolicy.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof PV, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let pvsWatch: ReturnType<typeof useBatchWatch<PV>> | null = null;

	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchPVs(clusterId);

			if (pvsWatch) pvsWatch.unsubscribe();

			pvsWatch = useBatchWatch<PV>({


				clusterId,


				resourceType: 'persistentvolumes',


				getItems: () => allPVs,


				setItems: (v) => { allPVs = v; },


				keyFn: (i) => i.name


			});

			pvsWatch.subscribe();
		} else {
			allPVs = [];
			if (pvsWatch) {
				pvsWatch.unsubscribe();
				pvsWatch = null;
			}
		}
	});

	onDestroy(() => {
		pvsWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchPVs(clusterId: number) {
		loading = true;
		error = null;

		try {
			const res = await fetch(`/api/clusters/${clusterId}/persistentvolumes`);
			const data = await res.json();

			if (data.success && data.persistentVolumes) {
				allPVs = data.persistentVolumes;
			} else {
				error = data.error || 'Failed to fetch persistent volumes';
				allPVs = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch persistent volumes';
			allPVs = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/persistentvolumes/${encodeURIComponent(name)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete PV');
			}
			toast.success(`PV "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete PV: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(pv: PVWithAge) {
		selectedPV = pv;
		showDetailDialog = true;
	}

	function openYamlEditor(pv: PVWithAge) {
		drawerResource = { resourceType: 'persistentvolume', name: pv.name };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchPVs(activeClusterId);
	}
</script>

<svelte:head>
	<title>Persistent Volumes - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Persistent Volumes</h1>
			<span class="text-sm text-muted-foreground">
				{filteredPVs.length} of {pvsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchPVs(activeClusterId); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search persistent volumes..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view persistent volumes</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredPVs}
				keyField="id"
				name={TableName.persistentvolumes}
				columns={persistentVolumesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, pv: PVWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Database class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{pv.name}</span>
						</div>
					{:else if column.id === 'capacity'}
						<span class="text-xs font-medium">{pv.capacity}</span>
					{:else if column.id === 'accessModes'}
						<div class="flex gap-1">
							{#each pv.accessModes as mode}
								<Badge variant="secondary" class="px-1 py-0 text-[10px]">
									{formatAccessMode(mode)}
								</Badge>
							{/each}
						</div>
					{:else if column.id === 'reclaimPolicy'}
						<Badge class="{getReclaimPolicyColor(pv.reclaimPolicy)} px-1.5 py-0 text-xs">
							{pv.reclaimPolicy}
						</Badge>
					{:else if column.id === 'status'}
						<Badge class="{getStatusColor(pv.status)} px-1.5 py-0 text-xs">
							{pv.status}
						</Badge>
					{:else if column.id === 'claim'}
						<span class="truncate font-mono text-xs text-muted-foreground">
							{pv.claim || '—'}
						</span>
					{:else if column.id === 'storageClass'}
						<span class="truncate text-xs text-muted-foreground">
							{pv.storageClass || '—'}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{pv.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(pv);
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
									openDetail(pv);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={pv.name}
								loading={deleting}
								onConfirm={() => handleDelete(pv.name)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete PV"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<div class="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
							<Database class="size-6 text-muted-foreground" />
						</div>
						<h3 class="mb-1 font-semibold text-foreground">No persistent volumes found</h3>
						<p class="text-sm">This cluster has no persistent volumes</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading persistent volumes...
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
			<Dialog.Title>Persistent Volume Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedPV}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedPV.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge class="{getStatusColor(selectedPV.status)} px-2 py-0.5 text-xs">
									{selectedPV.status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Capacity</p>
							<p class="mt-1 text-sm font-medium">{selectedPV.capacity}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Reclaim Policy</p>
							<div class="mt-1">
								<Badge
									class="{getReclaimPolicyColor(selectedPV.reclaimPolicy)} px-2 py-0.5 text-xs"
								>
									{selectedPV.reclaimPolicy}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Access Modes</p>
							<div class="mt-1 flex gap-1">
								{#each selectedPV.accessModes as mode}
									<Badge variant="secondary" class="px-1.5 py-0 text-xs">
										{formatAccessMode(mode)}
									</Badge>
								{/each}
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Claim</p>
							<p class="mt-1 font-mono text-sm">{selectedPV.claim || '—'}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Storage Class</p>
							<p class="mt-1 text-sm">{selectedPV.storageClass || '—'}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Volume Mode</p>
							<p class="mt-1 text-sm">{selectedPV.volumeMode}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedPV.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedPV.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedPV.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedPV.labels) as [k, v]}
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
					{#if Object.keys(selectedPV.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedPV.annotations) as [k, v]}
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
