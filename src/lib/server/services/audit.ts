/**
 * Audit helper — extracts request context and logs an audit event.
 *
 * Usage in API routes:
 *   await audit(event, 'create', 'cluster', { entityId: '1', entityName: 'prod' });
 */

import { authorize } from './authorize';
import type { Cookies } from '@sveltejs/kit';
import { logAuditEvent } from '../queries/audit';
import type { AuditAction, AuditEntityType, AuditLogCreateData } from '../queries';

// ── Types ───────────────────────────────────────────────────────────────────

/** Minimal subset of SvelteKit's RequestEvent needed for audit logging. */
interface AuditRequestEvent {
	request: Request;
	getClientAddress: () => string;
	cookies: Cookies;
}

interface AuditContext {
	userId: number | null;
	username: string;
	ipAddress: string | null;
	userAgent: string | null;
}

interface AuditOptions {
	entityId?: string | null;
	entityName?: string | null;
	clusterId?: number | null;
	description?: string | null;
	details?: Record<string, unknown> | null;
}

// ── Context Extraction ──────────────────────────────────────────────────────

/**
 * Normalize IPv6 addresses to more readable format.
 */
function normalizeIpAddress(ip: string | null): string | null {
	if (!ip) return null;

	// Convert IPv6 loopback to IPv4
	if (ip === '::1' || ip === '::ffff:127.0.0.1') {
		return '127.0.0.1';
	}

	// Strip IPv6 prefix from IPv4-mapped addresses
	if (ip.startsWith('::ffff:')) {
		return ip.substring(7);
	}

	return ip;
}

/**
 * Extract IP address from request headers or connection.
 * Checks x-forwarded-for and x-real-ip headers for proxied requests,
 * falls back to getClientAddress() for direct connections.
 */
function extractIpAddress(event: AuditRequestEvent): string | null {
	const { request, getClientAddress } = event;
	const forwardedFor = request.headers.get('x-forwarded-for');
	const realIp = request.headers.get('x-real-ip');
	let rawIp = forwardedFor?.split(',')[0]?.trim() || realIp || null;

	// Fall back to actual connection IP when no proxy headers exist
	if (!rawIp) {
		try {
			rawIp = getClientAddress();
		} catch {
			// getClientAddress() may throw if address is unavailable
			rawIp = null;
		}
	}

	return normalizeIpAddress(rawIp);
}

/**
 * Extract audit context from request event and authorization.
 */
export async function getAuditContext(event: AuditRequestEvent): Promise<AuditContext> {
	const auth = await authorize(event.cookies);

	return {
		userId: auth.user?.id ?? null,
		username: auth.user?.username ?? 'system',
		ipAddress: extractIpAddress(event),
		userAgent: event.request.headers.get('user-agent') || null
	};
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build audit log data from context and options.
 */
function buildAuditLogData(
	ctx: AuditContext,
	action: AuditAction,
	entityType: AuditEntityType,
	options: AuditOptions
): AuditLogCreateData {
	return {
		userId: ctx.userId,
		username: ctx.username,
		action,
		entityType,
		entityId: options.entityId ?? null,
		entityName: options.entityName ?? null,
		clusterId: options.clusterId ?? null,
		description: options.description ?? null,
		details: options.details ?? null,
		ipAddress: ctx.ipAddress,
		userAgent: ctx.userAgent
	};
}

/**
 * Log an audit event with automatic context extraction.
 * Handles errors gracefully to prevent main operation failures.
 *
 * @param event - The SvelteKit RequestEvent (or object with request + getClientAddress)
 */
export async function audit(
	event: AuditRequestEvent,
	action: AuditAction,
	entityType: AuditEntityType,
	options: AuditOptions = {}
): Promise<void> {
	try {
		const ctx = await getAuditContext(event);
		const data = buildAuditLogData(ctx, action, entityType, options);
		await logAuditEvent(data);
	} catch (error) {
		// Don't let audit logging errors break the main operation
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Audit] Failed to log event:', errorMsg);
	}
}
