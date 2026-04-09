/**
 * POST /api/provisioning/[id]/start
 *
 * Triggers the Terraform provisioning job for a cluster that is in
 * `pending` or `error` status. Returns immediately; progress is streamed
 * via the SSE endpoint at /api/provisioning/[id]/logs/stream.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { getProvisionedCluster } from '$lib/server/queries/provisioned-clusters';
import { logAuditEvent } from '$lib/server/queries/audit';
import { startProvisioning } from '$lib/server/provisioning/index';
import { jobManager } from '$lib/server/provisioning/engine/job-manager';

export const POST: RequestHandler = async ({ params, cookies, request }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'create'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'Invalid cluster ID' }, { status: 400 });

	const cluster = await getProvisionedCluster(id);
	if (!cluster) return json({ error: 'Cluster not found' }, { status: 404 });

	// Guard: don't start if already running
	if (jobManager.isRunning(id)) {
		return json({ error: 'Provisioning is already in progress for this cluster.' }, { status: 409 });
	}

	// Only allow start from pending or error states
	if (cluster.status === 'running') {
		return json({ error: 'Cluster is already running.' }, { status: 409 });
	}

	try {
		await startProvisioning(id);

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'cluster',
			entityId: String(id),
			entityName: `${cluster.clusterName} (provisioning started)`,
			ipAddress: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
			userAgent: request.headers.get('user-agent')
		});

		return json({ success: true, message: 'Provisioning started', clusterId: id });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to start provisioning';
		console.error('[API/provisioning/start]', err);
		return json({ error: message }, { status: 500 });
	}
};
