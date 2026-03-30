/**
 * Image Security Scan Operations
 * Database operations for container image vulnerability scanning
 */

import {
	db,
	eq,
	desc,
	and,
	sql,
	imageScans,
	imageScanVulnerabilities,
	scanSchedules,
	clusters,
	type ImageScan,
	type NewImageScan,
	type ImageScanVulnerability,
	type NewImageScanVulnerability,
	type ScanSchedule,
	type NewScanSchedule
} from '../db';
import { getCurrentTimestamp } from '../helpers';

// ── Types ───────────────────────────────────────────────────────────────────

export interface VulnerabilitySummary {
	critical: number;
	high: number;
	medium: number;
	low: number;
	unknown: number;
}

export interface ImageScanWithVulns extends ImageScan {
	vulnerabilities: ImageScanVulnerability[];
	parsedSummary: VulnerabilitySummary | null;
	clusterName?: string;
}

export interface ImageScanListItem extends ImageScan {
	parsedSummary: VulnerabilitySummary | null;
	clusterName?: string;
	totalVulns: number;
	scanCount?: number;
}

export interface ImageScanFilters {
	clusterId?: number;
	status?: string;
	severity?: string;
	image?: string;
	limit?: number;
	offset?: number;
	grouped?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseSummary(summary: string | null): VulnerabilitySummary | null {
	if (!summary) return null;
	try {
		return JSON.parse(summary) as VulnerabilitySummary;
	} catch {
		return null;
	}
}

function mapScanRow(row: ImageScan, clusterName?: string | null): ImageScanListItem {
	const parsedSummary = parseSummary(row.summary);
	const totalVulns = parsedSummary
		? parsedSummary.critical + parsedSummary.high + parsedSummary.medium + parsedSummary.low + parsedSummary.unknown
		: 0;
	return {
		...row,
		parsedSummary,
		clusterName: clusterName ?? undefined,
		totalVulns
	};
}

// ── Image Scan CRUD ─────────────────────────────────────────────────────────

export async function listImageScans(filters: ImageScanFilters = {}): Promise<{
	scans: ImageScanListItem[];
	total: number;
}> {
	if (filters.grouped) {
		return listImageScansGrouped(filters);
	}

	const limit = filters.limit;
	const offset = filters.offset ?? 0;

	const conditions = [];
	if (filters.clusterId) conditions.push(eq(imageScans.clusterId, filters.clusterId));
	if (filters.status) conditions.push(eq(imageScans.status, filters.status));
	if (filters.image) conditions.push(sql`${imageScans.image} LIKE ${'%' + filters.image + '%'}`);

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	let query = db
		.select({
			scan: imageScans,
			clusterName: clusters.name
		})
		.from(imageScans)
		.leftJoin(clusters, eq(imageScans.clusterId, clusters.id))
		.where(where)
		.orderBy(desc(imageScans.createdAt))
		.$dynamic();

	if (limit) {
		query = query.limit(limit).offset(offset);
	}

	const [rows, countResult] = await Promise.all([
		query,
		db
			.select({ count: sql<number>`count(*)` })
			.from(imageScans)
			.where(where)
	]);

	const scans = rows.map((r) => mapScanRow(r.scan, r.clusterName));

	// If severity filter, post-filter scans that have vulns at that severity
	if (filters.severity) {
		const severityLower = filters.severity.toLowerCase();
		const filtered = scans.filter((s) => {
			if (!s.parsedSummary) return false;
			const key = severityLower as keyof VulnerabilitySummary;
			return (s.parsedSummary[key] ?? 0) > 0;
		});
		return { scans: filtered, total: filtered.length };
	}

	return { scans, total: Number(countResult[0]?.count ?? 0) };
}

/**
 * List image scans grouped by image:tag — returns only the latest scan per unique image.
 * Includes a scanCount field indicating how many times each image has been scanned.
 */
async function listImageScansGrouped(filters: ImageScanFilters): Promise<{
	scans: ImageScanListItem[];
	total: number;
}> {
	const conditions = [];
	if (filters.clusterId) conditions.push(eq(imageScans.clusterId, filters.clusterId));
	if (filters.status) conditions.push(eq(imageScans.status, filters.status));
	if (filters.image) conditions.push(sql`${imageScans.image} LIKE ${'%' + filters.image + '%'}`);

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	// Subquery: get the latest scan ID per image+tag
	const latestIds = db
		.select({
			latestId: sql<number>`MAX(${imageScans.id})`.as('latest_id'),
			scanCount: sql<number>`COUNT(*)`.as('scan_count'),
			img: imageScans.image,
			tg: sql`COALESCE(${imageScans.tag}, 'latest')`.as('tg')
		})
		.from(imageScans)
		.where(where)
		.groupBy(imageScans.image, sql`COALESCE(${imageScans.tag}, 'latest')`)
		.as('latest');

	// Join back to get full scan rows with cluster name
	const rows = await db
		.select({
			scan: imageScans,
			clusterName: clusters.name,
			scanCount: latestIds.scanCount
		})
		.from(latestIds)
		.innerJoin(imageScans, eq(imageScans.id, latestIds.latestId))
		.leftJoin(clusters, eq(imageScans.clusterId, clusters.id))
		.orderBy(desc(imageScans.createdAt));

	let scans = rows.map((r) => ({
		...mapScanRow(r.scan, r.clusterName),
		scanCount: Number(r.scanCount)
	}));

	// Post-filter by severity if requested
	if (filters.severity) {
		const severityLower = filters.severity.toLowerCase();
		scans = scans.filter((s) => {
			if (!s.parsedSummary) return false;
			const key = severityLower as keyof VulnerabilitySummary;
			return (s.parsedSummary[key] ?? 0) > 0;
		});
	}

	return { scans, total: scans.length };
}

/**
 * Get scan history for a specific image:tag — returns all scans in descending order.
 */
export async function getImageScanHistory(
	image: string,
	tag: string = 'latest',
	clusterId?: number
): Promise<ImageScanListItem[]> {
	const conditions = [
		eq(imageScans.image, image),
		sql`COALESCE(${imageScans.tag}, 'latest') = ${tag}`
	];
	if (clusterId) conditions.push(eq(imageScans.clusterId, clusterId));

	const rows = await db
		.select({
			scan: imageScans,
			clusterName: clusters.name
		})
		.from(imageScans)
		.leftJoin(clusters, eq(imageScans.clusterId, clusters.id))
		.where(and(...conditions))
		.orderBy(desc(imageScans.createdAt));

	return rows.map((r) => mapScanRow(r.scan, r.clusterName));
}

export async function findImageScan(id: number): Promise<ImageScanWithVulns | undefined> {
	const [row] = await db
		.select({
			scan: imageScans,
			clusterName: clusters.name
		})
		.from(imageScans)
		.leftJoin(clusters, eq(imageScans.clusterId, clusters.id))
		.where(eq(imageScans.id, id));

	if (!row) return undefined;

	const vulns = await db
		.select()
		.from(imageScanVulnerabilities)
		.where(eq(imageScanVulnerabilities.scanId, id))
		.orderBy(
			sql`CASE ${imageScanVulnerabilities.severity}
				WHEN 'CRITICAL' THEN 0
				WHEN 'HIGH' THEN 1
				WHEN 'MEDIUM' THEN 2
				WHEN 'LOW' THEN 3
				ELSE 4
			END`
		);

	return {
		...row.scan,
		parsedSummary: parseSummary(row.scan.summary),
		clusterName: row.clusterName ?? undefined,
		vulnerabilities: vulns,
		totalVulns: vulns.length
	} as ImageScanWithVulns & { totalVulns: number };
}

export async function insertImageScan(
	data: Omit<NewImageScan, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ImageScan> {
	const now = getCurrentTimestamp();
	const [row] = await db
		.insert(imageScans)
		.values({ ...data, createdAt: now, updatedAt: now })
		.returning();
	return row;
}

export async function updateImageScan(
	id: number,
	patch: Partial<Pick<ImageScan, 'status' | 'summary' | 'errorMessage' | 'startedAt' | 'completedAt' | 'scanner'>>
): Promise<ImageScan | undefined> {
	const [row] = await db
		.update(imageScans)
		.set({ ...patch, updatedAt: getCurrentTimestamp() })
		.where(eq(imageScans.id, id))
		.returning();
	return row;
}

export async function deleteImageScan(id: number): Promise<void> {
	await db.delete(imageScans).where(eq(imageScans.id, id));
}

export async function deleteOldScans(retentionDays: number = 30): Promise<number> {
	const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
	const result = await db
		.delete(imageScans)
		.where(sql`${imageScans.createdAt} < ${cutoff}`)
		.returning({ id: imageScans.id });
	return result.length;
}

/**
 * Get images that were recently scanned (completed, scanning, or pending) for a cluster.
 * Returns a Set of "image:tag" strings that shouldn't be re-scanned.
 */
export async function getRecentlyScannedImages(
	clusterId: number,
	withinMinutes: number = 60
): Promise<Set<string>> {
	const cutoff = new Date(Date.now() - withinMinutes * 60_000).toISOString();
	const rows = await db
		.select({ image: imageScans.image, tag: imageScans.tag })
		.from(imageScans)
		.where(
			and(
				eq(imageScans.clusterId, clusterId),
				sql`${imageScans.status} IN ('completed', 'scanning', 'pending')`,
				sql`${imageScans.createdAt} >= ${cutoff}`
			)
		);
	return new Set(rows.map((r) => `${r.image}:${r.tag ?? 'latest'}`));
}

// ── Vulnerability CRUD ──────────────────────────────────────────────────────

export async function insertVulnerabilities(
	scanId: number,
	vulns: Omit<NewImageScanVulnerability, 'id' | 'scanId' | 'createdAt'>[]
): Promise<void> {
	if (vulns.length === 0) return;

	const now = getCurrentTimestamp();
	const rows = vulns.map((v) => ({
		...v,
		scanId,
		createdAt: now
	}));

	// Batch insert in chunks of 100 to avoid SQLite variable limits
	const CHUNK_SIZE = 100;
	for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
		const chunk = rows.slice(i, i + CHUNK_SIZE);
		await db.insert(imageScanVulnerabilities).values(chunk);
	}
}

export async function getVulnerabilitiesForScan(
	scanId: number,
	severity?: string
): Promise<ImageScanVulnerability[]> {
	const conditions = [eq(imageScanVulnerabilities.scanId, scanId)];
	if (severity) conditions.push(eq(imageScanVulnerabilities.severity, severity.toUpperCase()));

	return db
		.select()
		.from(imageScanVulnerabilities)
		.where(and(...conditions))
		.orderBy(
			sql`CASE ${imageScanVulnerabilities.severity}
				WHEN 'CRITICAL' THEN 0
				WHEN 'HIGH' THEN 1
				WHEN 'MEDIUM' THEN 2
				WHEN 'LOW' THEN 3
				ELSE 4
			END`
		);
}

// ── Scan Schedules ──────────────────────────────────────────────────────────

export async function listScanSchedules(clusterId?: number): Promise<ScanSchedule[]> {
	if (clusterId) {
		return db
			.select()
			.from(scanSchedules)
			.where(eq(scanSchedules.clusterId, clusterId));
	}
	return db.select().from(scanSchedules);
}

export async function findScanSchedule(id: number): Promise<ScanSchedule | undefined> {
	const [row] = await db.select().from(scanSchedules).where(eq(scanSchedules.id, id));
	return row;
}

export async function upsertScanSchedule(
	data: Omit<NewScanSchedule, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ScanSchedule> {
	const now = getCurrentTimestamp();
	// Check if schedule exists for this cluster
	if (data.clusterId) {
		const [existing] = await db
			.select()
			.from(scanSchedules)
			.where(eq(scanSchedules.clusterId, data.clusterId));

		if (existing) {
			const [updated] = await db
				.update(scanSchedules)
				.set({ ...data, updatedAt: now })
				.where(eq(scanSchedules.id, existing.id))
				.returning();
			return updated;
		}
	}

	const [row] = await db
		.insert(scanSchedules)
		.values({ ...data, createdAt: now, updatedAt: now })
		.returning();
	return row;
}

export async function deleteScanSchedule(id: number): Promise<void> {
	await db.delete(scanSchedules).where(eq(scanSchedules.id, id));
}

// ── Stats ───────────────────────────────────────────────────────────────────

export async function getScanStats(clusterId?: number) {
	const conditions = clusterId ? [eq(imageScans.clusterId, clusterId)] : [];
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const [totalResult] = await db
		.select({ count: sql<number>`count(*)` })
		.from(imageScans)
		.where(where);

	// Subquery: latest scan ID per unique image+tag (same logic as listImageScansGrouped)
	const latestPerImage = db
		.select({
			latestId: sql<number>`MAX(${imageScans.id})`.as('latest_id')
		})
		.from(imageScans)
		.where(where)
		.groupBy(imageScans.image, sql`COALESCE(${imageScans.tag}, 'latest')`)
		.as('latest_per_image');

	// Join back to get only those latest rows
	const latestScans = await db
		.select({ summary: imageScans.summary, status: imageScans.status })
		.from(latestPerImage)
		.innerJoin(imageScans, eq(imageScans.id, latestPerImage.latestId));

	let critical = 0, high = 0, medium = 0, low = 0;
	let completedCount = 0;
	for (const scan of latestScans) {
		if (scan.status === 'completed') {
			completedCount++;
			const s = parseSummary(scan.summary);
			if (s) {
				critical += s.critical;
				high += s.high;
				medium += s.medium;
				low += s.low;
			}
		}
	}

	return {
		totalScans: Number(totalResult?.count ?? 0),
		completedScans: completedCount,
		vulnerabilities: { critical, high, medium, low }
	};
}

// ── Notification helpers ────────────────────────────────────────────────────

/**
 * Get scans completed or failed since a given timestamp.
 * Used by the notification monitor to dispatch vulnerability alerts.
 */
export async function getScansCompletedSince(since: string): Promise<ImageScanListItem[]> {
	const rows = await db
		.select({
			scan: imageScans,
			clusterName: clusters.name
		})
		.from(imageScans)
		.leftJoin(clusters, eq(imageScans.clusterId, clusters.id))
		.where(
			and(
				sql`${imageScans.status} IN ('completed', 'failed')`,
				sql`${imageScans.completedAt} > ${since}`
			)
		)
		.orderBy(desc(imageScans.completedAt));

	return rows.map((r) => mapScanRow(r.scan, r.clusterName));
}
