/**
 * GET /api/custom-resources/:clusterId
 * Lists all CustomResourceDefinitions (CRDs) available in a cluster
 */

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { makeClusterRequest } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

export interface AdditionalPrinterColumn {
	name: string;
	jsonPath: string;
	type: string;
	description?: string;
	priority?: number;
}

export interface CRDInfo {
	name: string; // e.g. certificates.cert-manager.io
	group: string; // e.g. cert-manager.io
	version: string; // e.g. v1 (first served/storage version)
	versions: string[]; // all served versions
	plural: string; // e.g. certificates
	singular: string; // e.g. certificate
	kind: string; // e.g. Certificate
	scope: 'Namespaced' | 'Cluster';
	additionalPrinterColumns: AdditionalPrinterColumn[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCRD(crd: any): CRDInfo {
	const spec = crd.spec ?? {};
	const names = spec.names ?? {};
	const versions: string[] = (spec.versions ?? [])
		.filter((v: { served?: boolean }) => v.served !== false)
		.map((v: { name: string }) => v.name);

	// Pick storage/primary version first, then first served
	const storageVersion =
		(spec.versions ?? []).find((v: { storage?: boolean }) => v.storage)?.name ?? versions[0] ?? 'v1';

	// additionalPrinterColumns can be at top-level (CRD v1beta1) or per-version
	let additionalPrinterColumns: AdditionalPrinterColumn[] = spec.additionalPrinterColumns ?? [];
	if (!additionalPrinterColumns.length) {
		const versionDef = (spec.versions ?? []).find(
			(v: { name: string }) => v.name === storageVersion
		);
		additionalPrinterColumns = versionDef?.additionalPrinterColumns ?? [];
	}

	return {
		name: crd.metadata?.name ?? '',
		group: spec.group ?? '',
		version: storageVersion,
		versions,
		plural: names.plural ?? '',
		singular: names.singular ?? '',
		kind: names.kind ?? '',
		scope: spec.scope ?? 'Namespaced',
		additionalPrinterColumns: (additionalPrinterColumns as AdditionalPrinterColumn[]).filter(
			(c) => (c.priority ?? 0) === 0 // only show standard (non-wide) columns by default
		)
	};
}

interface K8sCRDListResponse {
	items?: unknown[];
}

export const GET: RequestHandler = async ({ params, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	const clusterId = parseInt(params.clusterId);
	if (isNaN(clusterId)) throw error(400, 'Invalid cluster ID');

	const result = await makeClusterRequest<K8sCRDListResponse>(
		clusterId,
		'/apis/apiextensions.k8s.io/v1/customresourcedefinitions',
		15000
	);

	if (!result.success) {
		throw error(502, result.error ?? 'Failed to list CRDs');
	}

	const crds: CRDInfo[] = (result.data?.items ?? []).map(parseCRD);
	crds.sort((a, b) => a.name.localeCompare(b.name));

	return json({ crds });
};
