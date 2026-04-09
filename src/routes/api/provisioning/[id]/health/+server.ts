import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProvisionedCluster } from '$lib/server/queries/provisioned-clusters';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const cluster = await getProvisionedCluster(Number(params.id));
	if (!cluster) return json({ error: 'Not found' }, { status: 404 });

	if (!cluster.apiServerHostname) {
		return json({ healthy: false, message: 'No API server hostname configured yet' });
	}

	const url = `https://${cluster.apiServerHostname}:6443/healthz`;
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(8_000),
			// @ts-expect-error Bun-specific TLS option
			tls: { rejectUnauthorized: false }
		});
		const body = await res.text();
		// 401 means the API server is up and responding (just requires auth) — treat as healthy
		if (res.ok && body.trim() === 'ok') {
			return json({ healthy: true, message: 'API server is healthy' });
		}
		if (res.status === 401) {
			return json({ healthy: true, message: 'API server is reachable (auth required)' });
		}
		return json({ healthy: false, message: `API server responded with status ${res.status}` });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return json({ healthy: false, message: `Cannot reach API server: ${msg}` });
	}
};
