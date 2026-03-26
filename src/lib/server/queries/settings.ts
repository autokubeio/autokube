/** Settings KV store — typed accessors for global, per-user, per-cluster, and system preferences. */

import { db, eq, settings } from '../db';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ThemePrefs {
	lightTheme: string;
	darkTheme: string;
	font: string;
	fontSize: string;
	gridFontSize: string;
	terminalFont: string;
	editorFont: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Theme-pref DB keys → default values. */
const THEME_FIELDS: Record<string, string> = {
	light_theme: 'default',
	dark_theme: 'default',
	font: 'system',
	font_size: 'normal',
	grid_font_size: 'normal',
	terminal_font: 'system-mono',
	editor_font: 'system-mono'
};

// ── Validation Helpers ──────────────────────────────────────────────────────

/** Throw if `n` is outside `[min, max]`. */
function assertRange(n: number, min: number, max: number, label: string): void {
	if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
}

/** Throw if `s` is falsy or not a string. */
function assertNonEmpty(s: unknown, label: string): void {
	if (!s || typeof s !== 'string') throw new Error(`${label} must be a non-empty string`);
}

// ── Typed Read Helpers ──────────────────────────────────────────────────────

/** Read a string setting with a fallback default. */
async function readStr(key: string, fallback: string): Promise<string> {
	const raw = await getSetting(key);
	return typeof raw === 'string' ? raw : fallback;
}

/** Read a numeric setting with a fallback default. */
async function readNum(key: string, fallback: number): Promise<number> {
	const raw = await getSetting(key);
	return typeof raw === 'number' ? raw : fallback;
}

/** Read a boolean setting (handles both `true` and `"true"`). */
async function readBool(key: string): Promise<boolean> {
	const raw = await getSetting(key);
	return raw === true || raw === 'true';
}

// ── Core KV ─────────────────────────────────────────────────────────────────

/** Read a raw setting. Returns `null` when the key doesn't exist. */
export async function getSetting(key: string): Promise<unknown> {
	const [row] = await db.select().from(settings).where(eq(settings.key, key));
	if (!row) return null;
	try {
		return JSON.parse(row.value);
	} catch {
		return row.value;
	}
}

/** Upsert a setting. The value is JSON-stringified before storage. */
export async function setSetting(key: string, payload: unknown): Promise<void> {
	const serialised = JSON.stringify(payload);
	await db
		.insert(settings)
		.values({ key, value: serialised })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: serialised, updatedAt: new Date().toISOString() }
		});
}

/** Remove a setting by key. */
export async function deleteSetting(key: string): Promise<void> {
	await db.delete(settings).where(eq(settings.key, key));
}

// ── Cluster-scoped Overrides ────────────────────────────────────────────────

/** Read a cluster-scoped setting, falling back to the global key when no override exists. */
export async function getClusterScopedSetting(key: string, clusterId?: number): Promise<unknown> {
	if (clusterId !== undefined) {
		const scoped = await getSetting(`cluster_${clusterId}_${key}`);
		if (scoped !== null) return scoped;
	}
	return getSetting(key);
}

/** Write a cluster-scoped setting (or the global key when `clusterId` is omitted). */
export async function setClusterScopedSetting(
	key: string,
	payload: unknown,
	clusterId?: number
): Promise<void> {
	const resolved = clusterId !== undefined ? `cluster_${clusterId}_${key}` : key;
	await setSetting(resolved, payload);
}

// ── Per-user Preferences ────────────────────────────────────────────────────

/** Read a single preference for a user. */
export async function getUserSetting(userId: number, key: string): Promise<unknown> {
	return getSetting(`user:${userId}:${key}`);
}

/** Write a single preference for a user. */
export async function setUserSetting(userId: number, key: string, payload: unknown): Promise<void> {
	await setSetting(`user:${userId}:${key}`, payload);
}

/** Batch-read all theme preferences for a user, applying defaults. */
export async function getUserThemePreferences(userId: number): Promise<ThemePrefs> {
	const keys = Object.keys(THEME_FIELDS);
	const values = await Promise.all(keys.map((k) => getUserSetting(userId, k)));

	const resolved = keys.map((k, i) => {
		const v = values[i];
		return typeof v === 'string' ? v : THEME_FIELDS[k];
	});

	return {
		lightTheme: resolved[0],
		darkTheme: resolved[1],
		font: resolved[2],
		fontSize: resolved[3],
		gridFontSize: resolved[4],
		terminalFont: resolved[5],
		editorFont: resolved[6]
	};
}

/** Batch-write only the theme preferences that are present in `prefs`. */
export async function setUserThemePreferences(
	userId: number,
	prefs: Partial<ThemePrefs>
): Promise<void> {
	const mapping: Record<string, string | undefined> = {
		light_theme: prefs.lightTheme,
		dark_theme: prefs.darkTheme,
		font: prefs.font,
		font_size: prefs.fontSize,
		grid_font_size: prefs.gridFontSize,
		terminal_font: prefs.terminalFont,
		editor_font: prefs.editorFont
	};

	const writes = Object.entries(mapping)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => setUserSetting(userId, k, v));

	await Promise.all(writes);
}

// ── Timezone ────────────────────────────────────────────────────────────────

/** Global default timezone. */
export async function getDefaultTimezone(): Promise<string> {
	return readStr('default_timezone', 'UTC');
}

export async function setDefaultTimezone(tz: string): Promise<void> {
	await setSetting('default_timezone', tz);
}

// ── Event Collection ────────────────────────────────────────────────────────

export async function getEventCollectionMode(): Promise<'stream' | 'poll'> {
	const mode = await readStr('event_collection_mode', 'stream');
	return mode as 'stream' | 'poll';
}

export async function setEventCollectionMode(mode: 'stream' | 'poll'): Promise<void> {
	await setSetting('event_collection_mode', mode);
}

export async function getEventPollInterval(): Promise<number> {
	return readNum('event_poll_interval', 5000);
}

export async function setEventPollInterval(ms: number): Promise<void> {
	assertRange(ms, 1000, Infinity, 'Event poll interval');
	await setSetting('event_poll_interval', ms);
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export async function getMetricsCollectionInterval(): Promise<number> {
	return readNum('metrics_collection_interval', 30000);
}

export async function setMetricsCollectionInterval(ms: number): Promise<void> {
	assertRange(ms, 5000, Infinity, 'Metrics collection interval');
	await setSetting('metrics_collection_interval', ms);
}

// ── Retention ───────────────────────────────────────────────────────────────

export async function getScheduleRetentionDays(): Promise<number> {
	return readNum('schedule_retention_days', 30);
}

export async function setScheduleRetentionDays(days: number): Promise<void> {
	assertRange(days, 1, 365, 'Schedule retention days');
	await setSetting('schedule_retention_days', days);
}

export async function getEventRetentionDays(): Promise<number> {
	return readNum('event_retention_days', 7);
}

export async function setEventRetentionDays(days: number): Promise<void> {
	assertRange(days, 1, 365, 'Event retention days');
	await setSetting('event_retention_days', days);
}

// ── Cleanup Crons ───────────────────────────────────────────────────────────

export async function getScheduleCleanupCron(): Promise<string> {
	return readStr('schedule_cleanup_cron', '0 2 * * *');
}

export async function setScheduleCleanupCron(cron: string): Promise<void> {
	assertNonEmpty(cron, 'Cron expression');
	await setSetting('schedule_cleanup_cron', cron);
}

export async function getEventCleanupCron(): Promise<string> {
	return readStr('event_cleanup_cron', '0 3 * * *');
}

export async function setEventCleanupCron(cron: string): Promise<void> {
	assertNonEmpty(cron, 'Cron expression');
	await setSetting('event_cleanup_cron', cron);
}

export async function getScheduleCleanupEnabled(): Promise<boolean> {
	return readBool('schedule_cleanup_enabled');
}

export async function setScheduleCleanupEnabled(on: boolean): Promise<void> {
	await setSetting('schedule_cleanup_enabled', on);
}

export async function getEventCleanupEnabled(): Promise<boolean> {
	return readBool('event_cleanup_enabled');
}

export async function setEventCleanupEnabled(on: boolean): Promise<void> {
	await setSetting('event_cleanup_enabled', on);
}

// ── Stack Paths ─────────────────────────────────────────────────────────────

/** Read the list of external stack directories. */
export async function getExternalStackPaths(): Promise<string[]> {
	const raw = await getSetting('external_stack_paths');
	return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
}

export async function setExternalStackPaths(dirs: string[]): Promise<void> {
	if (!Array.isArray(dirs)) throw new Error('Paths must be an array');
	await setSetting('external_stack_paths', dirs);
}

export async function getPrimaryStackLocation(): Promise<string | null> {
	const raw = await getSetting('primary_stack_location');
	return typeof raw === 'string' ? raw : null;
}

export async function setPrimaryStackLocation(dir: string | null): Promise<void> {
	if (!dir) {
		await deleteSetting('primary_stack_location');
	} else {
		await setSetting('primary_stack_location', dir);
	}
}

// ── Cluster-scoped Settings ─────────────────────────────────────────────────

/** Cluster timezone, falling back to the global default. */
export async function getClusterTimezone(clusterId: number): Promise<string> {
	const tz = await getClusterScopedSetting('timezone', clusterId);
	return typeof tz === 'string' ? tz : getDefaultTimezone();
}

export async function setClusterTimezone(clusterId: number, tz: string): Promise<void> {
	await setClusterScopedSetting('timezone', tz, clusterId);
}

/** Read the cluster → public-IP map. */
export async function getClusterPublicIps(): Promise<Record<string, string>> {
	const raw = await getSetting('cluster_public_ips');
	return (raw as Record<string, string>) || {};
}

/** Set or clear a single cluster's public IP. */
export async function setClusterPublicIp(clusterId: number, ip: string | null): Promise<void> {
	const ipMap = await getClusterPublicIps();
	const key = clusterId.toString();

	if (ip) {
		ipMap[key] = ip;
	} else {
		delete ipMap[key];
	}

	await setSetting('cluster_public_ips', ipMap);
}

/** Shorthand — remove a cluster's public IP entry. */
export async function deleteClusterPublicIp(clusterId: number): Promise<void> {
	await setClusterPublicIp(clusterId, null);
}

// ── Security Scan Settings ──────────────────────────────────────────────────

/** Global scan schedule cron expression (default: 2 AM daily). */
export async function getScanScheduleCron(): Promise<string> {
	return readStr('scan_schedule_cron', '0 2 * * *');
}

export async function setScanScheduleCron(cron: string): Promise<void> {
	assertNonEmpty(cron, 'Scan schedule cron expression');
	await setSetting('scan_schedule_cron', cron);
}

/** Max parallel image scans (default: 5, range 1–20). */
export async function getScanConcurrency(): Promise<number> {
	return readNum('scan_concurrency', 5);
}

export async function setScanConcurrency(n: number): Promise<void> {
	assertRange(n, 1, 20, 'Scan concurrency');
	await setSetting('scan_concurrency', n);
}
