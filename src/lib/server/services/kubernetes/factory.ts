/**
 * Kubernetes Operations Factory
 * Generic helpers to reduce code duplication
 */

import type { KubeconfigData } from './utils';
import { k8sRequest, DEFAULT_TIMEOUT, withKubeconfig } from './utils';

// ── Generic List Operation ──────────────────────────────────────────────────

export interface K8sListItem {
	metadata?: {
		name?: string;
		namespace?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		creationTimestamp?: string;
		uid?: string;
	};
	[key: string]: unknown;
}

export interface K8sListResponse<T = K8sListItem> {
	items?: T[];
	[key: string]: unknown;
}

/**
 * Generic list function factory
 * Reduces boilerplate for list operations
 */
export function createListOperation<TItem, TResult extends { success: boolean; error?: string }>(
	apiPath: (namespace?: string) => string,
	transformer: (items: K8sListItem[]) => TItem[],
	resultWrapper: (items: TItem[]) => Omit<TResult, 'success' | 'error'>
) {
	return async (
		kubeconfigContent: string,
		contextName?: string,
		namespace?: string
	): Promise<TResult> => {
		const result = await withKubeconfig(
			kubeconfigContent,
			contextName,
			async (config: KubeconfigData) => {
				const path = apiPath(namespace);
				const response = await k8sRequest<K8sListResponse>(config, path, DEFAULT_TIMEOUT);

				if (!response.items) {
					throw new Error('No items in response');
				}

				const transformed = transformer(response.items);
				return resultWrapper(transformed);
			}
		);

		if (!result.success) {
			return { success: false, error: result.error } as TResult;
		}

		return { success: true, ...result.data } as TResult;
	};
}

// ── Generic Delete Operation ────────────────────────────────────────────────

export function createDeleteOperation(apiPath: (name: string, namespace?: string) => string) {
	return async (
		kubeconfigContent: string,
		name: string,
		namespace?: string,
		contextName?: string
	): Promise<{ success: boolean; error?: string }> => {
		return withKubeconfig(kubeconfigContent, contextName, async (config: KubeconfigData) => {
			const path = apiPath(name, namespace);
			await k8sRequest(config, path, DEFAULT_TIMEOUT, { method: 'DELETE' });
			return true;
		});
	};
}

// ── Generic Scale Operation ─────────────────────────────────────────────────

export function createScaleOperation(
	apiPath: (name: string, namespace: string) => string,
	scaleSubPath = '/scale'
) {
	return async (
		kubeconfigContent: string,
		name: string,
		namespace: string,
		replicas: number,
		contextName?: string
	): Promise<{ success: boolean; error?: string }> => {
		return withKubeconfig(kubeconfigContent, contextName, async (config: KubeconfigData) => {
			const path = `${apiPath(name, namespace)}${scaleSubPath}`;
			const body = JSON.stringify({
				spec: {
					replicas
				}
			});
			await k8sRequest(config, path, DEFAULT_TIMEOUT, {
				method: 'PATCH',
				body
			});
			return true;
		});
	};
}

// ── Generic Restart Operation ───────────────────────────────────────────────

export function createRestartOperation(apiPath: (name: string, namespace: string) => string) {
	return async (
		kubeconfigContent: string,
		name: string,
		namespace: string,
		contextName?: string
	): Promise<{ success: boolean; error?: string }> => {
		return withKubeconfig(kubeconfigContent, contextName, async (config: KubeconfigData) => {
			const path = apiPath(name, namespace);
			const now = new Date().toISOString();
			const body = JSON.stringify({
				spec: {
					template: {
						metadata: {
							annotations: {
								'kubectl.kubernetes.io/restartedAt': now
							}
						}
					}
				}
			});
			await k8sRequest(config, path, DEFAULT_TIMEOUT, {
				method: 'PATCH',
				body
			});
			return true;
		});
	};
}

// ── Common Transformers ─────────────────────────────────────────────────────

export function extractBaseMetadata(item: K8sListItem) {
	const metadata = item.metadata || {};
	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || '',
		id: metadata.uid || ''
	};
}

export function extractContainers(
	spec: { containers?: Array<{ name?: string; image?: string }> } = {}
) {
	return (spec.containers || []).map((c) => ({
		name: c.name || 'unknown',
		image: c.image || 'unknown'
	}));
}

export function extractConditions(
	status: {
		conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
	} = {}
) {
	return (status.conditions || []).map((c) => ({
		type: c.type || 'Unknown',
		status: c.status || 'Unknown',
		reason: c.reason,
		message: c.message
	}));
}
