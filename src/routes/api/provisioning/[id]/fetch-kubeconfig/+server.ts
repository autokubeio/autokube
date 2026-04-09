import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProvisionedCluster } from '$lib/server/queries/provisioned-clusters';
import { findSshKey } from '$lib/server/queries/ssh-keys';
import { authorize } from '$lib/server/services/authorize';
import { db, eq, clusters } from '$lib/server/db';
import { patchCluster } from '$lib/server/queries/clusters';
import { updateProvisionedClusterStatus } from '$lib/server/queries/provisioned-clusters';
import { fetchKubeconfig } from '$lib/server/provisioning/engine/kubeconfig';

export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'write'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const provCluster = await getProvisionedCluster(Number(params.id));
	if (!provCluster) return json({ error: 'Not found' }, { status: 404 });

	if (!provCluster.apiServerHostname) {
		return json({ error: 'No API server hostname — re-provision the cluster first' }, { status: 400 });
	}

	// Find linked cluster row
	const [clusterRow] = await db
		.select({ id: clusters.id })
		.from(clusters)
		.where(eq(clusters.provisionedClusterId, provCluster.id))
		.limit(1);

	if (!clusterRow) {
		return json({ error: 'No cluster record linked to this provisioned cluster' }, { status: 404 });
	}

	// Resolve SSH key from mastersPoolConfig
	let sshPrivateKey = '';
	const masterIp = provCluster.apiServerHostname;
	try {
		const mastersPool = provCluster.mastersPoolConfig ? JSON.parse(provCluster.mastersPoolConfig) : {};
		const sshKeyId: number | undefined = mastersPool.sshKeyId;
		if (!sshKeyId) {
			return json({ error: 'No SSH key configured on this cluster' }, { status: 400 });
		}
		const sshKey = await findSshKey(sshKeyId);
		if (!sshKey?.privateKey) {
			return json({ error: 'SSH private key not found' }, { status: 400 });
		}
		sshPrivateKey = sshKey.privateKey;
	} catch {
		return json({ error: 'Failed to resolve SSH key' }, { status: 500 });
	}

	// Fetch kubeconfig in the background and return immediately
	(async () => {
		try {
			const kubeconfig = await fetchKubeconfig({
				masterIp,
				apiEndpoint: provCluster.apiServerHostname!,
				sshPrivateKey,
				timeoutSecs: 120
			});
			await patchCluster(clusterRow.id, { kubeconfig });
			await updateProvisionedClusterStatus(
				provCluster.id,
				'running',
				`Cluster fully connected. API: https://${provCluster.apiServerHostname}:6443`
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[provisioning] Manual kubeconfig fetch failed for cluster ${provCluster.id}: ${msg}`);
		}
	})();

	return json({ message: 'Kubeconfig fetch started — refresh in a moment' });
};
