/**
 * Provisioning Event Bus — lightweight pub/sub for streaming log lines
 * from active Terraform jobs to SSE subscribers.
 *
 * Uses globalThis for HMR-safe singleton (matching the pattern used
 * by notification-monitor.ts in this project).
 */

export interface LogEvent {
	/** Log severity level (info | success | warning | error | k3s). */
	level: string;
	/** Log message text. */
	message: string;
	/** ISO timestamp. */
	createdAt: string;
}

/** Special sentinel published when a job finishes (success or failure). */
export const DONE_EVENT: LogEvent = { level: '__done__', message: '', createdAt: '' };

type Subscriber = (event: LogEvent) => void;

class ProvisioningEventBus {
	private readonly subs = new Map<number, Set<Subscriber>>();

	/**
	 * Subscribe to events for a specific cluster.
	 * Returns an unsubscribe function — call it when the SSE connection closes.
	 */
	subscribe(clusterId: number, fn: Subscriber): () => void {
		if (!this.subs.has(clusterId)) {
			this.subs.set(clusterId, new Set());
		}
		this.subs.get(clusterId)!.add(fn);
		return () => {
			this.subs.get(clusterId)?.delete(fn);
			if (this.subs.get(clusterId)?.size === 0) {
				this.subs.delete(clusterId);
			}
		};
	}

	/** Publish an event to all subscribers of a cluster. */
	publish(clusterId: number, event: LogEvent): void {
		this.subs.get(clusterId)?.forEach((fn) => {
			try {
				fn(event);
			} catch {
				// Ignore errors from individual subscribers (e.g. closed streams)
			}
		});
	}

	/** Returns true if there are active subscribers for the given cluster. */
	hasSubscribers(clusterId: number): boolean {
		return (this.subs.get(clusterId)?.size ?? 0) > 0;
	}
}

// ── HMR-safe singleton ────────────────────────────────────────────────────────

declare const globalThis: typeof global & {
	__autokube_provisioning_bus?: ProvisioningEventBus;
};

export const eventBus: ProvisioningEventBus =
	globalThis.__autokube_provisioning_bus ??
	(globalThis.__autokube_provisioning_bus = new ProvisioningEventBus());
