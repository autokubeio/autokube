import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { logAuditEvent } from '$lib/server/queries/audit';
import { findImageScan, deleteImageScan, updateImageScan } from '$lib/server/queries/image-scans';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'view'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const id = Number(params.id);
		if (isNaN(id)) {
			return json({ error: 'Invalid scan ID' }, { status: 400 });
		}

		const scan = await findImageScan(id);
		if (!scan) {
			return json({ error: 'Scan not found' }, { status: 404 });
		}

		return json({ scan });
	} catch (err) {
		console.error('[API] Failed to get image scan:', err);
		return json({ error: 'Failed to get image scan' }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ params, cookies, request, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'scan'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const id = Number(params.id);
		if (isNaN(id)) {
			return json({ error: 'Invalid scan ID' }, { status: 400 });
		}

		const scan = await findImageScan(id);
		if (!scan) {
			return json({ error: 'Scan not found' }, { status: 404 });
		}

		if (scan.status !== 'scanning' && scan.status !== 'pending') {
			return json({ error: 'Only scanning or pending scans can be reset' }, { status: 400 });
		}

		const updated = await updateImageScan(id, {
			status: 'failed',
			errorMessage: 'Manually reset — scan job did not complete',
			completedAt: new Date().toISOString()
		});

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'update',
			entityType: 'cluster',
			entityName: scan.image,
			description: `Reset stuck scan for image ${scan.image}`,
			clusterId: scan.clusterId ?? undefined,
			ipAddress: request.headers.get('x-forwarded-for') ?? getClientAddress(),
			userAgent: request.headers.get('user-agent')
		});

		return json({ scan: updated });
	} catch (err) {
		console.error('[API] Failed to reset image scan:', err);
		return json({ error: 'Failed to reset image scan' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, cookies, request, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'delete'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const id = Number(params.id);
		if (isNaN(id)) {
			return json({ error: 'Invalid scan ID' }, { status: 400 });
		}

		const scan = await findImageScan(id);
		if (!scan) {
			return json({ error: 'Scan not found' }, { status: 404 });
		}

		await deleteImageScan(id);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'cluster',
			entityName: scan.image,
			description: `Deleted security scan for image ${scan.image}`,
			clusterId: scan.clusterId ?? undefined,
			ipAddress: request.headers.get('x-forwarded-for') ?? getClientAddress(),
			userAgent: request.headers.get('user-agent')
		});

		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete image scan:', err);
		return json({ error: 'Failed to delete image scan' }, { status: 500 });
	}
};
