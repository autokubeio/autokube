/**
 * DataGrid Types
 *
 * Single source of truth for all DataGrid types:
 *   - Base column / grid config types (formerly in types-grid.ts)
 *   - Component-specific interfaces (props, context, row / sort state)
 */

import type { Snippet } from 'svelte';

// ─── Base Grid Types ───────────────────────────────────────────────────────────

/**
 * Grid identifier type - can be any string.
 * When consuming this package, you can narrow this type for better autocomplete:
 *
 * @example
 * ```typescript
 * type TableName = 'users' | 'products' | 'orders';
 * const grid: DataGridProps<User> = { tableName: 'users' as TableName, ... };
 * ```
 */
export type TableName = string;

/** Definition of a single grid column. */
export interface ColumnConfig {
	id: string;
	label: string;
	width?: number;
	minWidth?: number;
	resizable?: boolean;
	sortable?: boolean;
	/** Override which data field drives sorting (defaults to `id`). */
	sortField?: string;
	/** Pin to the start or end of the table and make it non-hideable. */
	fixed?: 'start' | 'end';
	align?: 'left' | 'center' | 'right';
	/** Expands to fill remaining horizontal space. */
	grow?: boolean;
	/** Disable ellipsis truncation on cell content. */
	noTruncate?: boolean;
}

/** Per-column user preference (visibility + saved width). */
export interface ColumnSetting {
	id: string;
	visible: boolean;
	width?: number;
}

/** Stored preferences for a single table. */
export interface TableColumnSettings {
	columns: ColumnSetting[];
}

/** Full preferences map for all tables, keyed by TableId. */
export type AllTableSettings = Partial<Record<TableName, TableColumnSettings>>;

// ─── Component Types ──────────────────────────────────────────────────────────

/** Current sort state of the grid. */
export interface TableSortState {
	field: string;
	direction: 'asc' | 'desc';
}

/**
 * Row state passed to cell snippets
 */
export interface TableRowState {
	isSelected: boolean;
	isHighlighted: boolean;
	isSelectable: boolean;
	isExpanded: boolean;
	index: number;
}

/**
 * Main DataGrid component props
 */
export interface TableProps<T> {
	// Required
	data: T[];
	keyField: keyof T;
	name: string;
	columns: ColumnConfig[];

	// Virtual Scroll Mode (OFF by default)
	virtualScroll?: boolean;
	rowHeight?: number;
	bufferRows?: number;

	// Selection
	selectable?: boolean;
	selectedKeys?: Set<unknown>;
	onSelectionChange?: (keys: Set<unknown>) => void;

	// Sorting
	sortState?: TableSortState;
	onSortChange?: (state: TableSortState | undefined) => void;

	// Infinite scroll (virtual mode)
	hasMore?: boolean;
	onLoadMore?: () => void;
	loadMoreThreshold?: number;

	// Row interaction
	onRowClick?: (item: T, event: MouseEvent) => void;
	highlightedKey?: unknown;
	rowClass?: (item: T) => string;

	// State
	loading?: boolean;

	// CSS
	class?: string;
	wrapperClass?: string;

	// Snippets for customization
	headerCell?: Snippet<[ColumnConfig, TableSortState | undefined]>;
	cell?: Snippet<[ColumnConfig, T, TableRowState]>;
	emptyState?: Snippet;
	loadingState?: Snippet;
}

/**
 * Context provided to child components
 */
export interface TableContext<T = unknown> {
	// Grid configuration
	name: TableName;
	keyField: keyof T;

	// Column state
	orderedColumns: string[];
	getDisplayWidth: (colId: string) => number;
	getColumnConfig: (colId: string) => ColumnConfig | undefined;

	// Selection helpers
	selectable: boolean;
	isSelected: (key: unknown) => boolean;
	toggleSelection: (key: unknown) => void;
	selectAll: () => void;
	selectNone: () => void;
	allSelected: boolean;
	someSelected: boolean;

	// Sort helpers
	sortState: TableSortState | undefined;
	toggleSort: (field: string) => void;

	// Resize helpers
	handleResize: (colId: string, width: number) => void;
	handleResizeEnd: (colId: string, width: number) => void;

	// Row state
	highlightedKey: unknown;
}
