import type { ClusterInfo } from './cluster.svelte';
import type { GridItemLayout } from '$lib/components/ui/draggable-grid';

export type FilterStatus = 'all' | 'online' | 'offline' | 'warning';
export type SortBy = 'name' | 'cpu' | 'memory' | 'nodes';
export type LayoutPreset = 'glance' | 'standard' | 'detailed' | 'full' | 'custom';

const LAYOUT_KEY = 'autokube:dashboard:layout';
const PRESET_KEY = 'autokube:dashboard:preset';
const FILTER_KEY = 'autokube:dashboard:filter';
const SORT_KEY = 'autokube:dashboard:sort';

let gridItems = $state<GridItemLayout[]>([]);
let activePreset = $state<LayoutPreset>('standard');
let searchQuery = $state('');
let filterStatus = $state<FilterStatus>('all');
let filterLabels = $state<string[]>([]);
let sortBy = $state<SortBy>('name');
let expandedCluster = $state<ClusterInfo | null>(null);

/** Debounce handle for saving layout to the API. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// ── Layout utilities ────────────────────────────────────────────────────────

/** Preset tile dimensions. */
const PRESET_SIZES: Record<Exclude<LayoutPreset, 'custom'>, { w: number; h: number }> = {
	glance:   { w: 1, h: 1 },
	standard: { w: 1, h: 2 },
	detailed: { w: 1, h: 4 },
	full:     { w: 2, h: 4 }
};

/** Return the default tile size for the current preset. */
function getPresetDefaultSize(): { w: number; h: number } {
	if (activePreset !== 'custom' && activePreset in PRESET_SIZES) {
		return PRESET_SIZES[activePreset as Exclude<LayoutPreset, 'custom'>];
	}
	return { w: 1, h: 2 };
}

/**
 * Build a uniform grid layout — all tiles get the same size, positioned
 * left-to-right, top-to-bottom in a 4-column grid.
 */
function buildUniformLayout(
	clusterIds: number[],
	size: { w: number; h: number },
	cols: number = 4
): GridItemLayout[] {
	const w = Math.min(size.w, cols);
	let x = 0;
	let y = 0;

	return clusterIds.map((id) => {
		if (x + w > cols) {
			x = 0;
			y += size.h;
		}
		const item: GridItemLayout = { id, x, y, w, h: size.h };
		x += w;
		if (x >= cols) {
			x = 0;
			y += size.h;
		}
		return item;
	});
}

/** Compact items upward to remove vertical gaps caused by removals. */
function compactLayout(items: GridItemLayout[], cols: number = 4): GridItemLayout[] {
	const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
	const placed: GridItemLayout[] = [];

	for (const item of sorted) {
		let bestY = 0;
		// Try to place at the lowest y that doesn't collide
		let searching = true;
		while (searching) {
			const test = { x: item.x, y: bestY, w: item.w, h: item.h };
			let collision = false;
			for (const p of placed) {
				if (
					!(
						test.x + test.w <= p.x ||
						test.x >= p.x + p.w ||
						test.y + test.h <= p.y ||
						test.y >= p.y + p.h
					)
				) {
					collision = true;
					break;
				}
			}
			if (!collision) {
				searching = false;
			} else {
				bestY++;
			}
		}
		placed.push({ ...item, y: bestY });
	}

	return placed;
}

/**
 * Reconcile the grid layout with the current cluster list.
 * Removes items for deleted clusters, adds items for new clusters,
 * and compacts gaps left by removals.
 * When a named preset is active (not 'custom'), enforces uniform tile sizes.
 */
function syncWithClusters(clusters: ClusterInfo[]) {
	if (gridItems.length === 0 && clusters.length === 0) return;

	const clusterIds = new Set(clusters.map((c) => c.id));
	const existingIds = new Set(gridItems.map((item) => item.id));

	const hasRemovals = gridItems.some((item) => !clusterIds.has(item.id));
	const newClusters = clusters.filter((c) => !existingIds.has(c.id));

	if (!hasRemovals && newClusters.length === 0) return;

	// For named presets, rebuild the entire layout with uniform sizes
	if (activePreset !== 'custom') {
		// Preserve order: existing items first (sorted by position), then new clusters
		const existing = gridItems
			.filter((item) => clusterIds.has(item.id))
			.sort((a, b) => a.y - b.y || a.x - b.x);
		const orderedIds = [
			...existing.map((item) => item.id),
			...newClusters.map((c) => c.id)
		];
		gridItems = buildUniformLayout(orderedIds, getPresetDefaultSize());
		saveLayoutToLocalStorage();
		scheduleSaveToApi();
		return;
	}

	// Custom preset: preserve individual tile sizes/positions
	let items = gridItems.filter((item) => clusterIds.has(item.id));

	if (newClusters.length > 0) {
		const maxY = items.length > 0 ? Math.max(...items.map((t) => t.y + t.h)) : 0;
		const cols = 4;
		let x = 0;
		let y = maxY;

		for (const cluster of newClusters) {
			if (x + 1 > cols) {
				x = 0;
				y += 2;
			}
			items.push({
				id: cluster.id,
				x,
				y,
				w: 1,
				h: 2
			});
			x += 1;
		}
	}

	if (hasRemovals) {
		items = compactLayout(items);
	}

	gridItems = items;
	saveLayoutToLocalStorage();
	scheduleSaveToApi();
}

// ── localStorage helpers ────────────────────────────────────────────────────

function loadPreferences() {
	if (typeof window === 'undefined') return;

	try {
		const savedFilter = localStorage.getItem(FILTER_KEY);
		if (savedFilter) filterStatus = savedFilter as FilterStatus;

		const savedSort = localStorage.getItem(SORT_KEY);
		if (savedSort) sortBy = savedSort as SortBy;

		const savedPreset = localStorage.getItem(PRESET_KEY);
		if (savedPreset) activePreset = savedPreset as LayoutPreset;
	} catch {
		// localStorage not available
	}
}

function savePreferences() {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(FILTER_KEY, filterStatus);
		localStorage.setItem(SORT_KEY, sortBy);
	} catch {
		// ignore
	}
}

function saveLayoutToLocalStorage() {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(LAYOUT_KEY, JSON.stringify(gridItems));
		localStorage.setItem(PRESET_KEY, activePreset);
	} catch {
		// ignore
	}
}

// ── API persistence (debounced) ─────────────────────────────────────────────

function scheduleSaveToApi() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(async () => {
		try {
			await fetch('/api/preferences/dashboard-layout', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tiles: gridItems, activePreset })
			});
		} catch (err) {
			console.error('[DashboardStore] Failed to save layout to API:', err);
		}
	}, 800);
}

// ── Initialization ──────────────────────────────────────────────────────────

async function initializeGridLayout(clusters: ClusterInfo[]) {
	// 1. Try to load from the API (database)
	let apiLayout: GridItemLayout[] | null = null;
	let apiPreset: LayoutPreset | null = null;

	try {
		const res = await fetch('/api/preferences/dashboard-layout');
		if (res.ok) {
			const data = await res.json();
			if (data.layout?.tiles?.length) {
				apiLayout = data.layout.tiles;
			}
			if (data.activePreset) {
				apiPreset = data.activePreset;
			}
		}
	} catch {
		// API not reachable — fall through to localStorage
	}

	// 2. Fallback: localStorage
	let localLayout: GridItemLayout[] | null = null;
	try {
		const raw = localStorage.getItem(LAYOUT_KEY);
		if (raw) localLayout = JSON.parse(raw);
	} catch {
		// ignore
	}

	const savedLayout = apiLayout ?? localLayout;

	// Use saved preset if available
	if (apiPreset) {
		activePreset = apiPreset;
	}

	// 3. If we have a saved layout, reconcile it with the current cluster list
	if (savedLayout && savedLayout.length > 0) {
		const clusterIds = new Set(clusters.map((c) => c.id));
		const savedIds = new Set(savedLayout.map((item) => item.id));

		// Keep only tiles whose clusters still exist (preserve order from saved layout)
		const existing = savedLayout.filter((item) => clusterIds.has(item.id));
		// Find clusters not yet in the saved layout
		const newClusters = clusters.filter((c) => !savedIds.has(c.id));

		if (activePreset !== 'custom') {
			// Named preset → enforce uniform sizes; use saved order for existing, append new
			const orderedIds = [
				...existing.map((item) => item.id),
				...newClusters.map((c) => c.id)
			];
			gridItems = buildUniformLayout(orderedIds, getPresetDefaultSize());
		} else {
			// Custom preset → preserve individual tile sizes/positions
			let items = [...existing];

			if (newClusters.length > 0) {
				const maxY = items.length > 0 ? Math.max(...items.map((t) => t.y + t.h)) : 0;
				const cols = 4;
				let x = 0;
				let y = maxY;

				for (const cluster of newClusters) {
					if (x + 1 > cols) {
						x = 0;
						y += 2;
					}
					items.push({
						id: cluster.id,
						x,
						y,
						w: 1,
						h: 2
					});
					x += 1;
				}
			}

			// Compact if any clusters were removed
			if (existing.length < savedLayout.length) {
				items = compactLayout(items);
			}

			gridItems = items;
		}

		saveLayoutToLocalStorage();
		if (newClusters.length > 0 || existing.length < savedLayout.length) {
			scheduleSaveToApi();
		}
		return;
	}

	// 4. No saved layout at all — create a default "standard" layout
	activePreset = 'standard';
	gridItems = buildUniformLayout(
		clusters.map((c) => c.id),
		PRESET_SIZES.standard
	);

	saveLayoutToLocalStorage();
	scheduleSaveToApi();
}

// Filter and sort clusters
function filterAndSortClusters(clusters: ClusterInfo[]): ClusterInfo[] {
	let filtered = clusters;

	// Apply search filter
	if (searchQuery) {
		const query = searchQuery.toLowerCase();
		filtered = filtered.filter(
			(c) =>
				c.name.toLowerCase().includes(query) ||
				c.region.toLowerCase().includes(query) ||
				c.version.toLowerCase().includes(query)
		);
	}

	// Apply status filter
	if (filterStatus !== 'all') {
		filtered = filtered.filter((c) => {
			if (filterStatus === 'online') return c.status === 'connected';
			if (filterStatus === 'offline') return c.status === 'disconnected';
			if (filterStatus === 'warning') return c.status === 'warning';
			return true;
		});
	}

	// NOTE: label filter is NOT applied here — cards are dimmed instead of hidden.
	// Use dashboardStore.isLabelMatch(cluster) to check whether a card should be dimmed.

	// Apply sorting (create a copy to avoid mutation)
	filtered = [...filtered].sort((a, b) => {
		switch (sortBy) {
			case 'name':
				return a.name.localeCompare(b.name);
			case 'cpu':
				return (b.cpuUsage / (b.cpuCapacity || 1)) - (a.cpuUsage / (a.cpuCapacity || 1));
			case 'memory':
				return (
					(b.memoryUsage / (b.memoryCapacity || 1)) - (a.memoryUsage / (a.memoryCapacity || 1))
				);
			case 'nodes':
				return b.nodes - a.nodes;
			default:
				return 0;
		}
	});

	return filtered;
}

export const dashboardStore = {
	get gridItems() {
		return gridItems;
	},
	get searchQuery() {
		return searchQuery;
	},
	get filterStatus() {
		return filterStatus;
	},
	get filterLabels() {
		return filterLabels;
	},
	get sortBy() {
		return sortBy;
	},
	get expandedCluster() {
		return expandedCluster;
	},
	get activePreset() {
		return activePreset;
	},

	setSearchQuery(query: string) {
		searchQuery = query;
	},

	setFilterStatus(status: FilterStatus) {
		filterStatus = status;
		savePreferences();
	},

	toggleLabelFilter(label: string) {
		if (filterLabels.includes(label)) {
			filterLabels = filterLabels.filter((l) => l !== label);
		} else {
			filterLabels = [...filterLabels, label];
		}
	},

	clearLabelFilters() {
		filterLabels = [];
	},

	/** Returns true when a cluster matches the active label filters (or no filters are set). */
	isLabelMatch(cluster: ClusterInfo): boolean {
		return filterLabels.length === 0 || filterLabels.every((l) => cluster.labels.includes(l));
	},

	setSortBy(sort: SortBy) {
		sortBy = sort;
		savePreferences();
	},

	setExpandedCluster(cluster: ClusterInfo | null) {
		expandedCluster = cluster;
	},

	async initializeGrid(clusters: ClusterInfo[]) {
		loadPreferences();
		await initializeGridLayout(clusters);
	},

	/** Called when tiles are dragged/resized by the user — marks layout as "custom". */
	updateGridLayout(items: GridItemLayout[]) {
		gridItems = items;
		activePreset = 'custom';
		saveLayoutToLocalStorage();
		scheduleSaveToApi();
	},

	/** Apply a named preset layout — recalculates all tile positions. */
	applyPreset(preset: LayoutPreset, items: GridItemLayout[]) {
		gridItems = items;
		activePreset = preset;
		saveLayoutToLocalStorage();
		scheduleSaveToApi();
	},

	filterAndSort(clusters: ClusterInfo[]): ClusterInfo[] {
		return filterAndSortClusters(clusters);
	},

	/** Sync grid layout when clusters are added/removed at runtime. */
	syncWithClusters(clusters: ClusterInfo[]) {
		syncWithClusters(clusters);
	},

	resetLayout(clusters: ClusterInfo[]) {
		// Clear saved layout and reinitialize
		try {
			localStorage.removeItem(LAYOUT_KEY);
			localStorage.removeItem(PRESET_KEY);
		} catch {
			// localStorage not available
		}
		activePreset = 'standard';
		initializeGridLayout(clusters);
	}
};
