/**
 * Notification Operations
 * Database operations for notification channels and per-cluster notification bindings
 */

import { encrypt, decrypt } from '../helpers';
import { db, eq, and, desc, asc, notificationSettings, clusterNotifications } from '../db';
import type { NotifGroups } from '$lib/notifications-constants';

// ── Constants (re-exported from shared file) ─────────────────────────────────
export { NOTIFICATION_EVENT_TYPES, NOTIFICATION_EVENT_GROUPS } from '$lib/notifications-constants';
export type { NotificationEventType } from '$lib/notifications-constants';

import { NOTIFICATION_EVENT_TYPES } from '$lib/notifications-constants';
import type { NotificationEventType } from '$lib/notifications-constants';

/** All known event IDs (default when none are specified). */
const ALL_EVENT_IDS = NOTIFICATION_EVENT_TYPES.map((e) => e.id);

export interface SmtpConfig {
	host: string;
	port: number;
	secure: boolean;
	username?: string;
	password?: string;
	from_email: string;
	from_name?: string;
	to_emails: string[];
	skipTlsVerify?: boolean;
}

export interface AppriseConfig {
	urls: string[];
}

export type ChannelConfig = SmtpConfig | AppriseConfig;

export interface ResolvedChannel {
	id: number;
	type: 'smtp' | 'apprise';
	name: string;
	enabled: boolean;
	config: ChannelConfig;
	eventTypes: NotificationEventType[];
	createdAt: string;
	updatedAt: string;
}

export interface ResolvedClusterBinding {
	id: number;
	clusterId: number;
	notificationId: number;
	enabled: boolean;
	eventTypes: NotificationEventType[];
	notifConfig: NotifGroups | null;
	createdAt: string;
	updatedAt: string;
	channelName?: string;
	channelType?: 'smtp' | 'apprise';
	channelEnabled?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Encrypt SMTP password inside the config blob. */
function sealConfig(type: 'smtp' | 'apprise', config: ChannelConfig): string {
	if (type === 'smtp') {
		const smtp = config as SmtpConfig;
		return JSON.stringify({ ...smtp, password: encrypt(smtp.password) });
	}
	return JSON.stringify(config);
}

/** Decrypt SMTP password from stored JSON. */
function unsealConfig(type: string, json: string): ChannelConfig {
	const parsed = JSON.parse(json);
	if (type === 'smtp' && parsed.password) {
		return { ...parsed, password: decrypt(parsed.password) };
	}
	return parsed;
}

/** Parse stored event-type JSON or fall back to all IDs. */
function parseEventTypes(raw: string | null): NotificationEventType[] {
	return raw ? JSON.parse(raw) : [...ALL_EVENT_IDS];
}

/** Map a notification-settings row into an `ResolvedChannel`. */
function mapChannelRow(row: typeof notificationSettings.$inferSelect): ResolvedChannel {
	return {
		...row,
		type: row.type as ResolvedChannel['type'],
		enabled: row.enabled ?? true,
		createdAt: row.createdAt ?? '',
		updatedAt: row.updatedAt ?? '',
		config: unsealConfig(row.type, row.config),
		eventTypes: parseEventTypes(row.eventTypes)
	};
}

/** Shared column projection for cluster-binding + channel join queries. */
const BINDING_COLS = {
	id: clusterNotifications.id,
	clusterId: clusterNotifications.clusterId,
	notificationId: clusterNotifications.notificationId,
	enabled: clusterNotifications.enabled,
	eventTypes: clusterNotifications.eventTypes,
	notifConfig: clusterNotifications.notifConfig,
	createdAt: clusterNotifications.createdAt,
	updatedAt: clusterNotifications.updatedAt,
	channelName: notificationSettings.name,
	channelType: notificationSettings.type,
	channelEnabled: notificationSettings.enabled
} as const;

/** Inferred row shape from the BINDING_COLS projection. */
type BindingJoinRow = {
	id: number;
	clusterId: number;
	notificationId: number;
	enabled: boolean | null;
	eventTypes: string | null;
	notifConfig: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	channelName: string | null;
	channelType: string | null;
	channelEnabled: boolean | null;
};

/** Map a joined binding row. */
function parseNotifConfig(raw: string | null): NotifGroups | null {
	if (!raw) return null;
	try { return JSON.parse(raw) as NotifGroups; }
	catch { return null; }
}

function mapBindingRow(row: BindingJoinRow): ResolvedClusterBinding {
	return {
		id: row.id,
		clusterId: row.clusterId,
		notificationId: row.notificationId,
		enabled: row.enabled ?? true,
		createdAt: row.createdAt ?? '',
		updatedAt: row.updatedAt ?? '',
		channelName: row.channelName ?? undefined,
		channelType: (row.channelType as ResolvedClusterBinding['channelType']) ?? undefined,
		channelEnabled: row.channelEnabled ?? undefined,
		eventTypes: parseEventTypes(row.eventTypes),
		notifConfig: parseNotifConfig(row.notifConfig)
	};
}

// ── Channel CRUD ────────────────────────────────────────────────────────────

export async function listChannels(): Promise<ResolvedChannel[]> {
	const rows = await db
		.select()
		.from(notificationSettings)
		.orderBy(desc(notificationSettings.createdAt));
	return rows.map(mapChannelRow);
}

export async function findChannel(id: number): Promise<ResolvedChannel | null> {
	const [row] = await db.select().from(notificationSettings).where(eq(notificationSettings.id, id));
	return row ? mapChannelRow(row) : null;
}

export async function listEnabledChannels(): Promise<ResolvedChannel[]> {
	const rows = await db
		.select()
		.from(notificationSettings)
		.where(eq(notificationSettings.enabled, true));
	return rows.map(mapChannelRow);
}

export async function insertChannel(data: {
	type: 'smtp' | 'apprise';
	name: string;
	enabled?: boolean;
	config: ChannelConfig;
	eventTypes?: NotificationEventType[];
}): Promise<ResolvedChannel> {
	const [row] = await db
		.insert(notificationSettings)
		.values({
			type: data.type,
			name: data.name,
			enabled: data.enabled !== false,
			config: sealConfig(data.type, data.config),
			eventTypes: JSON.stringify(data.eventTypes ?? ALL_EVENT_IDS)
		})
		.returning();

	return mapChannelRow(row);
}

export async function patchChannel(
	id: number,
	data: {
		name?: string;
		enabled?: boolean;
		config?: ChannelConfig;
		eventTypes?: NotificationEventType[];
	}
): Promise<ResolvedChannel | null> {
	const existing = await findChannel(id);
	if (!existing) return null;

	const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };

	if (data.name !== undefined) payload.name = data.name;
	if (data.enabled !== undefined) payload.enabled = data.enabled;
	if (data.config !== undefined) payload.config = sealConfig(existing.type, data.config);
	if (data.eventTypes !== undefined) payload.eventTypes = JSON.stringify(data.eventTypes);

	await db.update(notificationSettings).set(payload).where(eq(notificationSettings.id, id));
	return findChannel(id);
}

export async function destroyChannel(id: number): Promise<void> {
	// Remove cluster bindings that reference this channel first
	await db.delete(clusterNotifications).where(eq(clusterNotifications.notificationId, id));
	await db.delete(notificationSettings).where(eq(notificationSettings.id, id));
}

// ── Cluster Notification Bindings ───────────────────────────────────────────

export async function listClusterBindings(clusterId: number): Promise<ResolvedClusterBinding[]> {
	const rows = await db
		.select(BINDING_COLS)
		.from(clusterNotifications)
		.innerJoin(
			notificationSettings,
			eq(clusterNotifications.notificationId, notificationSettings.id)
		)
		.where(eq(clusterNotifications.clusterId, clusterId))
		.orderBy(asc(notificationSettings.name));

	return rows.map((r) => mapBindingRow(r as BindingJoinRow));
}

export async function findClusterBinding(
	clusterId: number,
	notificationId: number
): Promise<ResolvedClusterBinding | null> {
	const [row] = await db
		.select(BINDING_COLS)
		.from(clusterNotifications)
		.innerJoin(
			notificationSettings,
			eq(clusterNotifications.notificationId, notificationSettings.id)
		)
		.where(
			and(
				eq(clusterNotifications.clusterId, clusterId),
				eq(clusterNotifications.notificationId, notificationId)
			)
		);

	return row ? mapBindingRow(row as BindingJoinRow) : null;
}

export async function insertClusterBinding(data: {
	clusterId: number;
	notificationId: number;
	enabled?: boolean;
	eventTypes?: NotificationEventType[];
	notifConfig?: NotifGroups;
}): Promise<ResolvedClusterBinding> {
	await db.insert(clusterNotifications).values({
		clusterId: data.clusterId,
		notificationId: data.notificationId,
		enabled: data.enabled !== false,
		eventTypes: JSON.stringify(data.eventTypes ?? ALL_EVENT_IDS),
		notifConfig: data.notifConfig ? JSON.stringify(data.notifConfig) : null
	});

	const binding = await findClusterBinding(data.clusterId, data.notificationId);
	if (!binding) throw new Error('Failed to read back inserted cluster binding');
	return binding;
}

export async function patchClusterBinding(
	clusterId: number,
	notificationId: number,
	data: { enabled?: boolean; eventTypes?: NotificationEventType[]; notifConfig?: NotifGroups }
): Promise<ResolvedClusterBinding | null> {
	const existing = await findClusterBinding(clusterId, notificationId);
	if (!existing) return null;

	const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	if (data.enabled !== undefined) payload.enabled = data.enabled;
	if (data.eventTypes !== undefined) payload.eventTypes = JSON.stringify(data.eventTypes);
	if (data.notifConfig !== undefined) payload.notifConfig = JSON.stringify(data.notifConfig);

	await db
		.update(clusterNotifications)
		.set(payload)
		.where(
			and(
				eq(clusterNotifications.clusterId, clusterId),
				eq(clusterNotifications.notificationId, notificationId)
			)
		);

	return findClusterBinding(clusterId, notificationId);
}

export async function destroyClusterBinding(
	clusterId: number,
	notificationId: number
): Promise<void> {
	await db
		.delete(clusterNotifications)
		.where(
			and(
				eq(clusterNotifications.clusterId, clusterId),
				eq(clusterNotifications.notificationId, notificationId)
			)
		);
}

export async function listEnabledClusterBindings(
	clusterId: number,
	eventType?: NotificationEventType
): Promise<(ResolvedClusterBinding & { config: ChannelConfig })[]> {
	const rows = await db
		.select({ ...BINDING_COLS, config: notificationSettings.config })
		.from(clusterNotifications)
		.innerJoin(
			notificationSettings,
			eq(clusterNotifications.notificationId, notificationSettings.id)
		)
		.where(
			and(
				eq(clusterNotifications.clusterId, clusterId),
				eq(clusterNotifications.enabled, true),
				eq(notificationSettings.enabled, true)
			)
		);

	return rows
		.map((row) => ({
			...mapBindingRow(row as BindingJoinRow),
			config: unsealConfig(row.channelType ?? 'apprise', row.config)
		}))
		.filter((row) => !eventType || row.eventTypes.includes(eventType));
}

/**
 * Replace all notification bindings for a cluster at once.
 * Used by the cluster dialog to save the full notification config.
 */
export async function replaceClusterBindings(
	clusterId: number,
	bindings: Array<{ notificationId: number; notifConfig: NotifGroups }>
): Promise<void> {
	// Remove existing bindings for this cluster
	await db.delete(clusterNotifications).where(eq(clusterNotifications.clusterId, clusterId));

	// Insert new bindings
	if (bindings.length > 0) {
		await db.insert(clusterNotifications).values(
			bindings.map((b) => ({
				clusterId,
				notificationId: b.notificationId,
				enabled: true,
				notifConfig: JSON.stringify(b.notifConfig)
			}))
		);
	}
}

/**
 * List all enabled cluster bindings with their channel configs across ALL clusters.
 * Used by the notification monitor to check K8s events.
 */
export async function listAllEnabledBindingsWithConfig(): Promise<
	Array<ResolvedClusterBinding & { config: ChannelConfig }>
> {
	const rows = await db
		.select({ ...BINDING_COLS, config: notificationSettings.config })
		.from(clusterNotifications)
		.innerJoin(
			notificationSettings,
			eq(clusterNotifications.notificationId, notificationSettings.id)
		)
		.where(
			and(
				eq(clusterNotifications.enabled, true),
				eq(notificationSettings.enabled, true)
			)
		);

	return rows
		.filter((row) => row.notifConfig) // Only bindings with notif config
		.map((row) => ({
			...mapBindingRow(row as BindingJoinRow),
			config: unsealConfig(row.channelType ?? 'apprise', row.config)
		}));
}
