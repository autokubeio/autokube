import type { AllTableSettings, TableName, ColumnSetting } from './types';

const STORAGE_KEY = 'autokube-table-preferences';

// ─── Storage helpers ───────────────────────────────────────────────────────────

function loadFromStorage(): AllTableSettings {
	if (typeof window === 'undefined') return {};
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return JSON.parse(stored) as AllTableSettings;
	} catch {
		// Ignore parse errors – fall through to empty object
	}
	return {};
}

function saveToStorage(prefs: AllTableSettings): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		// Ignore storage errors (private browsing, quota exceeded, etc.)
	}
}

// ─── Store factory ─────────────────────────────────────────────────────────────

function createTablePreferencesStore() {
	// Single reactive state object – backed by $state so every getter is
	// automatically tracked inside $derived / Svelte templates.
	let tablePreferences = $state<AllTableSettings>(loadFromStorage());

	// ── Internal helpers ──────────────────────────────────────────────────────

	function _update(updater: (prev: AllTableSettings) => AllTableSettings): void {
		tablePreferences = updater(tablePreferences);
		saveToStorage(tablePreferences);
	}

	async function _syncToServer(tableName: TableName, columns: ColumnSetting[]): Promise<void> {
		try {
			await fetch('/api/preferences/data-table-view', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tableName, columns })
			});
		} catch {
			// Silently fail – localStorage already has the latest value
		}
	}

	// ── Public API ────────────────────────────────────────────────────────────

	return {
		/** Reactive snapshot of all table preferences. Use inside $derived or templates. */
		get current(): AllTableSettings {
			return tablePreferences;
		},

		/**
		 * Load preferences from the server (call once on app mount).
		 * Falls back to localStorage if the request fails.
		 */
		async init(): Promise<void> {
			try {
				const res = await fetch('/api/preferences/data-table-view');
				if (res.ok) {
					const data = await res.json();
					const prefs: AllTableSettings = data.preferences ?? {};
					tablePreferences = prefs;
					saveToStorage(prefs);
				}
			} catch {
				// Use localStorage fallback already loaded in $state initialiser
			}
		},

		/**
		 * Get ordered visible columns for a table (excluding fixed columns).
		 * Returns defaults when no preferences have been saved.
		 */
		getVisibleColumns(tableName: TableName, defaults?: ColumnSetting[]): ColumnSetting[] {
			const tablePrefs = tablePreferences[tableName];

			if (!tablePrefs?.columns?.length) {
				return defaults || [];
			}

			if (!defaults) return tablePrefs.columns.filter((c) => c.visible);

			const savedIds = new Set(tablePrefs.columns.map((c) => c.id));

			// New columns that aren't in saved preferences yet
			const newColumns = defaults.filter((d) => !savedIds.has(d.id));

			return [...tablePrefs.columns.filter((c) => c.visible), ...newColumns];
		},

		/**
		 * Get all columns for a table (visible and hidden) in their saved order.
		 * Appends any new default columns that aren't yet in saved preferences.
		 */
		getAllColumns(tableName: TableName, defaults?: ColumnSetting[]): ColumnSetting[] {
			const tablePrefs = tablePreferences[tableName];

			if (!tablePrefs?.columns?.length) {
				return defaults || [];
			}

			if (!defaults) return tablePrefs.columns;

			const savedIds = new Set(tablePrefs.columns.map((c) => c.id));

			return [...tablePrefs.columns, ...defaults.filter((d) => !savedIds.has(d.id))];
		},

		/** Check whether a specific column is currently visible. */
		isColumnVisible(tableName: TableName, columnId: string): boolean {
			const tablePrefs = tablePreferences[tableName];
			if (!tablePrefs?.columns?.length) return true; // default: visible

			const col = tablePrefs.columns.find((c) => c.id === columnId);
			return col ? col.visible : true;
		},

		/** Set the full column list for a table (visibility + order + optional width). */
		async setColumns(tableName: TableName, columns: ColumnSetting[]): Promise<void> {
			_update((prev) => ({ ...prev, [tableName]: { columns } }));
			await _syncToServer(tableName, columns);
		},

		/** Toggle visibility of a single column. */
		async toggleColumn(tableName: TableName, columnId: string): Promise<void> {
			const allCols = this.getAllColumns(tableName);
			const updated = allCols.map((col) =>
				col.id === columnId ? { ...col, visible: !col.visible } : col
			);
			await this.setColumns(tableName, updated);
		},

		/** Reset a table to its default column config and remove server-side settings. */
		async resettable(tableName: TableName): Promise<void> {
			_update((prev) => {
				const next = { ...prev };
				delete next[tableName];
				return next;
			});

			try {
				await fetch(`/api/preferences/data-table-view?tableName=${tableName}`, { method: 'DELETE' });
			} catch {
				// Silently fail
			}
		},

		/** Save a resized column width for a table. */
		async setColumnWidth(
			tableName: TableName,
			columnId: string,
			width: number,
			defaults?: ColumnSetting[]
		): Promise<void> {
			const allCols = this.getAllColumns(tableName, defaults);
			let found = false;

			const updated = allCols.map((col) => {
				if (col.id === columnId) {
					found = true;
					return { ...col, width };
				}
				return col;
			});

			// Fixed columns may not appear in getAllColumns – append them
			if (!found) updated.push({ id: columnId, visible: true, width });

			await this.setColumns(tableName, updated);
		},

		/** Get the saved width for a specific column (undefined if not customised). */
		getColumnWidth(tableName: TableName, columnId: string): number | undefined {
			const tablePrefs = tablePreferences[tableName];
			if (!tablePrefs?.columns?.length) return undefined;
			return tablePrefs.columns.find((c) => c.id === columnId)?.width;
		},

		/** Get all saved widths as a Map for a table. */
		getColumnWidths(tableName: TableName): Map<string, number> {
			const tablePrefs = tablePreferences[tableName];
			const widths = new Map<string, number>();
			if (tablePrefs?.columns) {
				for (const col of tablePrefs.columns) {
					if (col.width !== undefined) widths.set(col.id, col.width);
				}
			}
			return widths;
		}
	};
}

export const tablePreferencesStore = createTablePreferencesStore();
