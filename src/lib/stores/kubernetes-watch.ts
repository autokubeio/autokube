/**
 * Kubernetes SSE Store
 * Manages real-time updates from Kubernetes clusters via Server-Sent Events.
 * Uses the /api/watch/:clusterId/:resource endpoint.
 */

import { browser } from '$app/environment';

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR';

export interface WatchEvent {
	type: WatchEventType;
	object: any;
}

// ─── Internal state ────────────────────────────────────────────────────────────

/** Active EventSource connections keyed by `${clusterId}:${resource}[:${namespace}]` */
const connections = new Map<string, EventSource>();

/** Reconnect timers keyed by connection key */
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Backoff attempt counts keyed by connection key */
const backoffCounts = new Map<string, number>();

/**
 * Keys that received a permanent error (CONFIG_ERROR / AGENT_NOT_SUPPORTED).
 * subscribe() will silently no-op for these until unsubscribe() clears them.
 */
const permanentlyFailed = new Set<string>();

/** Registered event listeners keyed by resource name */
const listeners = new Map<string, Set<(event: WatchEvent) => void>>();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function connectionKey(clusterId: number, resource: string, namespace?: string): string {
	return namespace ? `${clusterId}:${resource}:${namespace}` : `${clusterId}:${resource}`;
}

function notifyListeners(resource: string, event: WatchEvent) {
	listeners.get(resource)?.forEach((cb) => {
		try {
			cb(event);
		} catch (err) {
			console.error(`[SSE] Listener error for ${resource}:`, err);
		}
	});
}

/** Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s */
function getBackoffMs(attempts: number): number {
	return Math.min(1000 * Math.pow(2, attempts), 30_000);
}

function scheduleReconnect(clusterId: number, resource: string, namespace?: string) {
	const key = connectionKey(clusterId, resource, namespace);

	// Cancel any existing timer
	const existing = reconnectTimers.get(key);
	if (existing) clearTimeout(existing);

	const attempts = backoffCounts.get(key) ?? 0;
	const delay = getBackoffMs(attempts);
	backoffCounts.set(key, attempts + 1);

	console.warn(`[SSE] Reconnecting ${resource} in ${delay}ms (attempt ${attempts + 1})…`);

	const timer = setTimeout(() => {
		reconnectTimers.delete(key);
		// Only reconnect if we still want this connection (not unsubscribed)
		if (connections.has(key) || backoffCounts.has(key)) {
			const es = createEventSource(clusterId, resource, namespace);
			connections.set(key, es);
		}
	}, delay);

	reconnectTimers.set(key, timer);
}

function createEventSource(clusterId: number, resource: string, namespace?: string): EventSource {
	const key = connectionKey(clusterId, resource, namespace);
	const nsParam = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
	const url = `/api/watch/${clusterId}/${resource}${nsParam}`;

	const es = new EventSource(url);

	es.onopen = () => {
		// Successful connection — reset backoff
		backoffCounts.delete(key);
		console.log(`[SSE] Connected to ${resource} (cluster ${clusterId})`);
	};

	es.onmessage = (e) => {
		try {
			const data = JSON.parse(e.data) as WatchEvent & { type: string; code?: string };

			if (data.type === 'ADDED' || data.type === 'MODIFIED' || data.type === 'DELETED') {
				notifyListeners(resource, data as WatchEvent);
			} else if (data.type === 'ERROR') {
				if (data.code === 'AGENT_NOT_SUPPORTED' || data.code === 'CONFIG_ERROR') {
					// Permanent error — close and never retry (needs user action to fix)
					console.info(`[SSE] ${resource} watch permanently stopped: ${(data as any).error ?? data.code}`);
					es.close();
					connections.delete(key);
					backoffCounts.delete(key);
					permanentlyFailed.add(key);
					const t = reconnectTimers.get(key);
					if (t) {
						clearTimeout(t);
						reconnectTimers.delete(key);
					}
				} else if (data.code === 'CLUSTER_UNREACHABLE') {
					// K8s API server is down — notify listeners, close and reconnect with backoff
					console.warn(`[SSE] Cluster unreachable for ${resource}, backing off…`);
					notifyListeners(resource, { type: 'ERROR', object: { code: 'CLUSTER_UNREACHABLE' } });
					es.close();
					connections.delete(key);
					scheduleReconnect(clusterId, resource, namespace);
				} else {
					console.error(`[SSE] Watch error for ${resource}:`, (data as any).error);
					// Close and reconnect with backoff instead of leaving the connection open
					es.close();
					connections.delete(key);
					scheduleReconnect(clusterId, resource, namespace);
				}
			}
			// 'connected' messages are silently ignored
		} catch (err) {
			console.error('[SSE] Failed to parse message:', err);
		}
	};

	es.onerror = () => {
		// Only reconnect with backoff if the connection is still wanted
		if (connections.has(key)) {
			// Close the broken EventSource to stop its native reconnect loop
			es.close();
			connections.delete(key);
			scheduleReconnect(clusterId, resource, namespace);
		}
	};

	return es;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Start watching a Kubernetes resource.
 * Safe to call multiple times — re-uses an existing connection for the same key.
 */
export function subscribe(clusterId: number, resource: string, namespace?: string) {
	if (!browser) return;

	const key = connectionKey(clusterId, resource, namespace);

	// Don't reconnect to permanently failed connections (config error, agent, etc.)
	if (permanentlyFailed.has(key)) return;

	// Cancel any pending reconnect timer
	const existingTimer = reconnectTimers.get(key);
	if (existingTimer) {
		clearTimeout(existingTimer);
		reconnectTimers.delete(key);
	}

	// Close stale connection if parameters changed
	const existing = connections.get(key);
	if (existing) {
		if (existing.readyState !== EventSource.CLOSED) return; // already alive
		existing.close();
		connections.delete(key);
	}

	// Reset backoff when explicitly subscribing (user action or page load)
	backoffCounts.delete(key);

	const es = createEventSource(clusterId, resource, namespace);
	connections.set(key, es);
}

/**
 * Stop watching a Kubernetes resource.
 */
export function unsubscribe(clusterId: number, resource: string, namespace?: string) {
	if (!browser) return;

	const key = connectionKey(clusterId, resource, namespace);

	// Cancel any pending reconnect timer
	const timer = reconnectTimers.get(key);
	if (timer) {
		clearTimeout(timer);
		reconnectTimers.delete(key);
	}

	// Clear backoff state
	backoffCounts.delete(key);
	// NOTE: do NOT clear permanentlyFailed here — $effect cleanup calls
	// unsubscribe() before re-running subscribe(), which would reset the flag.
	// Use resetPermanentFailure() to intentionally allow re-subscribing.

	const es = connections.get(key);
	if (es) {
		es.close();
		connections.delete(key);
		console.log(`[SSE] Disconnected from ${resource}`);
	}
}

/**
 * Clear permanent-failure state for a cluster+resource so it can be
 * re-subscribed.  Call this when the user edits/fixes a cluster config.
 */
export function resetPermanentFailure(clusterId: number, resource?: string, namespace?: string) {
	if (resource) {
		permanentlyFailed.delete(connectionKey(clusterId, resource, namespace));
	} else {
		// Clear all keys that start with this clusterId
		for (const key of permanentlyFailed) {
			if (key.startsWith(`${clusterId}:`)) {
				permanentlyFailed.delete(key);
			}
		}
	}
}

/**
 * Register a callback that fires for every ADDED / MODIFIED / DELETED event
 * for the given resource type.  Returns an unsubscribe function.
 *
 * @example
 * const off = addListener('pods', (event) => { … });
 * // later:
 * off();
 */
export function addListener(resource: string, callback: (event: WatchEvent) => void): () => void {
	if (!listeners.has(resource)) {
		listeners.set(resource, new Set());
	}
	listeners.get(resource)!.add(callback);

	return () => {
		listeners.get(resource)?.delete(callback);
	};
}

/**
 * Remove all listeners for a resource (use on page destroy).
 */
export function removeAllListeners(resource: string) {
	listeners.delete(resource);
}
