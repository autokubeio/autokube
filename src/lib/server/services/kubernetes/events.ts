/**
 * Kubernetes Events
 * Event resources for cluster monitoring
 */

import type { ListEventsResult } from './types';
import { makeClusterRequest } from './utils';

// ── Events ──────────────────────────────────────────────────────────────────

type K8sEventList = {
	items: Array<{
		metadata: {
			name?: string;
			namespace?: string;
			creationTimestamp: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		type?: string;
		reason?: string;
		message?: string;
		source?: {
			component?: string;
		};
		count?: number;
		firstTimestamp?: string;
		lastTimestamp?: string;
		involvedObject?: {
			kind?: string;
			name?: string;
			namespace?: string;
		};
	}>;
};

export async function listEvents(clusterId: number, namespace?: string): Promise<ListEventsResult> {
	const eventsPath =
		namespace === 'all' || !namespace ? '/api/v1/events' : `/api/v1/namespaces/${namespace}/events`;

	const result = await makeClusterRequest<K8sEventList>(clusterId, eventsPath, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch events'
		};
	}

	const events = result.data.items.map((item) => {
		const metadata = item.metadata || {};
		const involvedObject = item.involvedObject || {};

		return {
			name: metadata.name || 'unknown',
			namespace: metadata.namespace || 'default',
			type: item.type || 'Normal',
			reason: item.reason || 'Unknown',
			message: item.message || '',
			source: item.source?.component || 'unknown',
			count: item.count || 1,
			firstSeen: item.firstTimestamp || metadata.creationTimestamp || '',
			lastSeen: item.lastTimestamp || metadata.creationTimestamp || '',
			involvedObject: {
				kind: involvedObject.kind || 'Unknown',
				name: involvedObject.name || 'unknown',
				namespace: involvedObject.namespace || 'default'
			},
			labels: metadata.labels || {},
			annotations: metadata.annotations || {},
			createdAt: metadata.creationTimestamp || ''
		};
	});

	return { success: true, events };
}

export async function deleteEvent(
	clusterId: number,
	name: string,
	namespace: string = 'default'
): Promise<{ success: boolean; error?: string }> {
	const deletePath = `/api/v1/namespaces/${namespace}/events/${name}`;

	const result = await makeClusterRequest(clusterId, deletePath, 30000, {
		method: 'DELETE'
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete event ${name}`
		};
	}

	return { success: true };
}
