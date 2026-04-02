/**
 * Metrics Endpoint — GET /metrics
 *
 * Exposes system, process, and application metrics in Prometheus text format (default)
 * or as JSON (via ?format=json or Accept: application/json).
 *
 * Security:
 *   - Returns 404 when disabled via METRICS_ENABLED=false env var or
 *     the "metrics_enabled" DB setting is "false".
 *   - If METRICS_TOKEN env var or "metrics_token" DB setting is configured,
 *     every request must supply it as:
 *       Authorization: Bearer <token>
 *       X-Metrics-Token: <token>
 *   - Without a configured token the endpoint is open (suitable for locked-down
 *     internal deployments; secure with a token for Prometheus scraping over the
 *     public network).
 */

import type { RequestHandler } from './$types';
import {
	collectMetricsSnapshot,
	type MetricsSnapshot
} from '$lib/server/services/metrics-collector';
import { getSetting } from '$lib/server/queries/settings';

// ── Config helpers ────────────────────────────────────────────────────────────

async function isMetricsEnabled(): Promise<boolean> {
	if (Bun.env.METRICS_ENABLED === 'false') return false;
	const db = await getSetting('metrics_enabled').catch(() => null);
	if (db === false || db === 'false') return false;
	return true;
}

async function getMetricsToken(): Promise<string | null> {
	const envToken = Bun.env.METRICS_TOKEN;
	if (envToken) return envToken;
	const db = await getSetting('metrics_token').catch(() => null);
	return typeof db === 'string' && db.length > 0 ? db : null;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function isRequestAuthorized(request: Request, expectedToken: string): boolean {
	// Authorization: Bearer <token>
	const authHeader = request.headers.get('authorization');
	if (authHeader) {
		const [scheme, value] = authHeader.split(' ');
		if (scheme?.toLowerCase() === 'bearer' && value === expectedToken) return true;
	}
	// X-Metrics-Token: <token>
	if (request.headers.get('x-metrics-token') === expectedToken) return true;
	return false;
}

// ── Prometheus rendering ──────────────────────────────────────────────────────

function renderPrometheus(snap: MetricsSnapshot): string {
	const lines: string[] = [];
	const ts = snap.collectedAt;

	function gauge(name: string, help: string, value: number | null, labels = ''): void {
		if (value === null || !isFinite(value)) return;
		lines.push(`# HELP ${name} ${help}`);
		lines.push(`# TYPE ${name} gauge`);
		lines.push(labels ? `${name}{${labels}} ${value} ${ts}` : `${name} ${value} ${ts}`);
	}

	// ── System ──────────────────────────────────────────────────────────────
	gauge(
		'autokube_system_cpu_usage_percent',
		'Host CPU usage as a percentage (0–100), averaged across all cores.',
		snap.system.cpuUsagePercent
	);
	gauge(
		'autokube_system_cpu_count',
		'Number of logical CPU cores on the host.',
		snap.system.cpuCount
	);
	gauge(
		'autokube_system_memory_total_bytes',
		'Total physical memory on the host in bytes.',
		snap.system.memoryTotalBytes
	);
	gauge(
		'autokube_system_memory_used_bytes',
		'Used physical memory on the host in bytes.',
		snap.system.memoryUsedBytes
	);
	gauge(
		'autokube_system_memory_free_bytes',
		'Free physical memory on the host in bytes.',
		snap.system.memoryFreeBytes
	);
	gauge(
		'autokube_system_disk_total_bytes',
		'Total disk capacity of the working-directory filesystem in bytes.',
		snap.system.diskTotalBytes
	);
	gauge(
		'autokube_system_disk_used_bytes',
		'Used disk space of the working-directory filesystem in bytes.',
		snap.system.diskUsedBytes
	);
	gauge(
		'autokube_system_disk_free_bytes',
		'Free disk space of the working-directory filesystem in bytes.',
		snap.system.diskFreeBytes
	);
	gauge(
		'autokube_system_uptime_seconds',
		'Host operating-system uptime in seconds.',
		snap.system.uptimeSeconds
	);

	// ── Process ─────────────────────────────────────────────────────────────
	gauge(
		'autokube_process_memory_rss_bytes',
		'AutoKube process resident set size (RSS) in bytes.',
		snap.process.memoryRssBytes
	);
	gauge(
		'autokube_process_memory_heap_used_bytes',
		'AutoKube process V8 heap memory currently in use, in bytes.',
		snap.process.memoryHeapUsedBytes
	);
	gauge(
		'autokube_process_memory_heap_total_bytes',
		'AutoKube process V8 heap memory allocated in total, in bytes.',
		snap.process.memoryHeapTotalBytes
	);
	gauge(
		'autokube_process_uptime_seconds',
		'AutoKube process uptime since last restart, in seconds.',
		snap.process.uptimeSeconds
	);

	// ── Application ──────────────────────────────────────────────────────────
	gauge(
		'autokube_clusters_total',
		'Total number of clusters registered in AutoKube.',
		snap.app.clustersTotal
	);
	gauge(
		'autokube_agent_connections_active',
		'Number of in-cluster agents currently connected via WebSocket.',
		snap.app.agentConnectionsActive
	);
	gauge(
		'autokube_notification_channels_total',
		'Total number of notification channels configured.',
		snap.app.notificationChannelsTotal
	);
	gauge(
		'autokube_notification_channels_enabled',
		'Number of notification channels that are currently enabled.',
		snap.app.notificationChannelsEnabled
	);

	return lines.join('\n') + '\n';
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ request, url }) => {
	// Feature flag
	if (!(await isMetricsEnabled())) {
		return new Response('Metrics endpoint is disabled.\n', { status: 404 });
	}

	// Token auth (skip if no token is configured)
	const token = await getMetricsToken();
	if (token && !isRequestAuthorized(request, token)) {
		return new Response('Unauthorized\n', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Bearer realm="AutoKube Metrics"' }
		});
	}

	let snapshot: MetricsSnapshot;
	try {
		snapshot = await collectMetricsSnapshot();
	} catch (err) {
		console.error('[Metrics] Failed to collect snapshot:', err);
		return new Response('Internal Server Error\n', { status: 500 });
	}

	// Format negotiation: ?format=json or Accept: application/json
	const formatParam = url.searchParams.get('format');
	const acceptHeader = request.headers.get('accept') ?? '';
	const wantsJson =
		formatParam === 'json' ||
		(acceptHeader.includes('application/json') && !acceptHeader.includes('text/plain'));

	if (wantsJson) {
		return new Response(JSON.stringify(snapshot, null, 2), {
			headers: { 'Content-Type': 'application/json; charset=utf-8' }
		});
	}

	return new Response(renderPrometheus(snapshot), {
		headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }
	});
};
