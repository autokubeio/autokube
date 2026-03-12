import { EventEmitter } from 'events';
import type { AuditLogWithCluster } from '../queries/audit';

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_LISTENERS = 1000; // Allow many concurrent SSE/WebSocket clients

// ── Types ───────────────────────────────────────────────────────────────────

export type AuditEvent = AuditLogWithCluster;

type AuditSubscriber = (data: AuditEvent) => void;

// ── Event Emitter ───────────────────────────────────────────────────────────

/**
 * Singleton event emitter for audit log events.
 * Supports real-time broadcasting to connected clients via SSE/WebSocket.
 */
class AuditEventEmitter extends EventEmitter {
	constructor() {
		super();
		this.setMaxListeners(MAX_LISTENERS);
	}

	emit(event: 'audit', data: AuditEvent): boolean {
		return super.emit(event, data);
	}

	on(event: 'audit', listener: AuditSubscriber): this {
		return super.on(event, listener);
	}

	off(event: 'audit', listener: AuditSubscriber): this {
		return super.off(event, listener);
	}

	once(event: 'audit', listener: AuditSubscriber): this {
		return super.once(event, listener);
	}

	removeAllListeners(event?: 'audit'): this {
		return super.removeAllListeners(event);
	}

	listenerCount(event: 'audit'): number {
		return super.listenerCount(event);
	}
}

export const auditEvents = new AuditEventEmitter();

// ── Public Functions ────────────────────────────────────────────────────────

/**
 * Emit an audit event to all subscribers.
 * @param data - The audit log entry with cluster information
 */
export function emitAudit(data: AuditEvent): void {
	auditEvents.emit('audit', data);
}

/**
 * Subscribe to audit events.
 * @param listener - Callback invoked on each audit event
 * @returns Unsubscribe function
 */
export function subscribeAudit(listener: AuditSubscriber): () => void {
	auditEvents.on('audit', listener);
	return () => auditEvents.off('audit', listener);
}

/**
 * Count active audit event subscribers.
 * @returns Number of registered subscribers
 */
export function countAuditSubscribers(): number {
	return auditEvents.listenerCount('audit');
}
