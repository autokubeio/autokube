/**
 * Background Scan Scheduler
 *
 * Periodically checks scan schedules and triggers automatic scans.
 * Uses globalThis for HMR-safe singleton pattern (same as notification-monitor).
 */

import { listScanSchedules } from '../queries/image-scans';
import { upsertScanSchedule } from '../queries/image-scans';
import { executeScanBatch, extractWorkloadImages } from './image-scanner';
import { makeClusterRequest } from './kubernetes/utils';
import { getScanConcurrency } from '../queries/settings';

// ── Configuration ───────────────────────────────────────────────────────────

/** How often to check for due scans (default: 60 seconds) */
const CHECK_INTERVAL_MS = 60_000;

// ── HMR-safe State ──────────────────────────────────────────────────────────

declare global {
	var __scanSchedulerHandle: ReturnType<typeof setInterval> | null;
	var __scanSchedulerVersion: number;
	var __scanSchedulerInitialized: boolean;
}

globalThis.__scanSchedulerVersion = (globalThis.__scanSchedulerVersion ?? 0) + 1;
const MY_VERSION = globalThis.__scanSchedulerVersion;

if (globalThis.__scanSchedulerHandle) {
	clearInterval(globalThis.__scanSchedulerHandle);
	globalThis.__scanSchedulerHandle = null;
}

globalThis.__scanSchedulerInitialized ??= false;

let running = false;

function isCurrentVersion(): boolean {
	return MY_VERSION === globalThis.__scanSchedulerVersion;
}

// ── Cron Parsing (simple) ───────────────────────────────────────────────────

/**
 * Simple cron-like check: parses "minute hour dayOfMonth month dayOfWeek"
 * Returns true if "now" matches the cron expression.
 */
function cronMatches(expression: string, now: Date): boolean {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return false;

	const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;
	const minute = now.getUTCMinutes();
	const hour = now.getUTCHours();
	const dom = now.getUTCDate();
	const month = now.getUTCMonth() + 1;
	const dow = now.getUTCDay();

	return (
		fieldMatches(minExpr, minute) &&
		fieldMatches(hourExpr, hour) &&
		fieldMatches(domExpr, dom) &&
		fieldMatches(monExpr, month) &&
		fieldMatches(dowExpr, dow)
	);
}

function fieldMatches(expr: string, value: number): boolean {
	if (expr === '*') return true;

	// Handle step values: */N
	if (expr.startsWith('*/')) {
		const step = parseInt(expr.slice(2), 10);
		if (isNaN(step) || step <= 0) return false;
		return value % step === 0;
	}

	// Handle comma-separated values
	const values = expr.split(',').map((v) => parseInt(v.trim(), 10));
	return values.includes(value);
}

/**
 * Compute next run time based on the cron expression (approximate)
 */
function computeNextRun(expression: string): string {
	const now = new Date();
	// Simple: just add 24h as approximation for daily crons
	const parts = expression.trim().split(/\s+/);
	if (parts.length === 5) {
		const [minExpr, hourExpr] = parts;
		const nextHour = hourExpr === '*' ? now.getUTCHours() : parseInt(hourExpr, 10);
		const nextMin = minExpr === '*' ? 0 : parseInt(minExpr.replace('*/', ''), 10) || 0;
		const next = new Date(now);
		next.setUTCHours(nextHour, nextMin, 0, 0);
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		return next.toISOString();
	}
	return new Date(now.getTime() + 86400_000).toISOString();
}

// ── Scheduler Logic ─────────────────────────────────────────────────────────

async function checkSchedules(): Promise<void> {
	if (running || !isCurrentVersion()) return;
	running = true;

	try {
		// Scheduled scans always target a cluster — the scan Job runs in-cluster,
		// so local scanner binaries are not required.
		
		const schedules = await listScanSchedules();
		const concurrency = await getScanConcurrency();
		const now = new Date();

		const enabledCount = schedules.filter((s) => s.enabled).length;
		console.log(
			`[ScanScheduler] Found ${schedules.length} schedules (${enabledCount} enabled), concurrency: ${concurrency}`
		);
		if (schedules.length === 0) {
			console.log(
				'[ScanScheduler] No scan schedules found. Enable scanning on a cluster to create one automatically.'
			);
		}

		for (const schedule of schedules) {
			if (!schedule.enabled) continue;
			if (!isCurrentVersion()) break;

			console.log(`[ScanScheduler] Evaluating schedule #${schedule.id} for cluster #${schedule.clusterId}`);
			console.log(`[ScanScheduler] Cron: "${schedule.cronExpression}", Last Run: ${schedule.lastRunAt}, Next Run: ${schedule.nextRunAt}`);

			// Check if cron matches current time (within the check interval window)
			if (!cronMatches(schedule.cronExpression, now)) continue;

			// Prevent re-running within the same minute
			if (schedule.lastRunAt) {
				const lastRun = new Date(schedule.lastRunAt);
				const diffMs = now.getTime() - lastRun.getTime();
				if (diffMs < CHECK_INTERVAL_MS * 2) continue;
			}

			try {
				if (!schedule.clusterId) continue;

				console.log(`[ScanScheduler] Running scheduled scan for cluster #${schedule.clusterId}`);

				// Build a cluster request function for extractWorkloadImages
				const clusterRequest = async (path: string) => {
					const result = await makeClusterRequest(schedule.clusterId!, path);
					if (!result.success) throw new Error(result.error);
					return result.data as { items?: Array<{ metadata?: { name?: string; namespace?: string }; spec?: { template?: { spec?: { containers?: Array<{ image?: string }> } } } }> };
				};

				const images = await extractWorkloadImages(clusterRequest);
				const namespaceFilter = schedule.namespaces ? JSON.parse(schedule.namespaces) as string[] : null;

				const filtered = images.filter(
					(img) => !namespaceFilter || namespaceFilter.includes(img.resourceNamespace)
				);

				await executeScanBatch(
					filtered.map((img) => ({
						image: img.image,
						tag: img.tag,
						clusterId: schedule.clusterId ?? undefined,
						resource: img.resource,
						resourceNamespace: img.resourceNamespace,
						trigger: 'scheduled' as const
					})),
					concurrency
				);

				// Update last run time
				await upsertScanSchedule({
					clusterId: schedule.clusterId,
					enabled: schedule.enabled ?? true,
					cronExpression: schedule.cronExpression,
					namespaces: schedule.namespaces,
					lastRunAt: now.toISOString(),
					nextRunAt: computeNextRun(schedule.cronExpression)
				});
			} catch (err) {
				console.error(`[ScanScheduler] Error processing schedule #${schedule.id}:`, err);
			}
		}
	} catch (err) {
		console.error('[ScanScheduler] Check failed:', err);
	} finally {
		running = false;
	}
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initScanScheduler(): void {
	if (globalThis.__scanSchedulerInitialized) return;
	globalThis.__scanSchedulerInitialized = true;

	console.log('[ScanScheduler] Initializing background scan scheduler');

	// Start checking on an interval
	globalThis.__scanSchedulerHandle = setInterval(() => {
		if (!isCurrentVersion()) {
			if (globalThis.__scanSchedulerHandle) {
				clearInterval(globalThis.__scanSchedulerHandle);
				globalThis.__scanSchedulerHandle = null;
			}
			return;
		}
		console.log('[ScanScheduler] Checking scan schedules...');
		checkSchedules();
	}, CHECK_INTERVAL_MS);

	// Run first check after a short delay
	setTimeout(() => {
		if (isCurrentVersion()) checkSchedules();
	}, 10_000);
}
