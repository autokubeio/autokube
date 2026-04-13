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

	const addDelay = options.addDelay ?? 50;
	const modifyDelay = options.modifyDelay ?? 50;

	// Non-reactive buffers — plain JS, no $state
	let _addBuffer: T[] = [];
	let _modBuffer = new Map<string, T>();
	let _addTimer: ReturnType<typeof setTimeout> | null = null;
	let _modTimer: ReturnType<typeof setTimeout> | null = null;

	function flushAdd() {
		_addTimer = null;
		if (_addBuffer.length === 0) return;
		const toAdd = _addBuffer;
		_addBuffer = [];
		const current = options.getItems();
		const existing = new Set(current.map(options.keyFn));
		const fresh = toAdd.filter((item) => !existing.has(options.keyFn(item)));
		if (fresh.length > 0) {
			options.setItems([...current, ...fresh]);
		}
	}

	function flushMod() {
		_modTimer = null;
		if (_modBuffer.size === 0) return;
		const updates = _modBuffer;
		_modBuffer = new Map();
		const current = options.getItems();
		let changed = false;
		const next = current.map((item) => {
			const key = options.keyFn(item);
			const incoming = updates.get(key);
			if (incoming !== undefined) {
				changed = true;
				return options.onModifiedItem ? options.onModifiedItem(item, incoming) : incoming;
			}
			return item;
		});
		if (changed) options.setItems(next);
	}

	let unsubscribeListener: (() => void) | null = null;
	let isActive = false;

	const handleEvent = (event: WatchEvent) => {
		const item = event.object as T;

		switch (event.type) {
			case 'ADDED': {
				_addBuffer.push(item);
				if (_addTimer !== null) clearTimeout(_addTimer);
				_addTimer = setTimeout(flushAdd, addDelay);
				break;
			}
			case 'MODIFIED': {
				const key = options.keyFn(item);
				_modBuffer.set(key, item);
				if (_modTimer !== null) clearTimeout(_modTimer);
				_modTimer = setTimeout(flushMod, modifyDelay);
				break;
			}
			case 'DELETED': {
				// Cancel any pending add/modify for this item
				const key = options.keyFn(item);
				_modBuffer.delete(key);
				_addBuffer = _addBuffer.filter((i) => options.keyFn(i) !== key);
				if (options.onDeleted) {
					options.onDeleted(item);
				} else {
					options.setItems(options.getItems().filter((i) => options.keyFn(i) !== key));
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

			// Flush any pending batches before tearing down
			if (_addTimer !== null) {
				clearTimeout(_addTimer);
				flushAdd();
			}
			if (_modTimer !== null) {
				clearTimeout(_modTimer);
				flushMod();
			}
			_addBuffer = [];
			_modBuffer = new Map();

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
