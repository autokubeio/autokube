<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import ClusterCard from '$lib/components/cluster-card.svelte';
	import { DraggableGrid, type GridItemLayout } from '$lib/components/ui/draggable-grid';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { DEFAULT_LABELS, COLOR_BADGE, COLOR_DOT } from '$lib/components/label-picker.svelte';
	import {
		Search,
		Filter,
		RefreshCw,
		LayoutGrid,
		SortAsc,
		Server,
		Grid2x2,
		Grid3x3,
		Rows3,
		Maximize2,
		RotateCcw,
		Tag
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { dashboardStore, type LayoutPreset } from '$lib/stores/dashboard.svelte';
	import type { ClusterInfo } from '$lib/stores/cluster.svelte';
	import { cn } from '$lib/utils';

	let loading = $state(false);
	let refreshing = $state(false);
	let clusterEvents = $state<Map<number, any[]>>(new Map());
	let gridInitialized = $state(false);
	let containerWidth = $state(0);

	// Base grid config (full desktop)
	const GRID_COLS = 4;
	const GRID_ROW_HEIGHT = 120;
	const SNAP_SIZES = [
		{ w: 1, h: 1 }, // glance
		{ w: 1, h: 2 }, // standard
		{ w: 1, h: 4 }, // detailed
		{ w: 2, h: 4 }  // full
	] as const;

	// Responsive cols based on measured container width
	const activeCols = $derived(
		containerWidth < 480  ? 1 :
		containerWidth < 768  ? 2 :
		containerWidth < 1100 ? 3 : 4
	);
	const activeMaxW = $derived(Math.min(2, activeCols));
	const activeSnapSizes = $derived(
		SNAP_SIZES.filter((s) => s.w <= activeCols)
	);

	// Get filtered and sorted clusters
	const filteredClusters = $derived(dashboardStore.filterAndSort(clusterStore.all));

	// Build grid items from filtered clusters and saved layout
	const gridItems = $derived.by(() => {
		if (!gridInitialized || filteredClusters.length === 0) return [];
		// The store's gridItems is the source of truth — already reconciled by
		// initializeGrid / syncWithClusters with correct preset sizes and positions.
		const savedItems = dashboardStore.gridItems;
		const savedMap = new Map(savedItems.map((item) => [item.id, item]));

		// Only include items for clusters that are currently visible (filtered)
		return filteredClusters
			.map((cluster) => {
				const saved = savedMap.get(cluster.id);
				return saved ? { ...saved } : null;
			})
			.filter((item): item is GridItemLayout => item !== null);
	});

	// Reflow items for the active column count (display only — doesn't affect saved layout)
	const displayItems = $derived.by(() => {
		if (activeCols >= GRID_COLS) return gridItems;
		let x = 0, y = 0, rowMaxH = 0;
		return gridItems.map((item) => {
			const w = Math.min(item.w, activeCols);
			// Move to next row if item doesn't fit
			if (x + w > activeCols) {
				x = 0;
				y += rowMaxH;
				rowMaxH = 0;
			}
			const result = { ...item, x, y, w };
			rowMaxH = Math.max(rowMaxH, item.h);
			x += w;
			// Wrap after filling a row
			if (x >= activeCols) {
				x = 0;
				y += rowMaxH;
				rowMaxH = 0;
			}
			return result;
		});
	});

	// Stats
	const totalClusters = $derived(clusterStore.all.length);
	const onlineClusters = $derived(clusterStore.all.filter((c) => c.status === 'connected').length);
	const offlineClusters = $derived(clusterStore.all.filter((c) => c.status === 'disconnected').length);
	const warningClusters = $derived(clusterStore.all.filter((c) => c.status === 'warning').length);

	// Collect unique labels across all clusters for the filter bar
	const allLabels = $derived.by(() => {
		const set = new Set<string>();
		for (const c of clusterStore.all) {
			for (const l of c.labels) set.add(l);
		}
		return [...set].sort();
	});

	// Find cluster by id
	function findCluster(id: number): ClusterInfo | undefined {
		return clusterStore.all.find((c) => c.id === id);
	}

	onMount(() => {
		let mounted = true;

		(async () => {
			loading = true;
			await clusterStore.fetchClusters();

			// Initialize grid layout from saved or default (loads from API then localStorage)
			await dashboardStore.initializeGrid(clusterStore.all);
			gridInitialized = true;

			// Fetch events for all clusters (non-blocking)
			fetchAllClusterEvents();

			// Start polling for cluster updates
			if (mounted) {
				clusterStore.startPolling();
			}
			loading = false;
		})();

		return () => {
			mounted = false;
			clusterStore.stopPolling();
		};
	});

	// Track cluster ID set — when clusters are added or removed, sync the grid layout
	const clusterIdKey = $derived(clusterStore.all.map((c) => c.id).sort((a, b) => a - b).join(','));

	$effect(() => {
		// Subscribe to clusterIdKey so this only re-runs when cluster IDs change
		clusterIdKey;
		if (gridInitialized) {
			untrack(() => dashboardStore.syncWithClusters(clusterStore.all));
		}
	});

	async function fetchAllClusterEvents() {
		if (clusterStore.all.length === 0) return;

		const eventPromises = clusterStore.all.map(async (cluster) => {
			try {
				const res = await fetch(`/api/clusters/${cluster.id}/events?namespace=all`);
				if (res.ok) {
					const data = await res.json();
					if (data.success && data.events) {
						return { id: cluster.id, events: data.events };
					}
				}
			} catch (err) {
				console.error(`Failed to fetch events for cluster ${cluster.id}:`, err);
			}
			return { id: cluster.id, events: [] };
		});

		const results = await Promise.all(eventPromises);
		clusterEvents = new Map(results.map((r) => [r.id, r.events]));
	}

	async function handleRefresh() {
		refreshing = true;
		await Promise.all([clusterStore.fetchAllStatuses(), fetchAllClusterEvents()]);
		refreshing = false;
	}

	function handleGridChange(items: GridItemLayout[]) {
		dashboardStore.updateGridLayout(items);
	}

	function handleTileClick(id: number) {
		const cluster = findCluster(id);
		if (cluster) dashboardStore.setExpandedCluster(cluster);
	}

	function handleCloseExpanded() {
		dashboardStore.setExpandedCluster(null);
	}

	function handleResetLayout() {
		applyPreset('standard');
	}

	// Preset layout helpers
	function applyPreset(preset: LayoutPreset) {
		if (preset === 'custom') return; // Can't manually apply "custom"
		const sizeMap = {
			glance:   SNAP_SIZES[0], // w=1 h=1
			standard: SNAP_SIZES[1], // w=1 h=2
			detailed: SNAP_SIZES[2], // w=1 h=4
			full:     SNAP_SIZES[3]  // w=2 h=4
		};
		const rawW = sizeMap[preset].w;
		const h = sizeMap[preset].h;
		// Clamp tile width to available columns
		const w = Math.min(rawW, activeCols);
		const cols = activeCols;

		let x = 0, y = 0;
		const newItems: GridItemLayout[] = filteredClusters.map((cluster) => {
			if (x + w > cols) { x = 0; y += h; }
			const item: GridItemLayout = { id: cluster.id, x, y, w, h };
			x += w;
			if (x >= cols) { x = 0; y += h; }
			return item;
		});

		dashboardStore.applyPreset(preset, newItems);
	}
</script>

<svelte:head>
	<title>Dashboard - AutoKube</title>
</svelte:head>

<div class="space-y-6" bind:clientWidth={containerWidth}>
	<!-- Header -->
	<div class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<h1 class="text-lg font-semibold tracking-tight">Cluster Dashboard</h1>
				<Badge variant="outline" class="text-xs tabular-nums">
					<span class="mr-1 inline-block size-1.5 rounded-full bg-green-500"></span>
					{onlineClusters}/{totalClusters}
				</Badge>
			</div>
			<Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" onclick={handleRefresh} disabled={refreshing}>
				<RefreshCw class={cn('size-3', refreshing && 'animate-spin')} />
				Refresh
			</Button>
		</div>

		<!-- Layout presets -->
		<div class="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
			{#each [
				{ id: 'glance',   label: 'Glance',   icon: Grid3x3 },
				{ id: 'standard', label: 'Standard', icon: Grid2x2 },
				{ id: 'detailed', label: 'Detailed', icon: Rows3 },
				{ id: 'full',     label: 'Full',     icon: Maximize2 }
			] as p (p.id)}
				<button
					class={cn(
						'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
						dashboardStore.activePreset === p.id
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => applyPreset(p.id as LayoutPreset)}
				>
					<p.icon class="size-3.5" />{p.label}
				</button>
			{/each}
			{#if dashboardStore.activePreset === 'custom'}
				<button
					class="inline-flex h-7 items-center gap-1.5 rounded-md bg-background px-3 text-xs font-medium text-foreground shadow-sm"
					disabled
				>
					<LayoutGrid class="size-3.5" />Custom
				</button>
			{/if}
			<div class="mx-0.5 h-4 w-px bg-border"></div>
			<button
				class="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
				onclick={handleResetLayout}
			>
				<RotateCcw class="size-3" /> Reset
			</button>
		</div>
	</div>

	<!-- Label filters -->
	{#if allLabels.length > 0}
		<div class="flex items-center gap-2 flex-wrap">
			<Tag class="size-3.5 shrink-0 text-muted-foreground" />
			{#each allLabels as label (label)}
				{@const preset = DEFAULT_LABELS.find((d) => d.name === label)}
				{@const color = preset?.color ?? 'blue'}
				{@const isActive = dashboardStore.filterLabels.includes(label)}
				<button
					class={cn(
						'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium leading-none transition-all',
						isActive
							? cn(COLOR_BADGE[color] ?? COLOR_BADGE.blue, 'ring-1 ring-current/30')
							: 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
					)}
					onclick={() => dashboardStore.toggleLabelFilter(label)}
				>
					<span class={cn('inline-block size-1.5 rounded-full', COLOR_DOT[color] ?? COLOR_DOT.blue)}></span>
					{label}
				</button>
			{/each}
			{#if dashboardStore.filterLabels.length > 0}
				<button
					class="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => dashboardStore.clearLabelFilters()}
				>
					Clear
				</button>
			{/if}
		</div>
	{/if}

	<!-- Cluster Grid -->
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<RefreshCw class="size-8 animate-spin text-muted-foreground" />
		</div>
	{:else if filteredClusters.length === 0}
		<div class="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
			<Server class="size-12 text-muted-foreground/50 mb-4" />
			<p class="text-lg font-medium">No clusters found</p>
			<p class="text-sm text-muted-foreground">
				{dashboardStore.searchQuery || dashboardStore.filterStatus !== 'all'
					? 'Try adjusting your filters'
					: 'Add a cluster to get started'}
			</p>
		</div>
	{:else}
		<DraggableGrid
			items={displayItems}
			cols={activeCols}
			rowHeight={GRID_ROW_HEIGHT}
			gap={12}
			minW={1}
			maxW={activeMaxW}
			minH={1}
			maxH={4}
			snapSizes={[...activeSnapSizes]}
			onchange={handleGridChange}
			onitemclick={handleTileClick}
		>
			{#snippet children({ item, width, height })}
				{@const cluster = findCluster(item.id)}
				{#if cluster}
					<ClusterCard
						{cluster}
						gridW={item.w}
						gridH={item.h}
						recentEvents={(clusterEvents.get(cluster.id) || []).slice(0, 8)}
						dimmed={!dashboardStore.isLabelMatch(cluster)}
					/>
				{/if}
			{/snippet}
		</DraggableGrid>
	{/if}
</div>

<!-- Expanded Cluster Dialog -->
<Dialog.Root open={!!dashboardStore.expandedCluster} onOpenChange={handleCloseExpanded}>
	<Dialog.Content class="max-w-4xl overflow-hidden p-0 gap-0">
		{#if dashboardStore.expandedCluster}
			{@const cluster = dashboardStore.expandedCluster}
			<div class="h-[640px] max-h-[88vh]">
				<ClusterCard
					{cluster}
					gridW={2}
					gridH={4}
					recentEvents={clusterEvents.get(cluster.id) || []}
				/>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
