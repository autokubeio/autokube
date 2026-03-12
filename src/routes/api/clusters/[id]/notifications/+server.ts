import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listClusterBindings,
	replaceClusterBindings
} from '$lib/server/queries/notifications';
import { findCluster } from '$lib/server/queries/clusters';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';
import type { NotifGroups } from '$lib/notifications-constants';

/**
 * GET /api/clusters/:id/notifications
 * List all notification bindings for a cluster.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterId = Number(params.id);
	const cluster = await findCluster(clusterId);
	if (!cluster) return json({ error: 'Cluster not found' }, { status: 404 });

	const bindings = await listClusterBindings(clusterId);
	return json({ bindings });
};

/**
 * PUT /api/clusters/:id/notifications
 * Replace all notification bindings for a cluster.
 * Body: { bindings: Array<{ channelId: number; notifConfig: NotifGroups }> }
 */
export const PUT: RequestHandler = async ({ request, params, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterId = Number(params.id);
	const cluster = await findCluster(clusterId);
	if (!cluster) return json({ error: 'Cluster not found' }, { status: 404 });

	const body = (await request.json()) as {
		bindings?: Array<{ channelId: number; notifConfig: NotifGroups }>;
	};

	if (!Array.isArray(body.bindings)) {
		return json({ error: 'bindings must be an array' }, { status: 400 });
	}

	await replaceClusterBindings(
		clusterId,
		body.bindings.map((b) => ({
			notificationId: b.channelId,
			notifConfig: b.notifConfig
		}))
	);

	await logAuditEvent({
		username: 'system',
		action: 'update',
		entityType: 'cluster',
		entityId: String(clusterId),
		entityName: cluster.name,
		description: `Updated notification bindings for cluster "${cluster.name}" (${body.bindings.length} channel(s))`,
		ipAddress: getClientAddress(),
		userAgent: request.headers.get('user-agent') ?? null
	});

	return json({ success: true, count: body.bindings.length });
};
