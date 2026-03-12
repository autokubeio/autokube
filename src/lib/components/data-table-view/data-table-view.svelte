<script lang="ts" generics="T">
	import { type Snippet } from 'svelte';
	import {
		CheckSquare,
		Square as SquareIcon,
		ArrowUp,
		ArrowDown,
		ArrowUpDown,
		ChevronDown,
		ChevronRight
	} from 'lucide-svelte';
	import { columnResize } from './column-resize';
	import { tablePreferencesStore } from './table-settings.svelte';
	import ColumnSettingsPopover from './column-settings-popover.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { ColumnConfig, TableSortState, TableRowState } from './types';
	import { setDataTableContext } from './context';
	import { settingsStore } from '$lib/stores/settings.svelte';

	// ─── Constants ─────────────────────────────────────────────────────────────

	const SELECT_COL = 'select';
	const EXPAND_COL = 'expand';
	const ACTIONS_COL = 'actions';

	// ─── Props ──────────────────────────────────────────────────────────────────

	interface Props {
		// Required
		data: T[];
		keyField: keyof T;
		name: string;
		columns: ColumnConfig[];

		virtualScroll?: boolean;
		rowHeight?: number;
		bufferRows?: number;

		// Selection
		selectable?: boolean;
		selectedKeys?: Set<unknown>;
		onSelectionChange?: (keys: Set<unknown>) => void;
		/** Return false to make a row non-selectable. */
		selectableFilter?: (item: T) => boolean;

		// Sorting
		sortState?: TableSortState;
		onSortChange?: (state: TableSortState | undefined) => void;

		hasMore?: boolean;
		onLoadMore?: () => void;
		loadMoreThreshold?: number;

		onVisibleRangeChange?: (start: number, end: number, total: number) => void;

		onRowClick?: (item: T, event: MouseEvent) => void;
		highlightedKey?: unknown;
		rowClass?: (item: T) => string;

		expandable?: boolean;
		expandedKeys?: Set<unknown>;
		onExpandChange?: (key: unknown, expanded: boolean) => void;
		expandedRow?: Snippet<[T, TableRowState]>;

		loading?: boolean;
		skeletonRows?: number;

		class?: string;
		wrapperClass?: string;

		headerCell?: Snippet<[ColumnConfig, TableSortState | undefined]>;
		cell?: Snippet<[ColumnConfig, T, TableRowState]>;
		emptyState?: Snippet;
		loadingState?: Snippet;
		footer?: Snippet;
	}

	let {
		data,
		keyField,
		name,
		columns,
		virtualScroll = false,
		rowHeight = undefined as number | undefined,
		bufferRows = 10,
		selectable = false,
		selectedKeys = $bindable(new Set<unknown>()),
		onSelectionChange,
		selectableFilter,
		sortState,
		onSortChange,
		hasMore = false,
		onLoadMore,
		loadMoreThreshold = 200,
		onVisibleRangeChange,
		onRowClick,
		highlightedKey,
		rowClass,
		expandable = false,
		expandedKeys = $bindable(new Set<unknown>()),
		onExpandChange,
		expandedRow,
		loading = false,
		skeletonRows = 8,
		class: className = '',
		wrapperClass = '',
		headerCell,
		cell,
		emptyState,
		loadingState,
		footer
	}: Props = $props();

	// ─── Column configuration ──────────────────────────────────────────────────

	const columnConfigMap = $derived(new Map(columns.map((c) => [c.id, c])));
	const fixedStartCols = $derived(columns.filter((c) => c.fixed === 'start').map((c) => c.id));
	const fixedEndCols = $derived(columns.filter((c) => c.fixed === 'end').map((c) => c.id));
	const fixedIds = $derived(new Set([...fixedStartCols, ...fixedEndCols]));
	const configurableColumns = $derived(columns.filter((c) => !c.fixed));

	// Convert columns to ColumnPreference format for grid preferences
	const columnDefaults = $derived(
		columns.map((c) => ({ id: c.id, visible: true, width: c.width }))
	);

	// ─── Preferences & column ordering ────────────────────────────────────────

	const gridPrefs = $derived(tablePreferencesStore.current);

	const orderedColumns = $derived.by(() => {
		const prefs = gridPrefs[name];
		if (!prefs?.columns?.length) {
			return configurableColumns.map((c) => c.id);
		}
		return prefs.columns.filter((c) => c.visible && !fixedIds.has(c.id)).map((c) => c.id);
	});

	// ─── Column widths ─────────────────────────────────────────────────────────

	const savedWidths = $derived.by(() => {
		const widths = new Map<string, number>();
		const prefs = gridPrefs[name];
		if (prefs?.columns) {
			for (const col of prefs.columns) {
				if (col.width !== undefined) widths.set(col.id, col.width);
			}
		}
		return widths;
	});

	/** Local widths during a live drag (not persisted until mouseup). */
	let localWidths = $state<Map<string, number>>(new Map());

	const visibleGrowCols = $derived(orderedColumns.filter((id) => columnConfigMap.get(id)?.grow));

	const growColumnWidth = $derived.by(() => {
		if (!scrollContainerWidth || visibleGrowCols.length === 0) return null;

		let fixedTotal = 0;
		for (const id of fixedStartCols) fixedTotal += getBaseWidth(id);
		for (const id of orderedColumns) {
			if (!visibleGrowCols.includes(id)) fixedTotal += getBaseWidth(id);
		}
		for (const id of fixedEndCols) fixedTotal += getBaseWidth(id);

		const remaining = Math.max(0, scrollContainerWidth - fixedTotal);
		const perCol = remaining / visibleGrowCols.length;
		const minWidth = Math.max(
			...visibleGrowCols.map((id) => columnConfigMap.get(id)?.minWidth ?? 60)
		);
		return Math.max(perCol, minWidth);
	});

	function getBaseWidth(colId: string): number {
		return (
			localWidths.get(colId) ?? savedWidths.get(colId) ?? columnConfigMap.get(colId)?.width ?? 100
		);
	}

	function getDisplayWidth(colId: string): number {
		if (!visibleGrowCols.includes(colId)) return getBaseWidth(colId);
		if (localWidths.has(colId)) return localWidths.get(colId)!;
		if (savedWidths.has(colId)) return savedWidths.get(colId)!;
		return growColumnWidth ?? columnConfigMap.get(colId)?.width ?? 100;
	}

	const totalTableWidth = $derived.by(() => {
		let w = 0;
		for (const id of fixedStartCols) w += getBaseWidth(id);
		for (const id of orderedColumns) w += getDisplayWidth(id);
		for (const id of fixedEndCols) w += getBaseWidth(id);
		return w;
	});

	// ─── Resize handlers ───────────────────────────────────────────────────────

	let resizeRAF: number | null = null;

	function handleResize(colId: string, width: number) {
		if (resizeRAF) return;
		resizeRAF = requestAnimationFrame(() => {
			resizeRAF = null;
			localWidths = new Map(localWidths).set(colId, width);
		});
	}

	async function handleResizeEnd(colId: string, width: number) {
		await tablePreferencesStore.setColumnWidth(name, colId, width, columnDefaults);
		const next = new Map(localWidths);
		next.delete(colId);
		localWidths = next;
	}

	// ─── Selection ─────────────────────────────────────────────────────────────

	function isItemSelectable(item: T): boolean {
		return selectableFilter ? selectableFilter(item) : true;
	}

	const selectableData = $derived(data.filter(isItemSelectable));
	const allSelected = $derived(
		selectableData.length > 0 && selectableData.every((item) => selectedKeys.has(item[keyField]))
	);
	const someSelected = $derived(
		!allSelected && selectableData.some((item) => selectedKeys.has(item[keyField]))
	);

	function isSelected(key: unknown): boolean {
		return selectedKeys.has(key);
	}

	function toggleSelection(key: unknown) {
		const next = new Set(selectedKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedKeys = next;
		onSelectionChange?.(next);
	}

	function selectAll() {
		const next = new Set(selectedKeys);
		for (const item of selectableData) next.add(item[keyField]);
		selectedKeys = next;
		onSelectionChange?.(next);
	}

	function selectNone() {
		const next = new Set(selectedKeys);
		for (const item of selectableData) next.delete(item[keyField]);
		selectedKeys = next;
		onSelectionChange?.(next);
	}

	function toggleSelectAll() {
		allSelected ? selectNone() : selectAll();
	}

	// ─── Expand ────────────────────────────────────────────────────────────────

	function isExpanded(key: unknown): boolean {
		return expandedKeys.has(key);
	}

	function toggleExpand(key: unknown) {
		const next = new Set(expandedKeys);
		const nowExpanded = !next.has(key);
		if (nowExpanded) next.add(key);
		else next.delete(key);
		expandedKeys = next;
		onExpandChange?.(key, nowExpanded);
	}

	// ─── Sort ──────────────────────────────────────────────────────────────────

	function getSortField(colId: string): string {
		return columnConfigMap.get(colId)?.sortField ?? colId;
	}

	function toggleSort(field: string) {
		if (!onSortChange) return;
		if (sortState?.field !== field) {
			// Different column → start at asc
			onSortChange({ field, direction: 'asc' });
		} else if (sortState.direction === 'asc') {
			// asc → desc
			onSortChange({ field, direction: 'desc' });
		} else {
			// desc → clear (default)
			onSortChange(undefined);
		}
	}

	// ─── Virtual scroll state ──────────────────────────────────────────────────

	let scrollContainer = $state<HTMLDivElement | null>(null);
	let scrollTop = $state(0);
	let containerHeight = $state(600);
	let scrollContainerWidth = $state(0);

	const effectiveRowHeight = $derived(rowHeight ?? (settingsStore.compactTableRows ? 27 : 33));

	const totalHeight = $derived(virtualScroll ? data.length * effectiveRowHeight : 0);
	const startIndex = $derived(
		virtualScroll ? Math.max(0, Math.floor(scrollTop / effectiveRowHeight) - bufferRows) : 0
	);
	const endIndex = $derived(
		virtualScroll
			? Math.min(data.length, Math.ceil((scrollTop + containerHeight) / effectiveRowHeight) + bufferRows)
			: data.length
	);
	const offsetY = $derived(virtualScroll ? startIndex * effectiveRowHeight : 0);

	// Stable array slice – avoids allocating a new array on every scroll tick
	let _prevStart = -1,
		_prevEnd = -1,
		_prevData: T[] | null = null,
		_cachedSlice: T[] = [];
	const visibleData = $derived.by(() => {
		if (!virtualScroll) return data;
		if (
			data === _prevData &&
			startIndex === _prevStart &&
			endIndex === _prevEnd &&
			_cachedSlice.length > 0
		) {
			return _cachedSlice;
		}
		_prevStart = startIndex;
		_prevEnd = endIndex;
		_prevData = data;
		_cachedSlice = data.slice(startIndex, endIndex);
		return _cachedSlice;
	});

	let scrollRAF: number | null = null;
	let visibleRangeRAF: number | null = null;
	let loadMorePending = false;

	function handleScroll(event: Event) {
		if (!virtualScroll || scrollRAF) return;
		scrollRAF = requestAnimationFrame(() => {
			scrollRAF = null;
			const el = event.target as HTMLDivElement;
			scrollTop = el.scrollTop;
			containerHeight = el.clientHeight;

			if (hasMore && onLoadMore && !loadMorePending) {
				const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
				if (distFromBottom < loadMoreThreshold) {
					loadMorePending = true;
					onLoadMore();
					setTimeout(() => {
						loadMorePending = false;
					}, 100);
				}
			}
		});
	}

	// Notify parent of the visible row range (throttled)
	$effect(() => {
		if (!virtualScroll || !onVisibleRangeChange || !data.length) return;
		const [st, ch, len, rh, cb] = [
			scrollTop,
			containerHeight,
			data.length,
			effectiveRowHeight,
			onVisibleRangeChange
		];
		if (visibleRangeRAF) cancelAnimationFrame(visibleRangeRAF);
		visibleRangeRAF = requestAnimationFrame(() => {
			visibleRangeRAF = null;
			const vs = Math.max(1, Math.floor(st / rh) + 1);
			const ve = Math.min(len, Math.ceil((st + ch) / rh));
			cb(vs, Math.max(ve, vs), len);
		});
	});

	// ResizeObserver lifecycle – replaces onMount + onDestroy
	let containerResizeRAF: number | null = null;
	$effect(() => {
		const el = scrollContainer;
		if (!el) return;

		scrollContainerWidth = el.clientWidth;
		if (virtualScroll) containerHeight = el.clientHeight;

		const ro = new ResizeObserver((entries) => {
			if (containerResizeRAF) return;
			containerResizeRAF = requestAnimationFrame(() => {
				containerResizeRAF = null;
				for (const entry of entries) {
					scrollContainerWidth = entry.contentRect.width;
					if (virtualScroll) containerHeight = entry.contentRect.height;
				}
			});
		});
		ro.observe(el);

		return () => {
			ro.disconnect();
			if (resizeRAF) cancelAnimationFrame(resizeRAF);
			if (scrollRAF) cancelAnimationFrame(scrollRAF);
			if (visibleRangeRAF) cancelAnimationFrame(visibleRangeRAF);
			if (containerResizeRAF) cancelAnimationFrame(containerResizeRAF);
		};
	});

	// ─── Context (getters keep values reactive for consumers) ─────────────────

	setDataTableContext({
		name: name,
		keyField: keyField as keyof unknown,
		get orderedColumns() {
			return orderedColumns;
		},
		getDisplayWidth,
		getColumnConfig: (id) => columnConfigMap.get(id),
		selectable,
		isSelected,
		toggleSelection,
		selectAll,
		selectNone,
		get allSelected() {
			return allSelected;
		},
		get someSelected() {
			return someSelected;
		},
		get sortState() {
			return sortState;
		},
		toggleSort,
		handleResize,
		handleResizeEnd,
		get highlightedKey() {
			return highlightedKey;
		}
	});

	// ─── Row state (WeakMap cache, invalidated when selection/expansion changes) ──

	let rowStateCache = new WeakMap<object, TableRowState>();
	let _cachedSelKeys: Set<unknown> | null = null;
	let _cachedExpKeys: Set<unknown> | null = null;
	let _cachedHlKey: unknown = undefined;

	function getRowState(item: T, index: number): TableRowState {
		const actualIndex = virtualScroll ? startIndex + index : index;

		if (
			selectedKeys !== _cachedSelKeys ||
			expandedKeys !== _cachedExpKeys ||
			highlightedKey !== _cachedHlKey
		) {
			rowStateCache = new WeakMap();
			_cachedSelKeys = selectedKeys;
			_cachedExpKeys = expandedKeys;
			_cachedHlKey = highlightedKey;
		}

		const cached = rowStateCache.get(item as object);
		if (cached && cached.index === actualIndex) return cached;

		const state: TableRowState = {
			isSelected: isSelected(item[keyField]),
			isHighlighted: highlightedKey === item[keyField],
			isSelectable: isItemSelectable(item),
			isExpanded: isExpanded(item[keyField]),
			index: actualIndex
		};
		rowStateCache.set(item as object, state);
		return state;
	}

	// ─── Column helpers ────────────────────────────────────────────────────────

	function colAlign(config: ColumnConfig): string {
		if (config.align === 'right') return 'text-right';
		if (config.align === 'center') return 'text-center';
		return 'text-left';
	}

	function isResizable(colId: string): boolean {
		const c = columnConfigMap.get(colId);
		return c?.fixed ? c.resizable === true : c?.resizable !== false;
	}

	function isSortable(colId: string): boolean {
		return columnConfigMap.get(colId)?.sortable === true;
	}

	const totalCols = $derived(fixedStartCols.length + orderedColumns.length + fixedEndCols.length);
	const skeletonIndices = $derived(Array.from({ length: skeletonRows }, (_, i) => i));
</script>

<!-- ─── Select icon snippet ──────────────────────────────────────────────────── -->

{#snippet selectIcon(selected: boolean)}
	{#if selected}
		<CheckSquare class="h-3.5 w-3.5 text-muted-foreground" />
	{:else}
		<SquareIcon class="h-3.5 w-3.5 text-muted-foreground" />
	{/if}
{/snippet}

<!-- ─── Table header snippet ─────────────────────────────────────────────────── -->

{#snippet tableHeader()}
	<thead class="sticky top-0 z-10 bg-muted">
		<tr>
			<!-- Fixed start columns (select / expand) -->
			{#each fixedStartCols as colId (colId)}
				{@const colConfig = columnConfigMap.get(colId)}
				<th
					class="px-1 py-2 font-medium"
					class:select-col={colId === SELECT_COL}
					class:expand-col={colId === EXPAND_COL}
					style="width: {getDisplayWidth(colId)}px"
				>
					{#if colId === SELECT_COL && selectable}
						<button
							type="button"
							onclick={toggleSelectAll}
							class="flex cursor-pointer items-center justify-center opacity-40 transition-colors hover:opacity-100"
							title={allSelected ? 'Deselect all' : 'Select all'}
						>
							{@render selectIcon(allSelected || someSelected)}
						</button>
					{:else if colId === EXPAND_COL && expandable}
						<!-- expand header intentionally empty -->
					{:else if headerCell}
						{@render headerCell(colConfig!, sortState)}
					{:else}
						{colConfig?.label ?? ''}
					{/if}
				</th>
			{/each}

			<!-- Configurable columns -->
			{#each orderedColumns as colId (colId)}
				{@const colConfig = columnConfigMap.get(colId)}
				{#if colConfig}
					{@const field = getSortField(colId)}
					<th
						class="px-2 py-2 font-medium {colAlign(colConfig)}"
						style="width: {getDisplayWidth(colId)}px"
					>
						{#if headerCell}
							{@render headerCell(colConfig, sortState)}
						{:else if isSortable(colId)}
							<button
								type="button"
								onclick={() => toggleSort(field)}
								class="flex w-full items-center gap-1 transition-colors hover:text-foreground"
								class:justify-end={colConfig.align === 'right'}
								class:justify-center={colConfig.align === 'center'}
							>
								{colConfig.label}
								{#if sortState?.field === field}
									{#if sortState.direction === 'asc'}
										<ArrowUp class="h-3 w-3" />
									{:else}
										<ArrowDown class="h-3 w-3" />
									{/if}
								{:else}
									<ArrowUpDown class="h-3 w-3 opacity-30" />
								{/if}
							</button>
						{:else}
							{colConfig.label}
						{/if}

						{#if isResizable(colId)}
							<div
								class="resize-handle"
								use:columnResize={{
									onResize: (w) => handleResize(colId, w),
									onResizeEnd: (w) => handleResizeEnd(colId, w),
									minWidth: colConfig.minWidth
								}}
							></div>
						{/if}
					</th>
				{/if}
			{/each}

			<!-- Fixed end columns (actions) -->
			{#each fixedEndCols as colId (colId)}
				{@const colConfig = columnConfigMap.get(colId)}
				<th
					class="actions-col px-2 py-2 text-right font-medium"
					style="width: {getDisplayWidth(colId)}px"
				>
					{#if colId === ACTIONS_COL}
						<div class="flex items-center justify-end gap-1">
							<span>Actions</span>
							<ColumnSettingsPopover {name} {configurableColumns} />
						</div>
					{:else if headerCell}
						{@render headerCell(colConfig!, sortState)}
					{:else}
						{colConfig?.label ?? ''}
					{/if}

					{#if isResizable(colId)}
						<div
							class="resize-handle resize-handle-left"
							use:columnResize={{
								onResize: (w) => handleResize(colId, w),
								onResizeEnd: (w) => handleResizeEnd(colId, w),
								minWidth: colConfig?.minWidth
							}}
						></div>
					{/if}
				</th>
			{/each}
		</tr>
	</thead>
{/snippet}

<!-- ─── Data row snippet (shared by standard + virtual scroll) ───────────────── -->

{#snippet dataRow(item: T, index: number)}
	{@const rowState = getRowState(item, index)}
	<tr
		class="group cursor-pointer {rowState.isHighlighted ? 'selected' : ''} {rowState.isSelected
			? 'checkbox-selected'
			: ''} {rowState.isExpanded ? 'row-expanded' : ''} {rowClass?.(item) ?? ''}"
		onclick={(e) => onRowClick?.(item, e)}
	>
		<!-- Fixed start columns -->
		{#each fixedStartCols as colId (colId)}
			{@const colConfig = columnConfigMap.get(colId)}
			<td
				class="px-1"
				class:py-0.5={settingsStore.compactTableRows}
				class:py-1.5={!settingsStore.compactTableRows}
				class:select-col={colId === SELECT_COL}
				class:expand-col={colId === EXPAND_COL}
				style="width: {getDisplayWidth(colId)}px"
			>
				{#if colId === SELECT_COL && selectable}
					{#if rowState.isSelectable}
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								toggleSelection(item[keyField]);
							}}
							class="flex h-full min-h-[24px] w-full cursor-pointer items-center justify-center transition-colors"
							class:opacity-100={rowState.isSelected}
							class:opacity-0={!rowState.isSelected}
							class:group-hover:opacity-40={!rowState.isSelected}
						>
							{@render selectIcon(rowState.isSelected)}
						</button>
					{/if}
				{:else if colId === EXPAND_COL && expandable}
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							toggleExpand(item[keyField]);
						}}
						class="flex cursor-pointer items-center justify-center opacity-50 transition-colors hover:opacity-100"
						title={rowState.isExpanded ? 'Collapse' : 'Expand'}
					>
						{#if rowState.isExpanded}
							<ChevronDown class="h-4 w-4 text-muted-foreground" />
						{:else}
							<ChevronRight class="h-4 w-4 text-muted-foreground" />
						{/if}
					</button>
				{:else if cell}
					{@render cell(colConfig!, item, rowState)}
				{/if}
			</td>
		{/each}

		<!-- Configurable columns -->
		{#each orderedColumns as colId (colId)}
			{@const colConfig = columnConfigMap.get(colId)}
			{#if colConfig}
				<td
					class="px-2"
					class:py-0.5={settingsStore.compactTableRows}
					class:py-1.5={!settingsStore.compactTableRows}
					class:no-truncate={colConfig.noTruncate}
					style="width: {getDisplayWidth(colId)}px"
				>
					{#if cell}
						{@render cell(colConfig, item, rowState)}
					{:else}
						{String(item[colId as keyof T] ?? '')}
					{/if}
				</td>
			{/if}
		{/each}

		<!-- Fixed end columns (actions) -->
		{#each fixedEndCols as colId (colId)}
			{@const colConfig = columnConfigMap.get(colId)}
			<td
				class="actions-col px-2 text-right"
				class:py-0.5={settingsStore.compactTableRows}
				class:py-1.5={!settingsStore.compactTableRows}
				style="width: {getDisplayWidth(colId)}px"
				onclick={(e) => e.stopPropagation()}
			>
				{#if cell}
					{@render cell(colConfig!, item, rowState)}
				{/if}
			</td>
		{/each}
	</tr>

	<!-- Expanded row content -->
	{#if rowState.isExpanded && expandedRow}
		<tr class="expanded-row">
			<td colspan={totalCols}>
				{@render expandedRow(item, rowState)}
			</td>
		</tr>
	{/if}
{/snippet}

<!-- ─── Skeleton loading snippet ─────────────────────────────────────────────── -->

{#snippet skeletonContent()}
	<table class="data-table-view table-fixed text-sm {className}" style="width: {totalTableWidth}px">
		<thead class="sticky top-0 z-10 bg-muted">
			<tr>
				{#each fixedStartCols as colId (colId)}
					<th
						class="px-1 py-2 font-medium"
						class:select-col={colId === SELECT_COL}
						class:expand-col={colId === EXPAND_COL}
						style="width: {getDisplayWidth(colId)}px"
					></th>
				{/each}

				{#each orderedColumns as colId (colId)}
					{@const colConfig = columnConfigMap.get(colId)}
					{#if colConfig}
						<th
							class="px-2 py-2 font-medium {colAlign(colConfig)}"
							style="width: {getDisplayWidth(colId)}px"
						>
							{colConfig.label}
						</th>
					{/if}
				{/each}

				{#each fixedEndCols as colId (colId)}
					<th
						class="actions-col px-2 py-2 text-right font-medium"
						style="width: {getDisplayWidth(colId)}px"
					>
						{#if colId === ACTIONS_COL}
							<div class="flex items-center justify-end gap-1">
								<span>Actions</span>
								<ColumnSettingsPopover {name} {configurableColumns} />
							</div>
						{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each skeletonIndices as i (i)}
				<tr class="border-b border-muted">
					{#each fixedStartCols as colId (colId)}
						<td
							class="px-1 py-1.5"
							class:select-col={colId === SELECT_COL}
							class:expand-col={colId === EXPAND_COL}
							style="width: {getDisplayWidth(colId)}px"
						>
							<Skeleton class="h-4 w-4" />
						</td>
					{/each}

					{#each orderedColumns as colId (colId)}
						{@const colConfig = columnConfigMap.get(colId)}
						{#if colConfig}
							{@const width = getDisplayWidth(colId)}
							<td
								class="px-2 py-1.5"
								class:no-truncate={colConfig.noTruncate}
								style="width: {width}px"
							>
								<Skeleton
									class="h-4"
									style="width: {Math.max(30, Math.min(width - 16, width * 0.7))}px"
								/>
							</td>
						{/if}
					{/each}

					{#each fixedEndCols as colId (colId)}
						<td class="actions-col px-2 py-1.5" style="width: {getDisplayWidth(colId)}px">
							<Skeleton class="h-4 w-12" />
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<!-- ─── Root ──────────────────────────────────────────────────────────────────── -->

<div
	class="data-table-view-wrapper min-h-0 flex-1 overflow-auto rounded-lg {wrapperClass}"
	bind:this={scrollContainer}
	onscroll={handleScroll}
>
	{#if loading && data.length === 0}
		{#if loadingState}
			{@render loadingState()}
		{:else}
			{@render skeletonContent()}
		{/if}
	{:else if data.length === 0 && emptyState}
		{@render emptyState()}
	{:else if virtualScroll}
		<!-- Virtual scroll: single table with top/bottom spacers -->
		<table class="data-table-view table-fixed text-sm {className}" style="width: {totalTableWidth}px">
			{@render tableHeader()}
			<tbody>
				{#if offsetY > 0}
					<tr
						><td colspan={totalCols} style="height: {offsetY}px; padding: 0; border: none;"
						></td></tr
					>
				{/if}

				{#each visibleData as item, index (item[keyField])}
					{@render dataRow(item, index)}
				{/each}

				{#if totalHeight - offsetY - visibleData.length * effectiveRowHeight > 0}
					<tr
						><td
							colspan={totalCols}
							style="height: {totalHeight -
								offsetY -
								visibleData.length * effectiveRowHeight}px; padding: 0; border: none;"
						></td></tr
					>
				{/if}

				{#if footer}
					<tr><td colspan={totalCols} class="border-none p-0">{@render footer()}</td></tr>
				{/if}
			</tbody>
		</table>
	{:else}
		<!-- Standard mode -->
		<table class="data-table-view table-fixed text-sm {className}" style="width: {totalTableWidth}px">
			{@render tableHeader()}
			<tbody>
				{#each visibleData as item, index (item[keyField])}
					{@render dataRow(item, index)}
				{/each}

				{#if footer}
					<tr><td colspan={totalCols} class="border-none p-0">{@render footer()}</td></tr>
				{/if}
			</tbody>
		</table>
	{/if}
</div>
