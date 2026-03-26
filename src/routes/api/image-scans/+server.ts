import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { logAuditEvent } from '$lib/server/queries/audit';
import {
	listImageScans,
	getScanStats,
	deleteOldScans,
	getRecentlyScannedImages,
	getImageScanHistory
} from '$lib/server/queries/image-scans';
import { executeScan, executeScanBatch, extractWorkloadImages } from '$lib/server/services/image-scanner';
import { makeClusterRequest } from '$lib/server/services/kubernetes/utils';
import { getScanConcurrency } from '$lib/server/queries/settings';
import { findCluster } from '$lib/server/queries/clusters';

/** Safely resolve client IP — getClientAddress() throws in Vite dev when socket has no remoteAddress */
function safeClientIp(request: Request, getClientAddress: () => string): string {
	return request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? (() => { try { return getClientAddress(); } catch { return 'unknown'; } })();
}

// ── Server-side scan lock (HMR-safe) ────────────────────────────────────────

declare global {
	var __batchScanRunning: boolean;
	var __batchScanCancelled: boolean;
}
globalThis.__batchScanRunning ??= false;
globalThis.__batchScanCancelled ??= false;

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'view'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const params = url.searchParams;

		// Return scanner status info (scanning always available — runs in-cluster)
		if (params.get('info') === 'status') {
			return json({ available: true, version: 'in-cluster (Grype/Trivy)' });
		}

		// Return aggregate stats
		if (params.get('info') === 'stats') {
			const clusterId = params.get('clusterId');
			const stats = await getScanStats(clusterId ? Number(clusterId) : undefined);
			return json(stats);
		}

		// Return scan history for a specific image:tag
		if (params.get('info') === 'history') {
			const image = params.get('image');
			if (!image) return json({ error: 'Image is required' }, { status: 400 });
			const tag = params.get('tag') ?? 'latest';
			const clusterId = params.get('clusterId') ? Number(params.get('clusterId')) : undefined;
			const history = await getImageScanHistory(image, tag, clusterId);
			return json({ history });
		}

		// List scans with filters
		const filters = {
			clusterId: params.get('clusterId') ? Number(params.get('clusterId')) : undefined,
			status: params.get('status') ?? undefined,
			severity: params.get('severity') ?? undefined,
			image: params.get('image') ?? undefined,
			limit: params.get('limit') ? Number(params.get('limit')) : undefined,
			offset: params.get('offset') ? Number(params.get('offset')) : undefined,
			grouped: params.get('grouped') === 'true'
		};

		const result = await listImageScans(filters);
		return json(result);
	} catch (err) {
		console.error('[API] Failed to list image scans:', err);
		return json({ error: 'Failed to list image scans' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'scan'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();

		// Require a cluster — all scans run as Jobs inside the cluster
		if (!body.clusterId && !body.scanAll) {
			return json(
				{ error: 'A cluster must be selected to scan images.' },
				{ status: 400 }
			);
		}

		// ── Scan all images from a cluster ──────────────────────────────────
		if (body.scanAll && body.clusterId) {
			// Prevent concurrent batch scans
			if (globalThis.__batchScanRunning) {
				return json(
					{ error: 'A batch scan is already in progress. Please wait for it to finish.' },
					{ status: 409 }
				);
			}

			globalThis.__batchScanRunning = true;
			globalThis.__batchScanCancelled = false;
			try {
				const clusterId = Number(body.clusterId);

				// Read cluster's scanner preference from DB
				const cluster = await findCluster(clusterId);
				const clusterScannerPref = cluster?.scannerPreference as 'grype' | 'trivy' | 'both' | undefined;
				const clusterRequest = async (path: string) => {
					const result = await makeClusterRequest(clusterId, path);
					if (!result.success) throw new Error(result.error);
					return result.data as { items?: Array<{ metadata?: { name?: string; namespace?: string }; spec?: { template?: { spec?: { containers?: Array<{ image?: string }> } } } }> };
				};

				const images = await extractWorkloadImages(clusterRequest);
				if (images.length === 0) {
					return json({ error: 'No container images found in cluster workloads' }, { status: 404 });
				}

				// Skip images scanned within the last hour (unless force rescan)
				let newImages = images;
				let skippedCount = 0;
				if (!body.forceRescan) {
					const recentlyScanned = await getRecentlyScannedImages(clusterId);
					newImages = images.filter(
						(img) => !recentlyScanned.has(`${img.image}:${img.tag ?? 'latest'}`)
					);
					skippedCount = images.length - newImages.length;

					if (newImages.length === 0) {
						return json({
							scans: [],
							total: 0,
							skipped: images.length,
							message: 'All images were scanned within the last hour'
						}, { status: 200 });
					}
				}

				const concurrency = body.concurrency ?? await getScanConcurrency();
				const scans = await executeScanBatch(
					newImages.map((img) => ({
						image: img.image,
						tag: img.tag,
						clusterId,
						resource: img.resource,
						resourceNamespace: img.resourceNamespace,
						trigger: 'manual' as const,
						scannerPreference: body.scannerPreference ?? clusterScannerPref ?? 'both'
					})),
					concurrency,
					() => globalThis.__batchScanCancelled
				);

				await logAuditEvent({
					username: auth.user?.username ?? 'system',
					action: 'create',
					entityType: 'image_scan',
					description: `Batch scan completed: ${scans.length} image${scans.length !== 1 ? 's' : ''} scanned, ${skippedCount} skipped (scanned within last hour)${globalThis.__batchScanCancelled ? ' — cancelled by user' : ''}`,
					clusterId,
					ipAddress: safeClientIp(request, getClientAddress),
					userAgent: request.headers.get('user-agent')
				});

				return json({
					scans,
					total: scans.length,
					skipped: skippedCount,
					cancelled: globalThis.__batchScanCancelled
				}, { status: 201 });
			} finally {
				globalThis.__batchScanRunning = false;
				globalThis.__batchScanCancelled = false;
			}
		}

		// ── Scan a single image ─────────────────────────────────────────────
		if (!body.image?.trim()) {
			return json({ error: 'Image name is required' }, { status: 400 });
		}

		const clusterId = body.clusterId ? Number(body.clusterId) : undefined;
		// Read cluster's scanner preference from DB
		let clusterScannerPref: 'grype' | 'trivy' | 'both' | undefined;
		if (clusterId) {
			const cluster = await findCluster(clusterId);
			clusterScannerPref = cluster?.scannerPreference as typeof clusterScannerPref;
		}

		const scan = await executeScan({
			image: body.image.trim(),
			tag: body.tag ?? undefined,
			clusterId,
			resource: body.resource ?? undefined,
			resourceNamespace: body.resourceNamespace ?? undefined,
			trigger: 'manual',
			scannerPreference: body.scannerPreference ?? clusterScannerPref ?? 'both'
		});

		const imageRef = body.tag ? `${body.image.trim()}:${body.tag}` : body.image.trim();
		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'image_scan',
			entityName: imageRef,
			description: `Scanned image: ${imageRef}`,
			clusterId: body.clusterId ? Number(body.clusterId) : undefined,
			ipAddress: safeClientIp(request, getClientAddress),
			userAgent: request.headers.get('user-agent')
		});

		return json({ scan }, { status: 201 });
	} catch (err) {
		console.error('[API] Failed to create image scan:', err);
		return json({ error: 'Failed to create image scan' }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ cookies, request, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'scan'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	globalThis.__batchScanCancelled = true;

	await logAuditEvent({
		username: auth.user?.username ?? 'system',
		action: 'update',
		entityType: 'image_scan',
		description: 'Batch image scan cancelled by user',
		ipAddress: safeClientIp(request, getClientAddress),
		userAgent: request.headers.get('user-agent')
	});

	return json({ cancelled: true });
};

export const DELETE: RequestHandler = async ({ url, cookies, request, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'delete'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const days = Number(url.searchParams.get('retentionDays') ?? 30);
		const deleted = await deleteOldScans(days);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'image_scan',
			description: `Cleaned up ${deleted} image scan record${deleted !== 1 ? 's' : ''} older than ${days} days`,
			ipAddress: safeClientIp(request, getClientAddress),
			userAgent: request.headers.get('user-agent')
		});

		return json({ deleted });
	} catch (err) {
		console.error('[API] Failed to clean up old scans:', err);
		return json({ error: 'Failed to clean up old scans' }, { status: 500 });
	}
};
