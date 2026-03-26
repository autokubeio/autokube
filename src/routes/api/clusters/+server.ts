import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listClusters, insertCluster } from '$lib/server/queries/clusters';
import { logAuditEvent } from '$lib/server/queries/audit';
import { authorize } from '$lib/server/services/authorize';
import { upsertScanSchedule } from '$lib/server/queries/image-scans';
import { getScanScheduleCron } from '$lib/server/queries/settings';

/** Strip sensitive fields before sending to the client. */
function safeCluster(c: Awaited<ReturnType<typeof insertCluster>>) {
	const { kubeconfig, bearerToken, tlsCa: ___, agentToken: ____, ...rest } = c;
	return {
		...rest,
		labels: rest.labels ?? [],
		hasKubeconfig: !!kubeconfig,
		hasBearerToken: !!bearerToken
	};
}

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const rows = await listClusters();
		return json({ clusters: rows.map(safeCluster), total: rows.length });
	} catch (err) {
		console.error('[API] Failed to list clusters:', err);
		return json({ error: 'Failed to list clusters' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, getClientAddress, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'create')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();

		if (!body.name?.trim()) {
			return json({ error: 'Name is required' }, { status: 400 });
		}

		const authType = body.authType ?? 'kubeconfig';
		const validAuthTypes = ['kubeconfig', 'bearer-token', 'agent'];
		if (!validAuthTypes.includes(authType)) {
			return json({ error: 'Invalid authType' }, { status: 400 });
		}

		const cluster = await insertCluster({
			name: body.name.trim(),
			icon: body.icon ?? 'globe',
			labels: Array.isArray(body.labels) ? body.labels : [],
			authType,
			namespace: body.namespace ?? 'default',
			context: body.context ?? null,
			apiServer: body.apiServer ?? null,
			kubeconfig: body.kubeconfig ?? null,
			bearerToken: body.bearerToken ?? null,
			tlsCa: body.tlsCa ?? null,
			tlsSkipVerify: body.tlsSkipVerify ?? false,
			agentUrl: null,
			agentToken: body.agentToken ?? null,
			metricsEnabled: body.metricsEnabled != null ? Boolean(body.metricsEnabled) : true,
			isProvisioned: false,
			provisionedClusterId: null,
			cpuWarnThreshold: body.cpuWarnThreshold != null ? Number(body.cpuWarnThreshold) : 60,
			cpuCritThreshold: body.cpuCritThreshold != null ? Number(body.cpuCritThreshold) : 80,
			memWarnThreshold: body.memWarnThreshold != null ? Number(body.memWarnThreshold) : 60,
			memCritThreshold: body.memCritThreshold != null ? Number(body.memCritThreshold) : 80,
			scanEnabled: body.scanEnabled != null ? Boolean(body.scanEnabled) : false,
			scannerPreference: body.scannerPreference ?? 'both'
		});

		// Auto-create a scan schedule if scanning is enabled for this cluster
		if (cluster.scanEnabled) {
			try {
				const globalCron = await getScanScheduleCron();
				await upsertScanSchedule({
					clusterId: cluster.id,
					enabled: true,
					cronExpression: globalCron,
					namespaces: null,
					lastRunAt: null,
					nextRunAt: null
				});
				console.log(`[API] Auto-created scan schedule for cluster #${cluster.id} with cron: ${globalCron}`);
			} catch (schedErr) {
				console.error(`[API] Failed to auto-create scan schedule for cluster #${cluster.id}:`, schedErr);
			}
		}

		await logAuditEvent({
			username: auth.user?.username ?? 'system',
			action: 'create',
			entityType: 'cluster',
			entityId: String(cluster.id),
			entityName: cluster.name,
			clusterId: cluster.id,
			description: `Created cluster "${cluster.name}" (${authType})`,
			ipAddress: getClientAddress(),
			userAgent: request.headers.get('user-agent') ?? null
		});

		return json(safeCluster(cluster), { status: 201 });
	} catch (err) {
		console.error('[API] Failed to create cluster:', err);
		return json({ error: 'Failed to create cluster' }, { status: 500 });
	}
};
