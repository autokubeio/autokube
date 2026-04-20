/**
 * Batched resource watch hook.
 *
 * Drop-in replacement for `useResourceWatch` that buffers ADDED and MODIFIED
 * events for `addDelay` / `modifyDelay` ms before writing to state.  This
 * prevents O(n²) re-renders during the initial burst of ADDED events when a
 * cluster with hundreds of resources is first loaded.
 *
 * Usage:
 * ```ts
 * deploymentsWatch = useBatchWatch<Deployment>({
 *   clusterId: activeCluster.id,
 *   resourceType: 'deployments',
 *   namespace: ns,
 *   getItems: () => allDeployments,
 *   setItems: (v) => { allDeployments = v; },
 *   keyFn: (d) => `${d.namespace}/${d.name}`
 * });
 * deploymentsWatch.subscribe();
 * ```
 */

import { browser } from '$app/environment';
import * as KubeWatch from '$lib/stores/kubernetes-watch';
import type { WatchEvent } from '$lib/stores/kubernetes-watch';

export interface BatchWatchOptions<T> {
	/** Cluster ID to watch */
	clusterId: number;
	/** Resource type (pods, deployments, namespaces, etc.) */
	resourceType: string;
	/** Optional namespace filter. 'all' or undefined = cluster-wide. */
	namespace?: string;
	/** Return the current items array from reactive state */
	getItems: () => T[];
	/** Write the new items array back to reactive state */
	setItems: (items: T[]) => void;
	/** Derive a stable string identity key for an item */
	keyFn: (item: T) => string;
	/**
	 * Optional transform applied when an item is modified.
	 * Receives (existing, incoming) and returns the merged result.
	 * Defaults to replacing the existing item with the incoming item.
	 */
	onModifiedItem?: (existing: T, incoming: T) => T;
	/**
	 * Override the default DELETED behaviour.
	 * If omitted, the matching item is removed from the array.
	 */
	onDeleted?: (item: T) => void;
	/** How long to buffer ADDED events before flushing (ms). Default: 50. */
	addDelay?: number;
	/** How long to buffer MODIFIED events before flushing (ms). Default: 50. */
	modifyDelay?: number;
	/** Called when a watch ERROR event is received */
	onError?: (error: unknown) => void;
}

export function useBatchWatch<T = unknown>(options: BatchWatchOptions<T>) {
	if (!browser) {
		return {
			subscribe: () => {},
			unsubscribe: () => {},
			isActive: false
		};
	}

	// ── Unified batch buffer ────────────────────────────────────────────────
	// All three event types (ADDED / MODIFIED / DELETED) are accumulated in
	// the same 200 ms window and flushed in a single setItems() write.
	//
	// Key property: if the same item is ADDED and DELETED within the same
	// window (e.g. a crash-looping resource) the two events cancel out and
	// the list never changes — preventing the rapid count oscillation that
	// previously caused virtual-scroll jumps.
	//
	// The legacy addDelay / modifyDelay options are kept for back-compat but
	// are ignored — the flush delay is always 200 ms.
	const FLUSH_DELAY = 200;

	let _addBuffer    = new Map<string, T>(); // key → latest ADDED item
	let _modBuffer    = new Map<string, T>(); // key → latest MODIFIED item
	let _delBuffer    = new Set<string>();    // keys to remove
	let _flushTimer: ReturnType<typeof setTimeout> | null = null;

	function flush() {
		_flushTimer = null;

		const adds = _addBuffer;
		const mods = _modBuffer;
		const dels = _delBuffer;
		_addBuffer = new Map();
		_modBuffer = new Map();
		_delBuffer = new Set();

		if (adds.size === 0 && mods.size === 0 && dels.size === 0) return;

		const current = options.getItems();

		// 1. Remove deleted items
		let next = dels.size > 0
			? current.filter((i) => !dels.has(options.keyFn(i)))
			: current;

		// 2. Apply modifications (skip items also deleted in this window)
		if (mods.size > 0) {
			let changed = false;
			next = next.map((item) => {
				const key = options.keyFn(item);
				if (dels.has(key)) return item; // already removed above
				const incoming = mods.get(key);
				if (incoming !== undefined) {
					changed = true;
					return options.onModifiedItem ? options.onModifiedItem(item, incoming) : incoming;
				}
				return item;
			});
			// Handle MODIFIED-before-ADDED upserts
			for (const [key, incoming] of mods) {
				if (dels.has(key)) continue;
				if (!next.some((i) => options.keyFn(i) === key) && !adds.has(key)) {
					next = [...next, incoming];
					changed = true;
				}
			}
			if (!changed) next = current.filter((i) => !dels.has(options.keyFn(i)));
		}

		// 3. Insert new items (skip items deleted in the same window)
		if (adds.size > 0) {
			const existingKeys = new Set(next.map(options.keyFn));
			const fresh: T[] = [];
			for (const [key, item] of adds) {
				if (dels.has(key)) continue;        // add+delete cancelled out
				if (!existingKeys.has(key)) {
					existingKeys.add(key);
					fresh.push(item);
				}
			}
			if (fresh.length > 0) next = [...next, ...fresh];
		}

		options.setItems(next);
	}

	function scheduleFlush() {
		if (!_flushTimer) _flushTimer = setTimeout(flush, FLUSH_DELAY);
	}

	let unsubscribeListener: (() => void) | null = null;
	let isActive = false;

	const handleEvent = (event: WatchEvent) => {
		const item = event.object as T;

		switch (event.type) {
			case 'ADDED': {
				const key = options.keyFn(item);
				_addBuffer.set(key, item);
				_delBuffer.delete(key); // add wins over a stale delete in same window
				scheduleFlush();
				break;
			}
			case 'MODIFIED': {
				const key = options.keyFn(item);
				_modBuffer.set(key, item);
				scheduleFlush();
				break;
			}
			case 'DELETED': {
				const key = options.keyFn(item);
				_delBuffer.add(key);
				_addBuffer.delete(key);  // add+delete in same window → cancel out
				_modBuffer.delete(key);
				if (options.onDeleted) {
					// Custom delete handler: still honour but buffer the side-effect
					// by scheduling the flush (onDeleted will run inside flush).
					// For back-compat we call it immediately here, but note the
					// item has already been removed from add/mod buffers.
					options.onDeleted(item);
				} else {
					scheduleFlush();
				}
				break;
			}
			case 'ERROR': {
				if (options.onError) options.onError(event.object);
				break;
			}
		}
	};

	const watchNamespace = options.namespace === 'all' ? undefined : options.namespace;

	return {
		subscribe() {
			if (isActive) return;
			isActive = true;
			KubeWatch.subscribe(options.clusterId, options.resourceType, watchNamespace);
			unsubscribeListener = KubeWatch.addListener(options.resourceType, handleEvent);
			console.log(
				`[BatchWatch ${options.resourceType}] Subscribed (cluster ${options.clusterId}, ns=${watchNamespace ?? 'all'})`
			);
		},

		unsubscribe() {
			if (!isActive) return;

			// Flush any pending batch before tearing down
			if (_flushTimer !== null) {
				clearTimeout(_flushTimer);
				flush();
			}
			_addBuffer = new Map();
			_modBuffer = new Map();
			_delBuffer = new Set();

			if (unsubscribeListener) {
				unsubscribeListener();
				unsubscribeListener = null;
			}
			KubeWatch.unsubscribe(options.clusterId, options.resourceType, watchNamespace);
			isActive = false;
			console.log(`[BatchWatch ${options.resourceType}] Unsubscribed`);
		},

		get isActive() {
			return isActive;
		}
	};
}
