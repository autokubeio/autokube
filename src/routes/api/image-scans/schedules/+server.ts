import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { logAuditEvent } from '$lib/server/queries/audit';
import {
	listScanSchedules,
	upsertScanSchedule,
	deleteScanSchedule
} from '$lib/server/queries/image-scans';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'view'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const clusterId = url.searchParams.get('clusterId');
		const schedules = await listScanSchedules(clusterId ? Number(clusterId) : undefined);
		return json({ schedules });
	} catch (err) {
		console.error('[API] Failed to list scan schedules:', err);
		return json({ error: 'Failed to list scan schedules' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'scan'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();

		if (!body.clusterId) {
			return json({ error: 'Cluster ID is required' }, { status: 400 });
		}

		const schedule = await upsertScanSchedule({
			clusterId: Number(body.clusterId),
			enabled: body.enabled ?? true,
			cronExpression: body.cronExpression ?? '0 2 * * *',
			namespaces: body.namespaces ? JSON.stringify(body.namespaces) : null,
			lastRunAt: null,
			nextRunAt: null
		});

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'configure',
			entityType: 'cluster',
			entityId: String(body.clusterId),
			description: `Configured scan schedule: ${body.cronExpression ?? '0 2 * * *'}`,
			clusterId: Number(body.clusterId),
			ipAddress: request.headers.get('x-forwarded-for') ?? getClientAddress(),
			userAgent: request.headers.get('user-agent')
		});

		return json({ schedule }, { status: 201 });
	} catch (err) {
		console.error('[API] Failed to save scan schedule:', err);
		return json({ error: 'Failed to save scan schedule' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ url, cookies, request, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('image_scans', 'scan'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const id = Number(url.searchParams.get('id'));
		if (isNaN(id)) {
			return json({ error: 'Invalid schedule ID' }, { status: 400 });
		}

		await deleteScanSchedule(id);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'cluster',
			description: `Deleted scan schedule #${id}`,
			ipAddress: request.headers.get('x-forwarded-for') ?? getClientAddress(),
			userAgent: request.headers.get('user-agent')
		});

		return json({ success: true });
	} catch (err) {
		console.error('[API] Failed to delete scan schedule:', err);
		return json({ error: 'Failed to delete scan schedule' }, { status: 500 });
	}
};
