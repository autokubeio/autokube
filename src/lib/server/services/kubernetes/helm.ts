/**
 * Helm Release Operations
 *
 * Helm 3 stores release metadata as Kubernetes Secrets with:
 *   - label  owner=helm
 *   - label  name=<release-name>
 *   - label  status=deployed|failed|pending-install|superseded|uninstalling
 *   - label  version=<revision-number>
 *   - type   helm.sh/release.v1
 *
 * We list all such secrets, group by (namespace + name), and keep the
 * highest-revision entry as the "current" release.
 */

import { makeClusterRequest } from './utils';

// ── Types ───────────────────────────────────────────────────────────────────

export type HelmRelease = {
	name: string;
	namespace: string;
	chart: string;
	chartVersion: string;
	appVersion: string;
	status: string;
	revision: number;
	updatedAt: string;
	createdAt: string;
	description: string;
};

export type ListHelmReleasesResult =
	| { success: true; releases: HelmRelease[] }
	| { success: false; error: string };

// ── Internal K8s Secret type ─────────────────────────────────────────────────

interface HelmSecret {
	metadata: {
		name?: string;
		namespace?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		creationTimestamp?: string;
	};
	type?: string;
}

interface K8sSecretList {
	items: HelmSecret[];
}

// ── List Helm Releases ───────────────────────────────────────────────────────

export async function listHelmReleases(
	clusterId: number,
	namespace?: string
): Promise<ListHelmReleasesResult> {
	const path = namespace
		? `/api/v1/namespaces/${namespace}/secrets?labelSelector=owner%3Dhelm`
		: `/api/v1/secrets?labelSelector=owner%3Dhelm`;

	const result = await makeClusterRequest<K8sSecretList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch Helm releases'
		};
	}

	const secrets = result.data.items ?? [];

	// Group by namespace+releaseName, keep highest revision
	const releaseMap = new Map<string, HelmSecret>();

	for (const secret of secrets) {
		const labels = secret.metadata?.labels ?? {};
		const relName = labels['name'];
		const ns = secret.metadata?.namespace ?? '';
		// Skip if not actually a helm release secret
		if (!relName) continue;

		const key = `${ns}/${relName}`;
		const existing = releaseMap.get(key);
		const currentRevision = parseInt(labels['version'] ?? '0', 10);
		const existingRevision = parseInt(
			existing?.metadata?.labels?.['version'] ?? '-1',
			10
		);

		if (!existing || currentRevision > existingRevision) {
			releaseMap.set(key, secret);
		}
	}

	const releases: HelmRelease[] = Array.from(releaseMap.values()).map((secret) => {
		const labels = secret.metadata?.labels ?? {};
		const annotations = secret.metadata?.annotations ?? {};

		// Chart info is stored in label "helm.sh/chart" (e.g. "nginx-1.0.0")
		// or annotation, or we derive from the secret name pattern
		const helmChart = labels['helm.sh/chart'] ?? '';
		// chart format: "<name>-<version>"
		const lastDash = helmChart.lastIndexOf('-');
		const chart = lastDash > 0 ? helmChart.slice(0, lastDash) : (helmChart || (labels['name'] ?? ''));
		const chartVersion = lastDash > 0 ? helmChart.slice(lastDash + 1) : '';
		const appVersion = annotations['app.kubernetes.io/version'] ?? labels['app.kubernetes.io/version'] ?? '';

		const relStatus = labels['status'] ?? 'unknown';
		const revision = parseInt(labels['version'] ?? '1', 10);

		// Helm also stores the last deployed timestamp in an annotation
		const updatedAt =
			annotations['meta.helm.sh/updated-at'] ??
			annotations['helm.sh/updated-at'] ??
			secret.metadata?.creationTimestamp ??
			'';

		return {
			name: labels['name'] ?? secret.metadata?.name ?? '',
			namespace: secret.metadata?.namespace ?? '',
			chart,
			chartVersion,
			appVersion,
			status: relStatus,
			revision,
			updatedAt,
			createdAt: secret.metadata?.creationTimestamp ?? '',
			description: annotations['meta.helm.sh/release-description'] ?? ''
		};
	});

	// Sort by namespace then name
	releases.sort((a, b) =>
		a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
	);

	return { success: true, releases };
}

// ── Uninstall (delete all revision secrets) ──────────────────────────────────

export async function deleteHelmRelease(
	clusterId: number,
	releaseName: string,
	namespace: string
): Promise<{ success: boolean; error?: string }> {
	// List all secrets for this release (all revisions)
	const listPath = `/api/v1/namespaces/${namespace}/secrets?labelSelector=owner%3Dhelm%2Cname%3D${encodeURIComponent(releaseName)}`;
	const listResult = await makeClusterRequest<K8sSecretList>(clusterId, listPath, 15000);

	if (!listResult.success || !listResult.data) {
		return { success: false, error: listResult.error ?? 'Failed to list release secrets' };
	}

	const secretNames = (listResult.data.items ?? [])
		.map((s) => s.metadata?.name)
		.filter(Boolean) as string[];

	if (secretNames.length === 0) {
		return { success: false, error: `No Helm release "${releaseName}" found in namespace "${namespace}"` };
	}

	// Delete each secret
	for (const secretName of secretNames) {
		const delPath = `/api/v1/namespaces/${namespace}/secrets/${secretName}`;
		const delResult = await makeClusterRequest(clusterId, delPath, 15000, { method: 'DELETE' });
		if (!delResult.success) {
			return { success: false, error: delResult.error ?? `Failed to delete secret ${secretName}` };
		}
	}

	return { success: true };
}
