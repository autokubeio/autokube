import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProvisionedCluster } from '$lib/server/queries/provisioned-clusters';
import { db, eq, clusters } from '$lib/server/db';
import { decrypt } from '$lib/server/helpers/encryption';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const provCluster = await getProvisionedCluster(Number(params.id));
	if (!provCluster) return json({ error: 'Not found' }, { status: 404 });

	// Find the linked cluster row (has the kubeconfig)
	const [row] = await db
		.select({ kubeconfig: clusters.kubeconfig })
		.from(clusters)
		.where(eq(clusters.provisionedClusterId, provCluster.id))
		.limit(1);

	if (!row) return json({ error: 'No cluster record linked to this provisioned cluster' }, { status: 404 });

	const kubeconfig = decrypt(row.kubeconfig);
	if (!kubeconfig) {
		return json({ error: 'Kubeconfig not available yet — cluster may still be initializing' }, { status: 404 });
	}

	const filename = `${provCluster.clusterName}-kubeconfig.yaml`;
	return new Response(kubeconfig, {
		headers: {
			'Content-Type': 'application/yaml',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
};
