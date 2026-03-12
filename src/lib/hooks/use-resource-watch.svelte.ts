/**
 * Composable for Kubernetes resource watching via SSE
 * Reusable across all resource pages (pods, deployments, namespaces, etc.)
 */

import { browser } from '$app/environment';
import * as KubeWatch from '$lib/stores/kubernetes-watch';
import type { WatchEvent } from '$lib/stores/kubernetes-watch';

export interface ResourceWatchOptions<T> {
	/** Cluster ID to watch */
	clusterId: number;
	/** Resource type (pods, deployments, namespaces, etc.) */
	resourceType: string;
	/** Optional namespace filter */
	namespace?: string;
	/** Callback when resource is added */
	onAdded?: (item: T) => void;
	/** Callback when resource is modified */
	onModified?: (item: T) => void;
	/** Callback when resource is deleted */
	onDeleted?: (item: T) => void;
	/** Callback on error */
	onError?: (error: unknown) => void;
}

/**
 * Hook for watching Kubernetes resources in real-time
 *
 * @example
 * const watch = useResourceWatch({
 *   clusterId: activeCluster.id,
 *   resourceType: 'pods',
 *   namespace: selectedNamespace,
 *   onAdded: (pod) => { pods = [...pods, pod]; },
 *   onModified: (pod) => { updatePod(pod); },
 *   onDeleted: (pod) => { removePod(pod); }
 * });
 *
 * // Setup watch
 * watch.subscribe();
 *
 * // Later, cleanup
 * watch.unsubscribe();
 */
export function useResourceWatch<T = unknown>(options: ResourceWatchOptions<T>) {
	if (!browser) {
		return {
			subscribe: () => {},
			unsubscribe: () => {},
			isActive: false
		};
	}

	let unsubscribeListener: (() => void) | null = null;
	let isActive = false;

	const handleEvent = (event: WatchEvent) => {
		const item = event.object as T;

		switch (event.type) {
			case 'ADDED':
				if (options.onAdded) {
					options.onAdded(item);
				}
				break;

			case 'MODIFIED':
				if (options.onModified) {
					options.onModified(item);
				}
				break;

			case 'DELETED':
				if (options.onDeleted) {
					options.onDeleted(item);
				}
				break;

			case 'ERROR':
				console.error(`[Watch ${options.resourceType}] Error:`, event);
				if (options.onError) {
					options.onError(event);
				}
				break;
		}
	};

	const subscribe = () => {
		if (isActive) {
			console.warn(`[Watch ${options.resourceType}] Already subscribed`);
			return;
		}

		const watchNamespace = options.namespace === 'all' ? undefined : options.namespace;

		// Subscribe to resource events via kubernetes-watch store
		KubeWatch.subscribe(options.clusterId, options.resourceType, watchNamespace);

		// Register event listener
		unsubscribeListener = KubeWatch.addListener(options.resourceType, handleEvent);

		isActive = true;

		console.log(
			`[Watch ${options.resourceType}] Subscribed (cluster ${options.clusterId}, ns=${watchNamespace ?? 'all'})`
		);
	};

	const unsubscribe = () => {
		if (!isActive) return;

		const watchNamespace = options.namespace === 'all' ? undefined : options.namespace;

		KubeWatch.unsubscribe(options.clusterId, options.resourceType, watchNamespace);

		if (unsubscribeListener) {
			unsubscribeListener();
			unsubscribeListener = null;
		}

		isActive = false;

		console.log(`[Watch ${options.resourceType}] Unsubscribed`);
	};

	return {
		subscribe,
		unsubscribe,
		get isActive() {
			return isActive;
		}
	};
}
