/**
 * Metrics Collector — Background service for system and application metrics.
 *
 * Periodically samples CPU times to produce accurate CPU usage percentages.
 * All other metrics (memory, disk, app state) are collected on demand.
 *
 * HMR-safe singleton pattern — state lives on globalThis.
 */

import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { listClusters } from '../queries/clusters';
import { listChannels } from '../queries/notifications';
import { getConnectedAgents } from './agent-connection';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Interval between CPU samples (ms) */
const CPU_SAMPLE_INTERVAL_MS = 15_000;

// ── HMR-safe State ────────────────────────────────────────────────────────────

declare global {
	var __metricsCollectorHandle: ReturnType<typeof setInterval> | null;
	var __metricsCollectorVersion: number;
	var __metricsCpuUsagePercent: number;
	var __metricsCpuSample: { total: number; idle: number } | null;
	var __metricsCollectorStartTime: number;
}

globalThis.__metricsCollectorVersion = (globalThis.__metricsCollectorVersion ?? 0) + 1;
const MY_VERSION = globalThis.__metricsCollectorVersion;

if (globalThis.__metricsCollectorHandle) {
	clearInterval(globalThis.__metricsCollectorHandle);
	globalThis.__metricsCollectorHandle = null;
}

globalThis.__metricsCpuUsagePercent ??= 0;
globalThis.__metricsCpuSample ??= null;
globalThis.__metricsCollectorStartTime ??= Date.now();

// ── CPU Sampling ──────────────────────────────────────────────────────────────

function getCpuTimes(): { total: number; idle: number } {
	const cpus = os.cpus();
	let total = 0;
	let idle = 0;
	for (const cpu of cpus) {
		const t = cpu.times;
		idle += t.idle;
		total += t.user + t.nice + t.sys + t.idle + t.irq;
	}
	return { total, idle };
}

function sampleCpu(): void {
	if (MY_VERSION !== globalThis.__metricsCollectorVersion) return;

	const current = getCpuTimes();
	const prev = globalThis.__metricsCpuSample;

	if (prev) {
		const deltaTotal = current.total - prev.total;
		const deltaIdle = current.idle - prev.idle;
		if (deltaTotal > 0) {
			globalThis.__metricsCpuUsagePercent = ((deltaTotal - deltaIdle) / deltaTotal) * 100;
		}
	}

	globalThis.__metricsCpuSample = current;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SystemMetrics {
	cpuUsagePercent: number;
	cpuCount: number;
	memoryTotalBytes: number;
	memoryUsedBytes: number;
	memoryFreeBytes: number;
	diskTotalBytes: number | null;
	diskUsedBytes: number | null;
	diskFreeBytes: number | null;
	uptimeSeconds: number;
}

export interface ProcessMetrics {
	memoryRssBytes: number;
	memoryHeapUsedBytes: number;
	memoryHeapTotalBytes: number;
	uptimeSeconds: number;
}

export interface AppMetrics {
	clustersTotal: number;
	agentConnectionsActive: number;
	notificationChannelsTotal: number;
	notificationChannelsEnabled: number;
}

export interface MetricsSnapshot {
	collectedAt: number;
	system: SystemMetrics;
	process: ProcessMetrics;
	app: AppMetrics;
}

// ── Disk Metrics ──────────────────────────────────────────────────────────────

async function getDiskMetrics(): Promise<{
	total: number | null;
	free: number | null;
	used: number | null;
}> {
	try {
		const stats = await statfs('.');
		const blockSize = stats.bsize;
		const total = stats.blocks * blockSize;
		const free = stats.bfree * blockSize;
		return { total, free, used: total - free };
	} catch {
		// statfs may not be available in all runtimes / environments
		return { total: null, free: null, used: null };
	}
}

// ── Snapshot Collection ───────────────────────────────────────────────────────

export async function collectMetricsSnapshot(): Promise<MetricsSnapshot> {
	const [disk, clusters, channels] = await Promise.all([
		getDiskMetrics(),
		listClusters().catch(() => []),
		listChannels().catch(() => [])
	]);

	const agents = getConnectedAgents();
	const mem = process.memoryUsage();
	const totalMem = os.totalmem();
	const freeMem = os.freemem();

	return {
		collectedAt: Date.now(),
		system: {
			cpuUsagePercent: parseFloat(globalThis.__metricsCpuUsagePercent.toFixed(4)),
			cpuCount: os.cpus().length,
			memoryTotalBytes: totalMem,
			memoryUsedBytes: totalMem - freeMem,
			memoryFreeBytes: freeMem,
			diskTotalBytes: disk.total,
			diskUsedBytes: disk.used,
			diskFreeBytes: disk.free,
			uptimeSeconds: Math.floor(os.uptime())
		},
		process: {
			memoryRssBytes: mem.rss,
			memoryHeapUsedBytes: mem.heapUsed,
			memoryHeapTotalBytes: mem.heapTotal,
			uptimeSeconds: parseFloat(
				((Date.now() - globalThis.__metricsCollectorStartTime) / 1000).toFixed(2)
			)
		},
		app: {
			clustersTotal: clusters.length,
			agentConnectionsActive: agents.length,
			notificationChannelsTotal: channels.length,
			notificationChannelsEnabled: channels.filter((c) => c.enabled).length
		}
	};
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function startMetricsCollector(): void {
	// Take an initial CPU sample so the first real scrape has a baseline
	sampleCpu();

	const handle = setInterval(() => {
		if (MY_VERSION !== globalThis.__metricsCollectorVersion) {
			clearInterval(handle);
			return;
		}
		sampleCpu();
	}, CPU_SAMPLE_INTERVAL_MS);

	globalThis.__metricsCollectorHandle = handle;
}
