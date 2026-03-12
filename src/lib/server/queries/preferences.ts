/** Dashboard & data table preferences — KV-backed with optional user / cluster scoping. */

import { db, eq, isNull, and, userPreferences } from '../db';
import { deleteSetting, getSetting, setSetting } from './settings';

// ── Types ───────────────────────────────────────────────────────────────────

/** Single tile position within a dashboard grid. */
export interface Tile {
	id: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Lookup key that uniquely addresses one preference row. */
export interface PrefLookup {
	userId?: number | null;
	clusterId?: number | null;
	key: string;
}

/** Persisted dashboard layout for one user. */
export interface DashboardLayout {
	userId: number | null;
	tiles: Tile[];
}

/** Column-level data table config (widths, visibility, order). */
export type DataTableColumnConfig = Record<string, unknown>;

/** Per-data-table-id map of column configs. */
export type AllDataTableConfigs = Record<string, DataTableColumnConfig>;

// ── Constants ───────────────────────────────────────────────────────────────

const LAYOUT_KEY = 'dashboard_layout';

// ── Internal Helpers ────────────────────────────────────────────────────────

/** Build a WHERE clause that matches `(key, userId?, clusterId?)`, treating absent values as NULL. */
function buildWhere({ userId, clusterId, key }: PrefLookup) {
	return and(
		eq(userPreferences.key, key),
		userId ? eq(userPreferences.userId, userId) : isNull(userPreferences.userId),
		clusterId ? eq(userPreferences.clusterId, clusterId) : isNull(userPreferences.clusterId)
	);
}

/** Parse a JSON string; return the raw value on failure. */
function safeParse<T>(raw: string): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return raw as T;
	}
}

/** Resolve the settings-table key for data table configs. */
function dataTableKey(userId?: number): string {
	return userId ? `user:${userId}:data_table_configs` : 'data_table_configs';
}

// ── Core Preference CRUD ────────────────────────────────────────────────────

/** Read a single preference. Returns `null` when no matching row exists. */
export async function getPreference<T>(lookup: PrefLookup): Promise<T | null> {
	const [row] = await db.select().from(userPreferences).where(buildWhere(lookup));
	return row ? safeParse<T>(row.value) : null;
}

/** Upsert a preference row (insert-or-update on the unique constraint). */
export async function setPreference<T>(lookup: PrefLookup, payload: T): Promise<void> {
	const { userId, clusterId, key } = lookup;
	const serialised = JSON.stringify(payload);
	const now = new Date().toISOString();

	// SQLite treats NULLs as distinct in unique constraints, so onConflictDoUpdate
	// silently inserts duplicates when userId or clusterId is NULL.
	// Use delete-then-insert for the NULL case.
	if (userId == null || clusterId == null) {
		await db.delete(userPreferences).where(buildWhere(lookup));
		await db
			.insert(userPreferences)
			.values({ userId: userId ?? null, clusterId: clusterId ?? null, key, value: serialised });
		return;
	}

	await db
		.insert(userPreferences)
		.values({ userId, clusterId, key, value: serialised })
		.onConflictDoUpdate({
			target: [userPreferences.userId, userPreferences.clusterId, userPreferences.key],
			set: { value: serialised, updatedAt: now }
		});
}

/** Remove a preference row. */
export async function removePreference(lookup: PrefLookup): Promise<void> {
	await db.delete(userPreferences).where(buildWhere(lookup));
}

// ── Dashboard Layout ────────────────────────────────────────────────────────

/** Fetch the dashboard tile layout for a user (or the shared layout when `userId` is omitted). */
export async function getDashboardLayout(userId?: number | null): Promise<DashboardLayout | null> {
	const tiles = await getPreference<Tile[]>({ userId, clusterId: null, key: LAYOUT_KEY });
	return tiles ? { userId: userId ?? null, tiles } : null;
}

/** Persist a dashboard tile layout, returning the saved snapshot. */
export async function upsertDashboardLayout(input: {
	userId?: number | null;
	tiles: Tile[];
}): Promise<DashboardLayout> {
	await setPreference({ userId: input.userId, clusterId: null, key: LAYOUT_KEY }, input.tiles);
	return { userId: input.userId ?? null, tiles: input.tiles };
}

// ── Data Table Column Configs (settings-table, backward-compat) ───────────────

/** Read all data table column configs for a user. */
export async function getDataTableConfigs(userId?: number): Promise<AllDataTableConfigs> {
	const raw = await getSetting(dataTableKey(userId));
	return (raw as AllDataTableConfigs) ?? {};
}

/** Merge a single data table's column config into the stored map. */
export async function setDataTableConfig(
	tableName: string,
	config: DataTableColumnConfig,
	userId?: number
): Promise<void> {
	const map = await getDataTableConfigs(userId);
	map[tableName] = config;
	await setSetting(dataTableKey(userId), map);
}

/** Remove a single data table's column config from the stored map. */
export async function removeDataTableConfig(tableName: string, userId?: number): Promise<void> {
	const map = await getDataTableConfigs(userId);
	delete map[tableName];
	await setSetting(dataTableKey(userId), map);
}

/** Wipe all data table column configs for a user (or the shared set). */
export async function resetDataTableConfigs(userId?: number): Promise<void> {
	await deleteSetting(dataTableKey(userId));
}
