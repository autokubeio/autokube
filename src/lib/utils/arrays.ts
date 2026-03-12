/**
 * Immutable array update utilities for Svelte 5 runes
 * These functions return new arrays, perfect for use with $state
 * 
 * @example
 * ```typescript
 * let items = $state<Item[]>([]);
 * 
 * // Add item if not exists
 * items = arrayAdd(items, newItem, (item) => item.id);
 * 
 * // Update existing or add new
 * items = arrayModify(items, updatedItem, (item) => item.id);
 * 
 * // Remove by item or by key
 * items = arrayDelete(items, itemToRemove, (item) => item.id);
 * items = arrayDelete(items, 'item-id', (item) => item.id);
 * 
 * // With watch callbacks
 * useResourceWatch({
 *   onAdded: (item) => items = arrayAdd(items, item, (i) => i.id),
 *   onModified: (item) => items = arrayModify(items, item, (i) => i.id),
 *   onDeleted: (item) => items = arrayDelete(items, item, (i) => i.id)
 * });
 * ```
 */

/**
 * Add an item to array if it doesn't already exist
 * @param array - Source array
 * @param item - Item to add
 * @param keyFn - Function to extract unique key from item (defaults to identity)
 * @returns New array with item added (or original if duplicate)
 */
export function arrayAdd<T>(
	array: T[],
	item: T,
	keyFn: (item: T) => any = (x) => x
): T[] {
	const itemKey = keyFn(item);
	const exists = array.some((x) => keyFn(x) === itemKey);
	return exists ? array : [...array, item];
}

/**
 * Update an item in array if it exists, otherwise add it
 * @param array - Source array
 * @param item - Item to update/add
 * @param keyFn - Function to extract unique key from item
 * @returns New array with item updated or added
 */
export function arrayModify<T>(
	array: T[],
	item: T,
	keyFn: (item: T) => any
): T[] {
	const itemKey = keyFn(item);
	const index = array.findIndex((x) => keyFn(x) === itemKey);
	
	if (index === -1) {
		// Not found, add it
		return [...array, item];
	}
	
	// Found, replace it
	return [...array.slice(0, index), item, ...array.slice(index + 1)];
}

/**
 * Remove an item from array by key
 * @param array - Source array
 * @param item - Item to remove (or key value)
 * @param keyFn - Function to extract unique key from item
 * @returns New array with item removed
 */
export function arrayDelete<T>(
	array: T[],
	item: T | any,
	keyFn: (item: T) => any
): T[] {
	const itemKey = typeof item === 'object' ? keyFn(item) : item;
	return array.filter((x) => keyFn(x) !== itemKey);
}

/**
 * Upsert (update or insert) an item in array
 * Alias for arrayModify with clearer name
 */
export const arrayUpsert = arrayModify;

/**
 * Toggle item in array - add if missing, remove if present
 * @param array - Source array
 * @param item - Item to toggle
 * @param keyFn - Function to extract unique key from item (defaults to identity)
 * @returns New array with item toggled
 */
export function arrayToggle<T>(
	array: T[],
	item: T,
	keyFn: (item: T) => any = (x) => x
): T[] {
	const itemKey = keyFn(item);
	const index = array.findIndex((x) => keyFn(x) === itemKey);
	
	if (index === -1) {
		return [...array, item];
	}
	
	return [...array.slice(0, index), ...array.slice(index + 1)];
}

/**
 * Custom comparator function type for sorting
 */
export type ArraySortComparator<T> = (a: T, b: T) => number;

/**
 * Field-specific value transformers for sorting
 */
export type ArraySortTransforms<T> = Partial<{
	[K in keyof T]: (value: T[K]) => any;
}>;

/**
 * Sort array by field with automatic type detection and custom transforms
 * @param array - Source array
 * @param field - Field name to sort by
 * @param direction - Sort direction ('asc' or 'desc')
 * @param transforms - Optional field-specific value transformers
 * @returns New sorted array
 * 
 * @example
 * ```typescript
 * // Simple sort
 * sorted = arraySort(items, 'name', 'asc');
 * 
 * // With date transform
 * sorted = arraySort(items, 'createdAt', 'desc', {
 *   createdAt: (val: any) => new Date(val).getTime()
 * });
 * 
 * // With object property transform
 * sorted = arraySort(items, 'labels', 'asc', {
 *   labels: (val: any) => Object.keys(val).length
 * });
 * ```
 */
export function arraySort<T extends Record<string, any>>(
	array: T[],
	field: keyof T,
	direction: 'asc' | 'desc' = 'asc',
	transforms?: ArraySortTransforms<T>
): T[] {
	return [...array].sort((a, b) => {
		let aVal: any = a[field];
		let bVal: any = b[field];

		// Apply custom transform if provided
		if (transforms && field in transforms) {
			const transform = transforms[field as keyof typeof transforms];
			if (transform) {
				aVal = transform(aVal);
				bVal = transform(bVal);
			}
		}

		// Handle null/undefined
		if (aVal == null) aVal = '';
		if (bVal == null) bVal = '';

		// Compare
		let comparison = 0;
		if (typeof aVal === 'number' && typeof bVal === 'number') {
			comparison = aVal - bVal;
		} else {
			comparison = String(aVal).localeCompare(String(bVal));
		}

		return direction === 'asc' ? comparison : -comparison;
	});
}

/**
 * Multi-field sort with priority (primary, secondary, etc.)
 * @param array - Source array
 * @param sorts - Array of sort configurations in priority order
 * @returns New sorted array
 * 
 * @example
 * ```typescript
 * sorted = arraySortMulti(items, [
 *   { field: 'status', direction: 'asc' },
 *   { field: 'name', direction: 'asc' }
 * ]);
 * ```
 */
export function arraySortMulti<T extends Record<string, any>>(
	array: T[],
	sorts: Array<{
		field: keyof T;
		direction?: 'asc' | 'desc';
		transform?: (value: any) => any;
	}>
): T[] {
	return [...array].sort((a, b) => {
		for (const { field, direction = 'asc', transform } of sorts) {
			let aVal: any = a[field];
			let bVal: any = b[field];

			// Apply transform if provided
			if (transform) {
				aVal = transform(aVal);
				bVal = transform(bVal);
			}

			// Handle null/undefined
			if (aVal == null) aVal = '';
			if (bVal == null) bVal = '';

			// Compare
			let comparison = 0;
			if (typeof aVal === 'number' && typeof bVal === 'number') {
				comparison = aVal - bVal;
			} else {
				comparison = String(aVal).localeCompare(String(bVal));
			}

			if (comparison !== 0) {
				return direction === 'asc' ? comparison : -comparison;
			}
		}
		return 0;
	});
}
