/**
 * GET  /api/custom-resources/:clusterId/resources?group=&version=&plural=&namespace=
 * DELETE /api/custom-resources/:clusterId/resources?group=&version=&plural=&namespace=&name=
 *
 * Fetches instances of a specific Custom Resource and deletes individual instances.
 */

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { makeClusterRequest } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export interface CRDResource {
	name: string;
	namespace?: string;
	createdAt: string;
	uid: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	raw: Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCRDResource(item: any): CRDResource {
	return {
		name: item.metadata?.name ?? '',
		namespace: item.metadata?.namespace,
		createdAt: item.metadata?.creationTimestamp ?? '',
		uid: item.metadata?.uid ?? '',
		labels: item.metadata?.labels ?? {},
		annotations: item.metadata?.annotations ?? {},
		raw: item
	};
}

function buildApiPath(
	group: string,
	version: string,
	plural: string,
	namespace?: string | null
): string {
	const base = `/apis/${group}/${version}`;
	if (namespace && namespace !== 'all') {
		return `${base}/namespaces/${namespace}/${plural}`;
	}
	return `${base}/${plural}`;
}

interface K8sResourceListResponse {
	items?: unknown[];
}

export const GET: RequestHandler = async ({ params, url, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.clusterId);
	if (isNaN(clusterId)) throw error(400, 'Invalid cluster ID');

	const group = url.searchParams.get('group');
	const version = url.searchParams.get('version');
	const plural = url.searchParams.get('plural');
	const namespace = url.searchParams.get('namespace');

	if (!group || !version || !plural) {
		throw error(400, 'Missing required query params: group, version, plural');
	}

	const apiPath = buildApiPath(group, version, plural, namespace);

	const result = await makeClusterRequest<K8sResourceListResponse>(clusterId, apiPath, 15000);

	if (!result.success) {
		throw error(502, result.error ?? 'Failed to list resources');
	}

	const items: CRDResource[] = (result.data?.items ?? []).map(parseCRDResource);

	return json({ items });
};

export const DELETE: RequestHandler = async ({ params, url, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'delete')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.clusterId);
	if (isNaN(clusterId)) throw error(400, 'Invalid cluster ID');

	const group = url.searchParams.get('group');
	const version = url.searchParams.get('version');
	const plural = url.searchParams.get('plural');
	const namespace = url.searchParams.get('namespace');
	const name = url.searchParams.get('name');

	if (!group || !version || !plural || !name) {
		throw error(400, 'Missing required query params: group, version, plural, name');
	}

	let apiPath: string;
	if (namespace && namespace !== 'all') {
		apiPath = `/apis/${group}/${version}/namespaces/${namespace}/${plural}/${name}`;
	} else {
		apiPath = `/apis/${group}/${version}/${plural}/${name}`;
	}

	const result = await makeClusterRequest(clusterId, apiPath, 15000, { method: 'DELETE' });

	if (!result.success) {
		throw error(502, result.error ?? 'Failed to delete resource');
	}

	return json({ success: true });
};
