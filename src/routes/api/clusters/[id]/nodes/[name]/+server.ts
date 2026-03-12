import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cordonNode, drainNode } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';
import { logAuditEvent } from '$lib/server/queries/audit';

/**
 * PATCH /api/clusters/[id]/nodes/[name]
 * Body: { unschedulable: boolean }
 * Cordon (unschedulable: true) or Uncordon (unschedulable: false) a node.
 */
export const PATCH: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterId = parseInt(params.id);
	const nodeName = params.name;

	if (isNaN(clusterId) || !nodeName) {
		return json({ error: 'Invalid cluster ID or node name' }, { status: 400 });
	}

	let body: { unschedulable?: boolean };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (typeof body.unschedulable !== 'boolean') {
		return json({ error: 'Missing required field: unschedulable (boolean)' }, { status: 400 });
	}

	const action = body.unschedulable ? 'cordon' : 'uncordon';
	const result = await cordonNode(clusterId, nodeName, body.unschedulable);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	await logAuditEvent({
		userId: auth.user?.id,
		username: auth.user?.username ?? 'system',
		action,
		entityType: 'node',
		entityId: nodeName,
		entityName: nodeName,
		clusterId,
		description: `${action === 'cordon' ? 'Cordoned' : 'Uncordoned'} node "${nodeName}"`,
		details: { clusterId, nodeName, unschedulable: body.unschedulable },
		ipAddress: getClientAddress()
	});

	return json({ success: true });
};

/**
 * POST /api/clusters/[id]/nodes/[name]
 * Body: { action: 'drain' }
 * Drain a node: cordon + evict all non-DaemonSet pods.
 */
export const POST: RequestHandler = async ({ params, request, cookies, getClientAddress }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'update'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterId = parseInt(params.id);
	const nodeName = params.name;

	if (isNaN(clusterId) || !nodeName) {
		return json({ error: 'Invalid cluster ID or node name' }, { status: 400 });
	}

	let body: { action?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (body.action !== 'drain') {
		return json({ error: 'Invalid action. Supported: drain' }, { status: 400 });
	}

	const result = await drainNode(clusterId, nodeName);

	if (!result.success) {
		return json({ success: false, error: result.error }, { status: 500 });
	}

	await logAuditEvent({
		userId: auth.user?.id,
		username: auth.user?.username ?? 'system',
		action: 'drain',
		entityType: 'node',
		entityId: nodeName,
		entityName: nodeName,
		clusterId,
		description: `Drained node "${nodeName}" (evicted: ${result.evicted}, skipped: ${result.skipped})`,
		details: { clusterId, nodeName, evicted: result.evicted, skipped: result.skipped },
		ipAddress: getClientAddress()
	});

	return json({ success: true, evicted: result.evicted, skipped: result.skipped });
};
