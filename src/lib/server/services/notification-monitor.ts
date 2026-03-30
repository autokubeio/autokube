/**
 * Background Notification Monitor
 *
 * Periodically checks for:
 *  - Cluster offline / online transitions
 *  - License expiring soon
 *  - K8s events matched against per-cluster notification configs
 *
 * Sends alerts through channels subscribed to those event types.
 */

import { listClusters } from '../queries/clusters';
import { listEnabledChannels, listAllEnabledBindingsWithConfig } from '../queries/notifications';
import { getScansCompletedSince } from '../queries/image-scans';
import type { ImageScanListItem } from '../queries/image-scans';
import { getDaysUntilExpiry, getStoredLicense } from './license';
import { sendAlert } from './notify';
import { makeClusterRequest, getClusterConnectionConfig, buildRequestOptions } from './kubernetes/utils';
import type { KubeconfigData, BearerTokenConnection } from './kubernetes/utils';
import { matchK8sEvent } from '$lib/notifications-constants';
import type { NotifGroups } from '$lib/notifications-constants';
import type { ResolvedChannel, ResolvedClusterBinding, ChannelConfig } from '../queries/notifications';
import https from 'node:https';

// ── Configuration ───────────────────────────────────────────────────────────

/** How often to run checks (default: 60 seconds) */
const CHECK_INTERVAL_MS = 60_000;

/** Days before expiry to start alerting */
const LICENSE_EXPIRY_WARN_DAYS = 14;

/** Cooldown before re-alerting the same event (default: 1 hour) */
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

// ── State ───────────────────────────────────────────────────────────────────

// Use globalThis to survive Vite/Bun hot-module reload — prevents duplicate intervals
declare global {
	var __notificationMonitorHandle: ReturnType<typeof setInterval> | null;
	var __notificationMonitorStartupTimeout: ReturnType<typeof setTimeout> | null;
	var __notificationMonitorInitialized: boolean;
	var __notificationLastAlertSent: Map<string, number>;
	var __notificationClusterStatus: Map<number, 'online' | 'offline'>;
	var __notificationMonitorVersion: number;
	/** Active K8s event watch streams per cluster */
	var __notificationWatchStreams: Map<number, WatchStream>;
	/** Timestamp of last vulnerability scan check */
	var __notificationLastScanCheck: string;
}

// ── Version-based zombie interval protection ────────────────────────────────
// Each module load increments the version. Old intervals from previous loads
// detect the mismatch and self-destruct, even if their handles were lost.
globalThis.__notificationMonitorVersion = (globalThis.__notificationMonitorVersion ?? 0) + 1;
const MY_VERSION = globalThis.__notificationMonitorVersion;

// Also try to kill known handles from the previous load
if (globalThis.__notificationMonitorHandle) {
	clearInterval(globalThis.__notificationMonitorHandle);
	globalThis.__notificationMonitorHandle = null;
}
if (globalThis.__notificationMonitorStartupTimeout) {
	clearTimeout(globalThis.__notificationMonitorStartupTimeout);
	globalThis.__notificationMonitorStartupTimeout = null;
}

// Stop any existing watch streams from the previous module load
if (globalThis.__notificationWatchStreams) {
	for (const stream of globalThis.__notificationWatchStreams.values()) {
		stream.stopping = true;
		if (stream.reconnectTimer) clearTimeout(stream.reconnectTimer);
		if (stream.req) stream.req.destroy();
	}
	globalThis.__notificationWatchStreams.clear();
}

globalThis.__notificationMonitorInitialized ??= false;
globalThis.__notificationLastAlertSent ??= new Map<string, number>();
globalThis.__notificationClusterStatus ??= new Map<number, 'online' | 'offline'>();
globalThis.__notificationWatchStreams ??= new Map<number, WatchStream>();
globalThis.__notificationLastScanCheck ??= new Date().toISOString();

/** Previous cluster status: clusterId → 'online' | 'offline' */
const clusterStatusMap = globalThis.__notificationClusterStatus;

/** Cooldown map: alertKey → timestamp */
const alertSentMap = globalThis.__notificationLastAlertSent;

/** Active watch streams per cluster */
const watchStreams = globalThis.__notificationWatchStreams;

let initialized = globalThis.__notificationMonitorInitialized;

/** Guard against overlapping check cycles */
let running = false;

/** Returns true if this module instance is still the current one */
function isCurrentVersion(): boolean {
	return MY_VERSION === globalThis.__notificationMonitorVersion;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if enough time has passed since the last alert for this key */
function canAlert(key: string): boolean {
	const last = alertSentMap.get(key);
	if (!last) return true;
	return Date.now() - last >= ALERT_COOLDOWN_MS;
}

function markAlerted(key: string): void {
	alertSentMap.set(key, Date.now());
}

/** Get channels subscribed to a specific event type */
function channelsForEvent(
	channels: ResolvedChannel[],
	eventId: string
): ResolvedChannel[] {
	return channels.filter((ch) => ch.eventTypes.includes(eventId as never));
}

/** Send alert to all channels subscribed to an event */
async function dispatchAlert(
	channels: ResolvedChannel[],
	eventId: string,
	alertKey: string,
	title: string,
	body: string
): Promise<void> {
	const targets = channelsForEvent(channels, eventId);
	if (targets.length === 0) return;

	if (!canAlert(alertKey)) return;

	markAlerted(alertKey);

	await Promise.allSettled(
		targets.map((ch) => sendAlert(ch, title, body))
	);
	console.log(`[Monitor] Dispatched "${eventId}" alert to ${targets.length} channel(s)`);
}

// ── Cluster Health Check ────────────────────────────────────────────────────

async function checkClusters(channels: ResolvedChannel[]): Promise<void> {
	const clusters = await listClusters();

	for (const cluster of clusters) {
		const result = await makeClusterRequest(cluster.id, '/version', 8000);
		const currentStatus: 'online' | 'offline' = result.success ? 'online' : 'offline';
		const previousStatus = clusterStatusMap.get(cluster.id);

		// Update stored status
		clusterStatusMap.set(cluster.id, currentStatus);

		// On first run, just record status — don't alert
		if (!initialized) continue;

		// Detect transition: was online → now offline
		if (previousStatus === 'online' && currentStatus === 'offline') {
			const host = cluster.apiServer ? ` (${cluster.apiServer})` : '';
			await dispatchAlert(
				channels,
				'cluster_offline',
				`cluster_offline:${cluster.id}`,
				`🔴 Cluster "${cluster.name}" is offline`,
				`Cluster "${cluster.name}"${host} is no longer reachable.\n\nChecked at: ${new Date().toISOString()}`
			);
		}

		// Detect transition: was offline → now online
		if (previousStatus === 'offline' && currentStatus === 'online') {
			const host = cluster.apiServer ? ` (${cluster.apiServer})` : '';
			await dispatchAlert(
				channels,
				'cluster_online',
				`cluster_online:${cluster.id}`,
				`🟢 Cluster "${cluster.name}" is back online`,
				`Cluster "${cluster.name}"${host} is reachable again.\n\nRecovered at: ${new Date().toISOString()}`
			);
		}
	}
}

// ── License Expiry Check ────────────────────────────────────────────────────

async function checkLicenseExpiry(channels: ResolvedChannel[]): Promise<void> {
	const stored = await getStoredLicense();
	if (!stored?.key) return; // No license installed

	const daysLeft = await getDaysUntilExpiry();
	if (daysLeft === null) return; // No expiry date or invalid license

	if (daysLeft <= LICENSE_EXPIRY_WARN_DAYS) {
		const urgency = daysLeft <= 3 ? '🔴' : daysLeft <= 7 ? '🟡' : '🟠';
		const title =
			daysLeft === 0
				? `${urgency} License expires today!`
				: `${urgency} License expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

		await dispatchAlert(
			channels,
			'license_expiring',
			'license_expiring',
			title,
			`Your AutoKube license for "${stored.name}" will expire in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.\n\nPlease renew your license to continue using enterprise features.`
		);
	}
}

// ── Vulnerability Scan Alert Check ──────────────────────────────────────────

/**
 * Check for recently completed vulnerability scans and send alerts
 * based on per-cluster notification config (security.vulnerabilityScans).
 */
async function checkVulnerabilityScans(
	allBindings: Array<ResolvedClusterBinding & { config: ChannelConfig }>
): Promise<void> {
	const since = globalThis.__notificationLastScanCheck;
	globalThis.__notificationLastScanCheck = new Date().toISOString();

	let recentScans: ImageScanListItem[];
	try {
		recentScans = await getScansCompletedSince(since);
	} catch (err) {
		console.error('[Monitor] Failed to fetch recent scans:', err);
		return;
	}

	if (recentScans.length === 0) return;

	// Group bindings by clusterId
	const bindingsByCluster = new Map<number, Array<ResolvedClusterBinding & { config: ChannelConfig }>>();
	for (const b of allBindings) {
		const list = bindingsByCluster.get(b.clusterId) ?? [];
		list.push(b);
		bindingsByCluster.set(b.clusterId, list);
	}

	for (const scan of recentScans) {
		if (!scan.clusterId) continue;
		const bindings = bindingsByCluster.get(scan.clusterId);
		if (!bindings) continue;

		for (const binding of bindings) {
			const cfg = binding.notifConfig;
			if (!cfg?.security?.vulnerabilityScans) continue;

			const scanCfg = cfg.security.vulnerabilityScans;
			const imageTag = `${scan.image}:${scan.tag ?? 'latest'}`;
			const summary = scan.parsedSummary;

			// Scan failed alert
			if (scan.status === 'failed' && scanCfg.scanFailed) {
				const alertKey = `scan_failed:${scan.id}:${binding.notificationId}`;
				if (canAlert(alertKey)) {
					markAlerted(alertKey);
					const channel: ResolvedChannel = {
						id: binding.notificationId,
						type: binding.channelType ?? 'apprise',
						name: binding.channelName ?? 'Unknown',
						enabled: true,
						config: binding.config,
						eventTypes: binding.eventTypes,
						createdAt: binding.createdAt,
						updatedAt: binding.updatedAt
					};
					sendAlert(
						channel,
						`❌ Scan failed: ${imageTag}`,
						[
							`📍 Cluster: ${scan.clusterName ?? `#${scan.clusterId}`}`,
							scan.errorMessage ? `💬 ${scan.errorMessage}` : '',
							`🕐 ${scan.completedAt ?? new Date().toISOString()}`
						].filter(Boolean).join('\n')
					).catch((err) => console.error('[Monitor] Failed to send scan-failed alert:', err));
				}
				continue;
			}

			if (scan.status !== 'completed' || !summary) continue;

			// Scan completed alert
			if (scanCfg.scanCompleted) {
				const alertKey = `scan_completed:${scan.id}:${binding.notificationId}`;
				if (canAlert(alertKey)) {
					markAlerted(alertKey);
					const channel: ResolvedChannel = {
						id: binding.notificationId,
						type: binding.channelType ?? 'apprise',
						name: binding.channelName ?? 'Unknown',
						enabled: true,
						config: binding.config,
						eventTypes: binding.eventTypes,
						createdAt: binding.createdAt,
						updatedAt: binding.updatedAt
					};
					sendAlert(
						channel,
						`✅ Scan completed: ${imageTag}`,
						[
							`📍 Cluster: ${scan.clusterName ?? `#${scan.clusterId}`}`,
							`🔴 Critical: ${summary.critical}  🟠 High: ${summary.high}  🟡 Medium: ${summary.medium}  🔵 Low: ${summary.low}`,
							`🕐 ${scan.completedAt ?? new Date().toISOString()}`
						].join('\n')
					).catch((err) => console.error('[Monitor] Failed to send scan-completed alert:', err));
				}
			}

			// Severity-based alerts
			const severityAlerts: Array<{ enabled: boolean; count: number; label: string; icon: string }> = [
				{ enabled: scanCfg.criticalFound, count: summary.critical, label: 'CRITICAL', icon: '🔴' },
				{ enabled: scanCfg.highFound, count: summary.high, label: 'HIGH', icon: '🟠' },
				{ enabled: scanCfg.mediumFound, count: summary.medium, label: 'MEDIUM', icon: '🟡' }
			];

			for (const sev of severityAlerts) {
				if (!sev.enabled || sev.count === 0) continue;
				const alertKey = `scan_${sev.label.toLowerCase()}:${scan.id}:${binding.notificationId}`;
				if (!canAlert(alertKey)) continue;
				markAlerted(alertKey);

				const channel: ResolvedChannel = {
					id: binding.notificationId,
					type: binding.channelType ?? 'apprise',
					name: binding.channelName ?? 'Unknown',
					enabled: true,
					config: binding.config,
					eventTypes: binding.eventTypes,
					createdAt: binding.createdAt,
					updatedAt: binding.updatedAt
				};

				sendAlert(
					channel,
					`${sev.icon} ${sev.count} ${sev.label} vulnerabilit${sev.count === 1 ? 'y' : 'ies'} found in ${imageTag}`,
					[
						`📍 Cluster: ${scan.clusterName ?? `#${scan.clusterId}`}`,
						`📦 Image: ${imageTag}`,
						`🔴 Critical: ${summary.critical}  🟠 High: ${summary.high}  🟡 Medium: ${summary.medium}  🔵 Low: ${summary.low}`,
						`🕐 ${scan.completedAt ?? new Date().toISOString()}`
					].join('\n')
				).catch((err) => console.error(`[Monitor] Failed to send ${sev.label} CVE alert:`, err));
			}
		}
	}
}

// ── K8s Event Watch Streams ─────────────────────────────────────────────────

/** K8s Event object shape (partial) */
interface K8sEvent {
	metadata: { name: string; namespace?: string; resourceVersion?: string; creationTimestamp?: string };
	involvedObject: { kind: string; name: string; namespace?: string };
	reason: string;
	message?: string;
	type?: string; // "Normal" | "Warning"
	lastTimestamp?: string;
	eventTime?: string;
}

interface K8sEventList {
	metadata: { resourceVersion: string };
	items: K8sEvent[];
}

/** Watch line from the K8s watch API */
interface WatchLine {
	type: 'ADDED' | 'MODIFIED' | 'DELETED' | 'ERROR';
	object: K8sEvent & { code?: number; reason?: string; message?: string };
}

/** Binding with channel config for sending alerts */
type BindingWithConfig = ResolvedClusterBinding & { config: ChannelConfig };

/** Per-cluster watch stream state */
interface WatchStream {
	clusterId: number;
	clusterName: string;
	resourceVersion: string;
	bindings: BindingWithConfig[];
	req: ReturnType<typeof https.request> | null;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	stopping: boolean;
}

/** Delay before reconnecting a broken watch (with jitter) */
const WATCH_RECONNECT_MS = 5_000;

/**
 * Process a single K8s event received from a watch stream.
 */
function processWatchEvent(stream: WatchStream, ev: K8sEvent): void {
	const kind = ev.involvedObject?.kind ?? '';
	const reason = ev.reason ?? '';
	const eventType = ev.type ?? 'Normal';
	if (!kind || !reason) return;

	for (const binding of stream.bindings) {
		if (!binding.notifConfig) continue;

		const matches = matchK8sEvent(kind, reason, eventType, binding.notifConfig);
		if (matches.length === 0) continue;


		const objName = ev.involvedObject.name ?? 'unknown';
		const ns = ev.involvedObject.namespace ?? '';
		const evRV = ev.metadata.resourceVersion ?? '';
		const alertKey = `k8s:${stream.clusterId}:${kind}:${reason}:${ns}/${objName}:${evRV}:${binding.notificationId}`;

		if (!canAlert(alertKey)) continue;
		markAlerted(alertKey);

		const warn = eventType === 'Warning';
		const icon = warn ? '⚠️' : '⚡';
		const title = `${icon} ${kind} ${reason}`;
		const body = [
			`📍 Cluster: ${stream.clusterName}`,
			`📦 Resource: ${kind}/${objName}`,
			ns ? `📁 Namespace: ${ns}` : '',
			ev.message ? `💬 ${ev.message}` : '',
			`🕐 ${ev.lastTimestamp ?? ev.eventTime ?? ev.metadata.creationTimestamp ?? 'unknown'}`
		]
			.filter(Boolean)
			.join('\n');

		const channel: ResolvedChannel = {
			id: binding.notificationId,
			type: binding.channelType ?? 'apprise',
			name: binding.channelName ?? 'Unknown',
			enabled: true,
			config: binding.config,
			eventTypes: binding.eventTypes,
			createdAt: binding.createdAt,
			updatedAt: binding.updatedAt
		};

		sendAlert(channel, title, body).then(
			() => console.log(`[Monitor] K8s event: ${kind}/${reason} → "${channel.name}"`),
			(err) => console.error(`[Monitor] Failed to send K8s alert:`, err)
		);
	}
}

/**
 * Start a watch stream for a single cluster.
 * First does a LIST to get the current resourceVersion, then opens a long-lived
 * watch connection that streams events in real-time.
 */
async function startWatchStream(
	clusterId: number,
	clusterName: string,
	bindings: BindingWithConfig[]
): Promise<void> {
	// Stop existing stream if any
	stopWatchStream(clusterId);

	const stream: WatchStream = {
		clusterId,
		clusterName,
		resourceVersion: '',
		bindings,
		req: null,
		reconnectTimer: null,
		stopping: false
	};
	watchStreams.set(clusterId, stream);

	// Bootstrap: LIST current events to get resourceVersion (don't alert on existing events)
	const listResult = await makeClusterRequest<K8sEventList>(
		clusterId,
		'/api/v1/events?limit=1',
		15_000
	);

	if (!listResult.success || !listResult.data?.metadata?.resourceVersion) {
		console.warn(`[Monitor] Cannot start watch for cluster ${clusterName}: ${listResult.error ?? 'no resourceVersion'}`);
		watchStreams.delete(clusterId);
		return;
	}

	stream.resourceVersion = listResult.data.metadata.resourceVersion;
	console.log(`[Monitor] Watch started for "${clusterName}" (rv: ${stream.resourceVersion})`);

	connectWatch(stream);
}

/**
 * Open the actual HTTP watch connection for a stream.
 */
async function connectWatch(stream: WatchStream): Promise<void> {
	if (stream.stopping || !isCurrentVersion()) return;

	const config = await getClusterConnectionConfig(stream.clusterId);
	if (!config) {
		console.warn(`[Monitor] Cannot connect watch for cluster ${stream.clusterName}: config unavailable`);
		scheduleReconnect(stream);
		return;
	}

	// Agent-type clusters don't support streaming — skip
	if (config.authType === 'agent') {
		console.log(`[Monitor] Cluster "${stream.clusterName}" uses agent auth — watch not supported`);
		watchStreams.delete(stream.clusterId);
		return;
	}

	const standardConfig = config as KubeconfigData | BearerTokenConnection;
	const watchPath = `/api/v1/events?watch=1&resourceVersion=${stream.resourceVersion}&allowWatchBookmarks=true`;
	const url = new URL(watchPath, standardConfig.server);
	const reqOptions = buildRequestOptions(standardConfig, url, 'GET', {}, 0);
	// Watch connections should not timeout — remove the timeout
	delete reqOptions.timeout;

	const req = https.request(reqOptions, (res) => {
		if (res.statusCode === 410) {
			// 410 Gone — resourceVersion too old, re-bootstrap
			console.log(`[Monitor] Watch for "${stream.clusterName}" got 410 Gone — re-bootstrapping`);
			stream.resourceVersion = '';
			rebootstrapWatch(stream);
			return;
		}

		if (res.statusCode !== 200) {
			let errBody = '';
			res.on('data', (chunk) => (errBody += chunk));
			res.on('end', () => {
				console.warn(`[Monitor] Watch for "${stream.clusterName}" returned HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`);
				scheduleReconnect(stream);
			});
			return;
		}

		let buffer = '';
		res.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();

			// Process complete lines (newline-delimited JSON)
			let newlineIdx: number;
			while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, newlineIdx).trim();
				buffer = buffer.slice(newlineIdx + 1);
				if (!line) continue;

				try {
					const watchLine = JSON.parse(line) as WatchLine;

					if (watchLine.type === 'ERROR') {
						const code = watchLine.object?.code;
						if (code === 410) {
							// resourceVersion expired — re-bootstrap
							console.log(`[Monitor] Watch for "${stream.clusterName}" rv expired — re-bootstrapping`);
							req.destroy();
							stream.resourceVersion = '';
							rebootstrapWatch(stream);
							return;
						}
						console.warn(`[Monitor] Watch error for "${stream.clusterName}":`, watchLine.object?.message);
						continue;
					}

					// Update resourceVersion from each event
					const evRV = watchLine.object?.metadata?.resourceVersion;
					if (evRV) stream.resourceVersion = evRV;

					// BOOKMARK events just update the RV, no actual event
					if (watchLine.type === 'ADDED' || watchLine.type === 'MODIFIED') {
						processWatchEvent(stream, watchLine.object);
					}
				} catch {
					// Malformed JSON line — skip
				}
			}
		});

		res.on('end', () => {
			console.log(`[Monitor] Watch stream closed for "${stream.clusterName}" — reconnecting`);
			scheduleReconnect(stream);
		});

		res.on('error', (err) => {
			console.error(`[Monitor] Watch response error for "${stream.clusterName}":`, err.message);
			scheduleReconnect(stream);
		});
	});

	req.on('error', (err) => {
		console.error(`[Monitor] Watch request error for "${stream.clusterName}":`, err.message);
		scheduleReconnect(stream);
	});

	req.end();
	stream.req = req;
}

/** Re-bootstrap a watch stream after a 410 Gone. */
async function rebootstrapWatch(stream: WatchStream): Promise<void> {
	if (stream.stopping || !isCurrentVersion()) return;

	const listResult = await makeClusterRequest<K8sEventList>(
		stream.clusterId,
		'/api/v1/events?limit=1',
		15_000
	);

	if (!listResult.success || !listResult.data?.metadata?.resourceVersion) {
		scheduleReconnect(stream);
		return;
	}

	stream.resourceVersion = listResult.data.metadata.resourceVersion;
	connectWatch(stream);
}

/** Schedule a reconnect with jitter. */
function scheduleReconnect(stream: WatchStream): void {
	if (stream.stopping || !isCurrentVersion()) return;
	if (stream.reconnectTimer) clearTimeout(stream.reconnectTimer);

	const jitter = Math.random() * 2_000;
	stream.reconnectTimer = setTimeout(() => {
		stream.reconnectTimer = null;
		if (!stream.stopping && isCurrentVersion()) {
			if (stream.resourceVersion) {
				connectWatch(stream);
			} else {
				rebootstrapWatch(stream);
			}
		}
	}, WATCH_RECONNECT_MS + jitter);
}

/** Stop a single watch stream. */
function stopWatchStream(clusterId: number): void {
	const stream = watchStreams.get(clusterId);
	if (!stream) return;

	stream.stopping = true;
	if (stream.reconnectTimer) {
		clearTimeout(stream.reconnectTimer);
		stream.reconnectTimer = null;
	}
	if (stream.req) {
		stream.req.destroy();
		stream.req = null;
	}
	watchStreams.delete(clusterId);
}

/** Stop all watch streams. */
function stopAllWatchStreams(): void {
	for (const clusterId of [...watchStreams.keys()]) {
		stopWatchStream(clusterId);
	}
}

/**
 * Sync watch streams: start new ones, stop removed ones, update bindings.
 * Called periodically to pick up new clusters/bindings and clean up stale ones.
 */
async function syncWatchStreams(
	allBindings?: BindingWithConfig[]
): Promise<void> {
	const bindings = allBindings ?? await listAllEnabledBindingsWithConfig();

	// Group bindings by clusterId
	const bindingsByCluster = new Map<number, BindingWithConfig[]>();
	for (const b of bindings) {
		const list = bindingsByCluster.get(b.clusterId) ?? [];
		list.push(b);
		bindingsByCluster.set(b.clusterId, list);
	}

	// Build cluster name map
	const allClusters = await listClusters();
	const clusterNames = new Map(allClusters.map((c) => [c.id, c.name]));

	// Stop streams for clusters that no longer have bindings
	for (const clusterId of [...watchStreams.keys()]) {
		if (!bindingsByCluster.has(clusterId)) {
			console.log(`[Monitor] Stopping watch for cluster ${clusterId} (no more bindings)`);
			stopWatchStream(clusterId);
		}
	}

	// Start or update streams
	for (const [clusterId, bindings] of bindingsByCluster) {
		const existing = watchStreams.get(clusterId);
		if (existing) {
			// Update bindings on the live stream (no reconnect needed)
			existing.bindings = bindings;
			existing.clusterName = clusterNames.get(clusterId) ?? `Cluster #${clusterId}`;
		} else {
			// Start new watch stream
			const name = clusterNames.get(clusterId) ?? `Cluster #${clusterId}`;
			await startWatchStream(clusterId, name, bindings);
		}
	}
}

// ── Main Check Loop ─────────────────────────────────────────────────────────

async function runChecks(): Promise<void> {
	// Self-destruct: if a newer module version loaded, this is a zombie interval
	if (!isCurrentVersion()) {
		console.log('[Monitor] Stale interval detected (zombie), skipping');
		return;
	}
	if (running) return; // Prevent overlapping runs
	running = true;
	try {
		const channels = await listEnabledChannels();

		// Run cluster health + license checks (existing functionality)
		if (channels.length > 0) {
			await checkClusters(channels);
			await checkLicenseExpiry(channels);
		}

		// Fetch all enabled bindings (used by both watch streams and scan alerts)
		const allBindings = await listAllEnabledBindingsWithConfig();

		// Check for vulnerability scan results and dispatch alerts
		if (allBindings.length > 0) {
			await checkVulnerabilityScans(allBindings);
		}

		// Sync K8s event watch streams (start/stop/update as needed)
		await syncWatchStreams(allBindings);

		// Mark initialized after first successful run
		if (!initialized) {
			initialized = true;
			globalThis.__notificationMonitorInitialized = true;
			console.log(
				`[Monitor] Initialized — tracking ${clusterStatusMap.size} cluster(s), ${watchStreams.size} watch stream(s)`
			);
		}
	} catch (err) {
		console.error('[Monitor] Check cycle error:', err);
	} finally {
		running = false;
	}
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the background notification monitor.
 * Safe to call multiple times — only starts one interval.
 */
export function startNotificationMonitor(): void {
	// Already running (shouldn't happen since we clear on module load, but guard anyway)
	if (globalThis.__notificationMonitorHandle) return;

	console.log('[Monitor] Starting notification monitor (interval: 60s)');

	// Run first check after a short delay to let the DB/services settle
	globalThis.__notificationMonitorStartupTimeout = setTimeout(async () => {
		globalThis.__notificationMonitorStartupTimeout = null;
		// Double-check we're still the current version before starting
		if (!isCurrentVersion()) return;
		await runChecks();
		if (!isCurrentVersion()) return;
		globalThis.__notificationMonitorHandle = setInterval(runChecks, CHECK_INTERVAL_MS);
	}, 5_000);
}

/**
 * Stop the background notification monitor.
 */
export function stopNotificationMonitor(): void {
	if (globalThis.__notificationMonitorStartupTimeout) {
		clearTimeout(globalThis.__notificationMonitorStartupTimeout);
		globalThis.__notificationMonitorStartupTimeout = null;
	}
	if (globalThis.__notificationMonitorHandle) {
		clearInterval(globalThis.__notificationMonitorHandle);
		globalThis.__notificationMonitorHandle = null;
		globalThis.__notificationMonitorInitialized = false;
		initialized = false;
		stopAllWatchStreams();
		console.log('[Monitor] Notification monitor stopped');
	}
}
