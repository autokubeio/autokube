<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Network,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import type { GatewayClassInfo } from '$lib/server/services/kubernetes';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, gatewayClassesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	type GatewayClassRow = GatewayClassInfo & { age: string };

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allItems = $state<GatewayClassInfo[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let crdMissing = $state(false);
	let searchQuery = $state('');
	let deleting = $state(false);

	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSearch(value: string) {
		if (_searchTimer !== null) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => {
			searchQuery = value;
		}, 150);
	}

	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);
	const timeTicker = createTimeTicker(10000);
	let sortState = $state<DataTableSortState | undefined>(undefined);

	const rowsWithAge = $derived.by((): GatewayClassRow[] => {
		const now = timeTicker.now;
		return allItems.map((g) => ({ ...g, age: calculateAgeWithTicker(g.createdAt, now) }));
	});

	const filteredRows = $derived.by(() => {
		let result = rowsWithAge;
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(r) => r.name.toLowerCase().includes(q) || r.controllerName.toLowerCase().includes(q)
			);
		}
		if (sortState) {
			result = arraySort(result, sortState.field as keyof GatewayClassInfo, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}
		return result;
	});

	let watchHandle: ReturnType<typeof useBatchWatch<GatewayClassInfo>> | null = null;

	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchItems(clusterId);
			if (watchHandle) watchHandle.unsubscribe();
			watchHandle = useBatchWatch<GatewayClassInfo>({
				clusterId,
				resourceType: 'gatewayclasses',
				getItems: () => allItems,
				setItems: (v) => {
					allItems = v;
				},
				keyFn: (g) => g.name
			});
			watchHandle.subscribe();
		} else {
			allItems = [];
			watchHandle?.unsubscribe();
			watchHandle = null;
		}
	});

	onDestroy(() => {
		watchHandle?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchItems(clusterId: number) {
		loading = true;
		error = null;
		crdMissing = false;
		try {
			const res = await fetch(`/api/clusters/${clusterId}/gatewayclasses`);
			const data = await res.json();
			if (data.success) {
				allItems = data.gatewayClasses ?? [];
				crdMissing = !!data.crdMissing;
			} else {
				error = data.error || 'Failed to fetch gateway classes';
				allItems = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch gateway classes';
			allItems = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string) {
		if (!activeCluster?.id) return;
		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/gatewayclasses/${encodeURIComponent(name)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete gateway class');
			}
			toast.success(`GatewayClass "${name}" deleted`);
		} catch (err: unknown) {
			toast.error(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			deleting = false;
		}
	}

	function openYaml(g: GatewayClassRow) {
		drawerResource = { resourceType: 'gatewayclass', name: g.name };
		showYamlDialog = true;
	}

	function closeYaml() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchItems(activeClusterId);
	}
</script>

<svelte:head><title>Gateway Classes - AutoKube</title></svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Gateway Classes</h1>
			<span class="text-sm text-muted-foreground"
				>{filteredRows.length} of {rowsWithAge.length}</span
			>
			<Badge variant="outline" class="text-[10px]">beta</Badge>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => {
					if (activeClusterId) fetchItems(activeClusterId);
				}}
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
					placeholder="Search..."
					class="h-8 w-full pl-8 text-xs sm:w-56"
					value={searchQuery}
					oninput={(e) => scheduleSearch(e.currentTarget.value)}
				/>
			</div>
		</div>
	</div>

	{#if error}
		<div
			class="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
		>
			<AlertCircle class="size-4 shrink-0" />
			<span class="text-sm">{error}</span>
		</div>
	{/if}

	{#if !loading && !error && !activeCluster}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div><h3 class="mb-1 font-semibold">No cluster selected</h3></div>
		</div>
	{:else if !loading && !error && crdMissing}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Network class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">Gateway API not installed</h3>
				<p class="text-sm text-muted-foreground">
					This cluster does not have the <code class="font-mono">gateway.networking.k8s.io</code> CRDs
					installed.
				</p>
			</div>
		</div>
	{:else if !loading && !error && allItems.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Network class="size-6 text-muted-foreground" />
			</div>
			<div><h3 class="mb-1 font-semibold">No gateway classes found</h3></div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredRows}
				keyField="id"
				name={TableName.gatewayclasses}
				columns={gatewayClassesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openYaml}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, g: GatewayClassRow)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Network class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{g.name}</span>
						</div>
					{:else if column.id === 'controller'}
						<span class="truncate font-mono text-xs">{g.controllerName || '—'}</span>
					{:else if column.id === 'accepted'}
						<Badge
							variant={g.accepted === 'True' ? 'default' : 'outline'}
							class={cn('text-xs', g.accepted === 'False' && 'text-destructive')}
						>
							{g.accepted}
						</Badge>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{g.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYaml(g);
								}}
								title="Edit YAML"
							>
								<FileCode class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={g.name}
								loading={deleting}
								onConfirm={() => handleDelete(g.name)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:cursor-pointer hover:text-destructive"
									title="Delete gateway class"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Network class="mb-3 h-10 w-10 opacity-40" />
						<p>No gateway classes found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

{#if activeCluster && showYamlDialog}
	<ResourceDrawer
		bind:open={showYamlDialog}
		clusterId={activeCluster.id}
		resource={drawerResource}
		onClose={closeYaml}
		onSuccess={handleYamlSuccess}
	/>
{/if}
