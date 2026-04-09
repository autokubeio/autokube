import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProvisionedCluster, updateProvisionedClusterStatus } from '$lib/server/queries/provisioned-clusters';
import { insertCluster, patchCluster } from '$lib/server/queries/clusters';
import { findSshKey } from '$lib/server/queries/ssh-keys';
import { db, eq, clusters } from '$lib/server/db';
import { authorize } from '$lib/server/services/authorize';
import { logAuditEvent } from '$lib/server/queries/audit';
import { fetchKubeconfig } from '$lib/server/provisioning/engine/kubeconfig';

export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'create'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const provCluster = await getProvisionedCluster(Number(params.id));
	if (!provCluster) return json({ error: 'Not found' }, { status: 404 });

	// Check if a linked cluster row already exists
	const [existing] = await db
		.select({ id: clusters.id })
		.from(clusters)
		.where(eq(clusters.provisionedClusterId, provCluster.id))
		.limit(1);

	if (existing) {
		return json({ error: 'Cluster is already in the clusters list' }, { status: 409 });
	}

	const apiServer = provCluster.apiServerHostname
		? `https://${provCluster.apiServerHostname}:6443`
		: null;

	// Try to resolve SSH key so we can fetch the kubeconfig immediately
	let sshPrivateKey: string | null = null;
	try {
		const mastersPool = provCluster.mastersPoolConfig ? JSON.parse(provCluster.mastersPoolConfig) : {};
		const sshKeyId: number | undefined = mastersPool.sshKeyId;
		if (sshKeyId) {
			const sshKey = await findSshKey(sshKeyId);
			if (sshKey?.privateKey) sshPrivateKey = sshKey.privateKey;
		}
	} catch {
		// Non-fatal — proceed without kubeconfig
	}

	// Create the cluster row
	const cluster = await insertCluster({
		name: provCluster.clusterName,
		icon: 'cloud',
		labels: undefined,
		apiServer,
		authType: 'kubeconfig',
		kubeconfig: null,
		context: null,
		namespace: 'default',
		bearerToken: null,
		tlsCa: null,
		tlsSkipVerify: false,
		isProvisioned: true,
		provisionedClusterId: provCluster.id,
		agentUrl: null,
		agentToken: null,
		metricsEnabled: true,
		cpuWarnThreshold: 60,
		cpuCritThreshold: 80,
		memWarnThreshold: 60,
		memCritThreshold: 80,
		scanEnabled: false,
		scannerPreference: 'both'
	});

	await logAuditEvent({
		username: auth.user?.username ?? 'system',
		action: 'create',
		entityType: 'cluster',
		entityId: String(cluster.id),
		entityName: cluster.name,
		ipAddress: null,
		userAgent: null
	});

	// If we have SSH key + API hostname, fetch kubeconfig in background
	if (sshPrivateKey && provCluster.apiServerHostname) {
		const clusterId = cluster.id;
		const provId = provCluster.id;
		const masterIp = provCluster.apiServerHostname;

		(async () => {
			try {
				const kubeconfig = await fetchKubeconfig({
					masterIp,
					apiEndpoint: masterIp,
					sshPrivateKey: sshPrivateKey!,
					timeoutSecs: 120
				});
				await patchCluster(clusterId, { kubeconfig });
				await updateProvisionedClusterStatus(
					provId,
					'running',
					`Cluster fully connected. API: https://${masterIp}:6443`
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[provisioning] Relink kubeconfig fetch failed for cluster ${provId}: ${msg}`);
			}
		})();

		return json({ cluster: { id: cluster.id, name: cluster.name }, fetchingKubeconfig: true }, { status: 201 });
	}

	return json({ cluster: { id: cluster.id, name: cluster.name }, fetchingKubeconfig: false }, { status: 201 });
};
