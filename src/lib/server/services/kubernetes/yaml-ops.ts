/**
 * Kubernetes YAML Operations
 * Get and update resource YAML manifests
 */

import { makeClusterRequest } from './utils';
import * as yaml from 'js-yaml';

// ── Pod YAML Operations ─────────────────────────────────────────────────────

export async function getPodYaml(
	clusterId: number,
	podName: string,
	namespace: string
): Promise<{ success: boolean; yaml?: string; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/pods/${podName}`;
	const result = await makeClusterRequest<unknown>(clusterId, path, 15000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch pod YAML'
		};
	}

	const pod = result.data as Record<string, unknown>;

	// Remove managed fields for cleaner YAML
	if (pod.metadata && typeof pod.metadata === 'object') {
		const metadata = pod.metadata as Record<string, unknown>;
		if (metadata.managedFields) {
			delete metadata.managedFields;
		}
	}

	const yamlContent = yaml.dump(pod, { indent: 2, lineWidth: -1 });
	return { success: true, yaml: yamlContent };
}

export async function updatePodYaml(
	clusterId: number,
	podName: string,
	namespace: string,
	yamlContent: string
): Promise<{ success: boolean; error?: string }> {
	let manifest: unknown;
	try {
		manifest = yaml.load(yamlContent);
	} catch (err) {
		return {
			success: false,
			error: `Invalid YAML: ${err instanceof Error ? err.message : 'Parse error'}`
		};
	}

	if (!manifest || typeof manifest !== 'object') {
		return {
			success: false,
			error: 'Invalid YAML: manifest is not an object'
		};
	}

	const path = `/api/v1/namespaces/${namespace}/pods/${podName}`;

	const result = await makeClusterRequest(clusterId, path, 15000, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(manifest)
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? 'Failed to update pod YAML'
		};
	}

	return { success: true };
}

// ── Generic Resource YAML Operations ────────────────────────────────────────

export async function getResourceYaml(
	clusterId: number,
	apiPath: string
): Promise<{ success: boolean; yaml?: string; error?: string }> {
	const result = await makeClusterRequest<unknown>(clusterId, apiPath, 15000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch resource YAML'
		};
	}

	const resource = result.data as Record<string, unknown>;

	// Remove managed fields for cleaner YAML
	if (resource.metadata && typeof resource.metadata === 'object') {
		const metadata = resource.metadata as Record<string, unknown>;
		if (metadata.managedFields) {
			delete metadata.managedFields;
		}
	}

	const yamlContent = yaml.dump(resource, { indent: 2, lineWidth: -1 });
	return { success: true, yaml: yamlContent };
}

type Metadata = { labels?: Record<string, string>; annotations?: Record<string, string> };
type Manifest = { metadata?: Metadata } & Record<string, unknown>;

/** Compare sent labels/annotations vs what Kubernetes returned, to detect silently reverted fields */
function detectRevertedFields(sent: Manifest, returned: Manifest): string[] {
	const reverted: string[] = [];

	const sentLabels = sent.metadata?.labels ?? {};
	const returnedLabels = returned.metadata?.labels ?? {};
	for (const [key, value] of Object.entries(sentLabels)) {
		if (returnedLabels[key] !== value) {
			reverted.push(`label "${key}"`);
		}
	}

	const sentAnnotations = sent.metadata?.annotations ?? {};
	const returnedAnnotations = returned.metadata?.annotations ?? {};
	for (const [key, value] of Object.entries(sentAnnotations)) {
		if (returnedAnnotations[key] !== value) {
			reverted.push(`annotation "${key}"`);
		}
	}

	return reverted;
}

export async function updateResourceYaml(
	clusterId: number,
	apiPath: string,
	yamlContent: string
): Promise<{ success: boolean; warning?: string; error?: string }> {
	let manifest: unknown;
	try {
		// Use JSON_SCHEMA to prevent js-yaml from converting dates/booleans to JS types
		manifest = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
	} catch (err) {
		return {
			success: false,
			error: `Invalid YAML: ${err instanceof Error ? err.message : 'Parse error'}`
		};
	}

	if (!manifest || typeof manifest !== 'object') {
		return {
			success: false,
			error: 'Invalid YAML: manifest is not an object'
		};
	}

	const sentManifest = manifest as Manifest;

	// Validate that metadata.name matches the resource name in the URL.
	// Kubernetes doesn't allow renaming resources via PUT.
	const manifestName = (sentManifest as Record<string, unknown> & { metadata?: { name?: string } }).metadata?.name;
	const urlResourceName = apiPath.split('/').pop();
	if (manifestName && urlResourceName && manifestName !== urlResourceName) {
		return {
			success: false,
			error: `Cannot rename a resource. The name in the manifest ("${manifestName}") does not match the existing resource name ("${urlResourceName}"). To rename, delete and recreate the resource.`
		};
	}

	const body = JSON.stringify(sentManifest);
	console.log(`[K8s YAML] PUT ${apiPath} - body length: ${body.length}`);

	const result = await makeClusterRequest<Manifest>(clusterId, apiPath, 15000, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(body).toString()
		},
		body
	});

	if (!result.success) {
		console.error(`[K8s YAML] PUT ${apiPath} failed:`, result.error);
		return {
			success: false,
			error: result.error ?? 'Failed to update resource YAML'
		};
	}

	// Check if Kubernetes silently reverted any fields
	const returnedManifest = result.data as Manifest;
	const reverted = detectRevertedFields(sentManifest, returnedManifest);
	if (reverted.length > 0) {
		const fieldList = reverted.join(', ');
		console.warn(`[K8s YAML] PUT ${apiPath} - reverted fields: ${fieldList}`);
		return {
			success: true,
			warning: `Changes to ${fieldList} were reverted by Kubernetes (read-only or managed fields)`
		};
	}

	console.log(`[K8s YAML] PUT ${apiPath} succeeded`);
	return { success: true };
}
