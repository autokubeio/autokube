export { default as DataTableView } from './data-table-view.svelte';
export { default as ColumnSettingsPopover } from './column-settings-popover.svelte';

// ─── Stores / Actions ─────────────────────────────────────────────────────────

export { tablePreferencesStore } from './table-settings.svelte';
export { columnResize } from './column-resize';
export type { ColumnResizeParams } from './column-resize';

// ─── Context ──────────────────────────────────────────────────────────────────

export { setDataTableContext, getDataTableContext } from './context';

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
	// Base / shared
	TableName as Name,
	ColumnConfig,
	ColumnSetting as ColumnPreference,
	TableColumnSettings as TableColumnPreferences,
	AllTableSettings as AllTablePreferences,
	// Component
	TableSortState as DataTableSortState,
	TableRowState as DataTableRowState,
	TableProps as DataTableProps,
	TableContext as DataTableContext
} from './types';
