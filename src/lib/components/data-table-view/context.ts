/**
 * DataTable Context
 *
 * Provides shared state to child components via Svelte context.
 */

import { getContext, setContext } from 'svelte';
import type { TableContext } from './types';

const DATA_TABLE_CONTEXT_KEY = Symbol('data-table-view');

/**
 * Set the DataTable context (called by DataTable.svelte)
 */
export function setDataTableContext<T>(ctx: TableContext<T>): void {
	setContext(DATA_TABLE_CONTEXT_KEY, ctx);
}

/**
 * Get the DataTable context (called by child components)
 */
export function getDataTableContext<T = unknown>(): TableContext<T> {
	const ctx = getContext<TableContext<T>>(DATA_TABLE_CONTEXT_KEY);
	if (!ctx) {
		throw new Error('DataTable context not found. Ensure component is used within a DataTable.');
	}
	return ctx;
}
