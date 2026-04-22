import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findCluster, patchCluster, destroyCluster } from '$lib/server/queries/clusters';
import { logAuditEvent } from '$lib/server/queries/audit';
import { invalidateClusterConfigCache } from '$lib/server/services/kubernetes/utils';
import { authorize } from '$lib/server/services/authorize';
import { upsertScanSchedule, listScanSchedules } from '$lib/server/queries/image-scans';
import { getScanScheduleCron } from '$lib/server/queries/settings';

function safeCluster(c: NonNullable<Awaited<ReturnType<typeof findCluster>>>) {
	const { kubeconfig, bearerToken, tlsCa: ___, agentToken: ____, ...rest } = c;
	return { ...rest, labels: rest.labels ?? [], hasKubeconfig: !!kubeconfig, hasBearerToken: !!bearerToken };
}

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	const clusterId = Number(params.id);
	if (auth.authEnabled && !(await auth.canAccessCluster(clusterId))) {
		return json({ error: 'Cluster access denied' }, { status: 403 });
	}
	const cluster = await findCluster(clusterId);
	if (!cluster) return json({ error: 'Cluster not found' }, { status: 404 });
	return json(safeCluster(cluster));
};

export const PATCH: RequestHandler = async ({ request, params, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	const clusterId = Number(params.id);
	if (auth.authEnabled && !(await auth.can('clusters', 'update', clusterId))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const updated = await patchCluster(Number(params.id), {
			name: body.name,
			icon: body.icon,
			labels: body.labels,
			authType: body.authType,
			namespace: body.namespace,
			context: body.context,
			apiServer: body.apiServer,
			kubeconfig: body.kubeconfig,
			bearerToken: body.bearerToken,
			tlsCa: body.tlsCa,
			tlsSkipVerify: body.tlsSkipVerify,
			agentToken: body.agentToken,
			metricsEnabled: body.metricsEnabled != null ? Boolean(body.metricsEnabled) : undefined,
			cpuWarnThreshold: body.cpuWarnThreshold != null ? Number(body.cpuWarnThreshold) : undefined,
			cpuCritThreshold: body.cpuCritThreshold != null ? Number(body.cpuCritThreshold) : undefined,
			memWarnThreshold: body.memWarnThreshold != null ? Number(body.memWarnThreshold) : undefined,
			memCritThreshold: body.memCritThreshold != null ? Number(body.memCritThreshold) : undefined,
			scanEnabled: body.scanEnabled != null ? Boolean(body.scanEnabled) : undefined,
			scannerPreference: body.scannerPreference ?? undefined
		});

		if (!updated) return json({ error: 'Cluster not found' }, { status: 404 });

		// Invalidate cached connection config so next request uses new credentials
		invalidateClusterConfigCache(Number(params.id));

		// Sync scan schedule when scanEnabled changes
		if (body.scanEnabled != null) {
			try {
				const [existing] = await listScanSchedules(Number(params.id));
				if (body.scanEnabled) {
					// Create or re-enable the schedule
					const globalCron = await getScanScheduleCron();
					await upsertScanSchedule({
						clusterId: Number(params.id),
						enabled: true,
						cronExpression: existing?.cronExpression ?? globalCron,
						namespaces: existing?.namespaces ?? null,
						lastRunAt: existing?.lastRunAt ?? null,
						nextRunAt: existing?.nextRunAt ?? null
					});
					console.log(`[API] Auto-enabled scan schedule for cluster #${params.id}`);
				} else if (existing) {
					// Disable the existing schedule
					await upsertScanSchedule({
						clusterId: Number(params.id),
						enabled: false,
						cronExpression: existing.cronExpression,
						namespaces: existing.namespaces ?? null,
						lastRunAt: existing.lastRunAt ?? null,
						nextRunAt: existing.nextRunAt ?? null
					});
					console.log(`[API] Auto-disabled scan schedule for cluster #${params.id}`);
				}
			} catch (schedErr) {
				console.error(`[API] Failed to sync scan schedule for cluster #${params.id}:`, schedErr);
			}
		}

		// Strip sensitive auth fields from audit details
		const { kubeconfig: _, bearerToken: __, tlsCa: ___, agentToken: ____, ...safeDetails } = body;
		const maskedDetails: Record<string, unknown> = { ...safeDetails };
		if (body.kubeconfig !== undefined) maskedDetails.kubeconfig = '***';
		if (body.bearerToken !== undefined) maskedDetails.bearerToken = '***';
		if (body.tlsCa !== undefined) maskedDetails.tlsCa = '***';
		if (body.agentToken !== undefined) maskedDetails.agentToken = '***';

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'update',
			entityType: 'cluster',
			entityId: params.id,
			entityName: updated.name,
			clusterId: Number(params.id),
			description: `Updated cluster "${updated.name}"`,
			details: maskedDetails,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(safeCluster(updated));
	} catch (err) {
		console.error('[API] Failed to update cluster:', err);
		return json({ error: 'Failed to update cluster' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, params, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	const clusterId = Number(params.id);
	if (auth.authEnabled && !(await auth.can('clusters', 'delete', clusterId))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const existing = await findCluster(Number(params.id));
		if (!existing) return json({ error: 'Cluster not found' }, { status: 404 });

		await destroyCluster(Number(params.id));
		invalidateClusterConfigCache(Number(params.id));

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'delete',
			entityType: 'cluster',
			entityId: params.id,
			entityName: existing.name,
			description: `Deleted cluster "${existing.name}"`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json({ message: `Cluster ${params.id} deleted` });
	} catch (err) {
		console.error('[API] Failed to delete cluster:', err);
		return json({ error: 'Failed to delete cluster' }, { status: 500 });
	}
};
