/**
 * Kubernetes Workload Resources
 * Jobs, CronJobs, DaemonSets, StatefulSets, ReplicaSets
 */

import type {
	JobInfo,
	CronJobInfo,
	DaemonSetInfo,
	StatefulSetInfo,
	ReplicaSetInfo,
	ListJobsResult,
	ListCronJobsResult,
	ListDaemonSetsResult,
	ListStatefulSetsResult,
	ListReplicaSetsResult
} from './types';
import { makeClusterRequest } from './utils';

// ── Type Definitions ────────────────────────────────────────────────────────

type K8sContainer = {
	name: string;
	image?: string;
	ports?: Array<{ containerPort?: number }>;
};

type K8sPodSpec = {
	containers?: K8sContainer[];
	nodeSelector?: Record<string, string>;
};

type K8sCondition = {
	type?: string;
	status?: string;
	lastTransitionTime?: string;
	reason?: string;
	message?: string;
};

type K8sJobList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			completions?: number;
			template?: {
				spec?: K8sPodSpec;
			};
		};
		status?: {
			active?: number;
			succeeded?: number;
			failed?: number;
			startTime?: string;
			completionTime?: string;
			conditions?: K8sCondition[];
		};
	}>;
};

type K8sCronJobList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			schedule?: string;
			suspend?: boolean;
			jobTemplate?: {
				spec?: {
					template?: {
						spec?: K8sPodSpec;
					};
				};
			};
		};
		status?: {
			active?: Array<{ name?: string }>;
			lastScheduleTime?: string;
		};
	}>;
};

type K8sDaemonSetList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			selector?: { matchLabels?: Record<string, string> };
			template?: {
				spec?: K8sPodSpec;
			};
		};
		status?: {
			desiredNumberScheduled?: number;
			currentNumberScheduled?: number;
			numberReady?: number;
			numberAvailable?: number;
			updatedNumberScheduled?: number;
			conditions?: K8sCondition[];
		};
	}>;
};

type K8sStatefulSetList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			replicas?: number;
			serviceName?: string;
			selector?: { matchLabels?: Record<string, string> };
			template?: {
				spec?: K8sPodSpec;
			};
		};
		status?: {
			replicas?: number;
			readyReplicas?: number;
			currentReplicas?: number;
			updatedReplicas?: number;
			conditions?: K8sCondition[];
		};
	}>;
};

type K8sReplicaSetList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			replicas?: number;
			selector?: { matchLabels?: Record<string, string> };
			template?: {
				spec?: K8sPodSpec;
			};
		};
		status?: {
			replicas?: number;
			readyReplicas?: number;
			conditions?: K8sCondition[];
		};
	}>;
};

// ── Helper Functions ────────────────────────────────────────────────────────

function extractContainers(podSpec?: K8sPodSpec) {
	if (!podSpec?.containers) return [];
	return podSpec.containers.map((c) => ({
		name: c.name,
		image: c.image || '',
		ports: (c.ports || []).map((p) => p.containerPort || 0)
	}));
}

function extractConditions(status?: { conditions?: K8sCondition[] }) {
	if (!status?.conditions) return [];
	return status.conditions.map((c) => ({
		type: c.type || '',
		status: c.status || '',
		lastTransitionTime: c.lastTransitionTime || '',
		reason: c.reason,
		message: c.message
	}));
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export async function listJobs(clusterId: number, namespace?: string): Promise<ListJobsResult> {
	const path = namespace ? `/apis/batch/v1/namespaces/${namespace}/jobs` : '/apis/batch/v1/jobs';

	const result = await makeClusterRequest<K8sJobList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch jobs',
			jobs: []
		};
	}

	const jobs: JobInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		// Get job status
		const active = status.active || 0;
		const succeeded = status.succeeded || 0;
		const failed = status.failed || 0;

		let jobStatus = 'Running';
		if (succeeded > 0 && active === 0) {
			jobStatus = 'Complete';
		} else if (failed > 0) {
			jobStatus = 'Failed';
		} else if (active > 0) {
			jobStatus = 'Running';
		}

		const containers = extractContainers(spec.template?.spec);

		// Completions string
		const completions = spec.completions ? `${succeeded}/${spec.completions}` : `${succeeded}`;

		// Calculate duration
		let duration = '';
		if (status.startTime) {
			const start = new Date(status.startTime).getTime();
			const end = status.completionTime ? new Date(status.completionTime).getTime() : Date.now();
			const diffSeconds = Math.floor((end - start) / 1000);
			if (diffSeconds < 60) {
				duration = `${diffSeconds}s`;
			} else if (diffSeconds < 3600) {
				duration = `${Math.floor(diffSeconds / 60)}m`;
			} else {
				duration = `${Math.floor(diffSeconds / 3600)}h`;
			}
		}

		return {
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			completions,
			duration,
			status: jobStatus,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			active,
			succeeded,
			failed,
			startTime: status.startTime || '',
			completionTime: status.completionTime,
			conditions: extractConditions(status),
			createdAt: item.metadata.creationTimestamp || new Date().toISOString(),
			containers
		};
	});

	return { success: true, jobs };
}

export async function deleteJob(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/batch/v1/namespaces/${namespace}/jobs/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete job ${name}`
		};
	}

	return { success: true };
}

export async function suspendJob(
	clusterId: number,
	jobName: string,
	namespace: string,
	suspend: boolean
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`;

	const result = await makeClusterRequest(clusterId, path, 15000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({ spec: { suspend } })
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to suspend job ${jobName}`
		};
	}

	return { success: true };
}

// ── CronJobs ────────────────────────────────────────────────────────────────

export async function listCronJobs(
	clusterId: number,
	namespace?: string
): Promise<ListCronJobsResult> {
	const path = namespace
		? `/apis/batch/v1/namespaces/${namespace}/cronjobs`
		: '/apis/batch/v1/cronjobs';

	const result = await makeClusterRequest<K8sCronJobList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch cron jobs',
			cronJobs: []
		};
	}

	const cronJobs: CronJobInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		const suspend = spec.suspend || false;
		const cronStatus = suspend ? 'Suspended' : 'Active';

		const containers = extractContainers(spec.jobTemplate?.spec?.template?.spec);

		return {
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			schedule: spec.schedule || 'Unknown',
			suspend,
			lastSchedule: status.lastScheduleTime || undefined,
			status: cronStatus,
			active: (status.active || []).length,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString(),
			containers
		};
	});

	return { success: true, cronJobs };
}

export async function deleteCronJob(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/batch/v1/namespaces/${namespace}/cronjobs/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete cron job ${name}`
		};
	}

	return { success: true };
}

export async function suspendCronJob(
	clusterId: number,
	cronJobName: string,
	namespace: string,
	suspend: boolean
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/batch/v1/namespaces/${namespace}/cronjobs/${cronJobName}`;

	const result = await makeClusterRequest(clusterId, path, 15000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({ spec: { suspend } })
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to suspend cron job ${cronJobName}`
		};
	}

	return { success: true };
}

export async function triggerCronJob(
	clusterId: number,
	cronJobName: string,
	namespace: string
): Promise<{ success: boolean; error?: string; jobName?: string }> {
	const timestamp = Date.now();
	const jobName = `${cronJobName}-manual-${timestamp}`;

	// Get the CronJob to extract job template
	const cronJobPath = `/apis/batch/v1/namespaces/${namespace}/cronjobs/${cronJobName}`;
	const cronJobResult = await makeClusterRequest<{
		spec?: { jobTemplate?: { spec?: Record<string, unknown> } };
	}>(clusterId, cronJobPath, 15000);

	if (!cronJobResult.success || !cronJobResult.data) {
		return {
			success: false,
			error: cronJobResult.error ?? 'Failed to fetch CronJob'
		};
	}

	const jobSpec = cronJobResult.data.spec?.jobTemplate?.spec;
	if (!jobSpec) {
		return {
			success: false,
			error: 'CronJob template not found'
		};
	}

	// Create manual job
	const jobManifest = {
		apiVersion: 'batch/v1',
		kind: 'Job',
		metadata: {
			name: jobName,
			namespace,
			labels: {
				cronjob: cronJobName,
				'triggered-by': 'manual'
			}
		},
		spec: jobSpec
	};

	const createPath = `/apis/batch/v1/namespaces/${namespace}/jobs`;
	const createResult = await makeClusterRequest(clusterId, createPath, 15000, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(jobManifest)
	});

	if (!createResult.success) {
		return {
			success: false,
			error: createResult.error ?? 'Failed to create job'
		};
	}

	return { success: true, jobName };
}

// ── DaemonSets ──────────────────────────────────────────────────────────────

export async function listDaemonSets(
	clusterId: number,
	namespace?: string
): Promise<ListDaemonSetsResult> {
	const path = namespace
		? `/apis/apps/v1/namespaces/${namespace}/daemonsets`
		: '/apis/apps/v1/daemonsets';

	const result = await makeClusterRequest<K8sDaemonSetList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch daemon sets',
			daemonSets: []
		};
	}

	const daemonSets: DaemonSetInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		const desiredNumberScheduled = status.desiredNumberScheduled || 0;
		const currentNumberScheduled = status.currentNumberScheduled || 0;
		const numberReady = status.numberReady || 0;
		const numberAvailable = status.numberAvailable || 0;

		let dsStatus = 'Running';
		if (numberReady === desiredNumberScheduled && desiredNumberScheduled > 0) {
			dsStatus = 'Ready';
		} else if (numberReady === 0) {
			dsStatus = 'NotReady';
		}

		const containers = extractContainers(spec.template?.spec);

		return {
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			desired: desiredNumberScheduled,
			current: currentNumberScheduled,
			ready: numberReady,
			upToDate: status.updatedNumberScheduled || 0,
			available: numberAvailable,
			status: dsStatus,
			nodeSelector: spec.template?.spec?.nodeSelector || {},
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			selector: spec.selector?.matchLabels || {},
			conditions: extractConditions(status),
			createdAt: item.metadata.creationTimestamp || new Date().toISOString(),
			containers
		};
	});

	return { success: true, daemonSets };
}

export async function deleteDaemonSet(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete daemon set ${name}`
		};
	}

	return { success: true };
}

export async function restartDaemonSet(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/daemonsets/${name}`;
	const restartedAt = new Date().toISOString();

	const result = await makeClusterRequest(clusterId, path, 30000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({
			spec: {
				template: {
					metadata: {
						annotations: {
							'kubectl.kubernetes.io/restartedAt': restartedAt
						}
					}
				}
			}
		})
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to restart daemon set ${name}`
		};
	}

	return { success: true };
}

// ── StatefulSets ────────────────────────────────────────────────────────────

export async function listStatefulSets(
	clusterId: number,
	namespace?: string
): Promise<ListStatefulSetsResult> {
	const path = namespace
		? `/apis/apps/v1/namespaces/${namespace}/statefulsets`
		: '/apis/apps/v1/statefulsets';

	const result = await makeClusterRequest<K8sStatefulSetList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch stateful sets',
			statefulSets: []
		};
	}

	const statefulSets: StatefulSetInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		const replicas = spec.replicas || 0;
		const readyReplicas = status.readyReplicas || 0;
		const currentReplicas = status.currentReplicas || 0;

		let stsStatus = 'Running';
		if (readyReplicas === replicas && replicas > 0) {
			stsStatus = 'Ready';
		} else if (readyReplicas === 0) {
			stsStatus = 'NotReady';
		}

		const containers = extractContainers(spec.template?.spec);

		return {
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			ready: `${readyReplicas}/${replicas}`,
			replicas,
			readyReplicas,
			currentReplicas,
			updatedReplicas: status.updatedReplicas || 0,
			status: stsStatus,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			selector: spec.selector?.matchLabels || {},
			serviceName: spec.serviceName || '',
			conditions: extractConditions(status),
			createdAt: item.metadata.creationTimestamp || new Date().toISOString(),
			containers
		};
	});

	return { success: true, statefulSets };
}

export async function deleteStatefulSet(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete stateful set ${name}`
		};
	}

	return { success: true };
}

export async function scaleStatefulSet(
	clusterId: number,
	name: string,
	namespace: string,
	replicas: number
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`;

	const result = await makeClusterRequest(clusterId, path, 30000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({ spec: { replicas } })
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to scale stateful set ${name}`
		};
	}

	return { success: true };
}

export async function restartStatefulSet(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/statefulsets/${name}`;
	const restartedAt = new Date().toISOString();

	const result = await makeClusterRequest(clusterId, path, 30000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({
			spec: {
				template: {
					metadata: {
						annotations: {
							'kubectl.kubernetes.io/restartedAt': restartedAt
						}
					}
				}
			}
		})
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to restart stateful set ${name}`
		};
	}

	return { success: true };
}

// ── ReplicaSets ─────────────────────────────────────────────────────────────

export async function listReplicaSets(
	clusterId: number,
	namespace?: string
): Promise<ListReplicaSetsResult> {
	const path = namespace
		? `/apis/apps/v1/namespaces/${namespace}/replicasets`
		: '/apis/apps/v1/replicasets';

	const result = await makeClusterRequest<K8sReplicaSetList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch replica sets',
			replicaSets: []
		};
	}

	const replicaSets: ReplicaSetInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		const desired = spec.replicas || 0;
		const current = status.replicas || 0;
		const ready = status.readyReplicas || 0;

		let rsStatus = 'Running';
		if (ready === desired && desired > 0) {
			rsStatus = 'Ready';
		} else if (ready === 0 && desired > 0) {
			rsStatus = 'NotReady';
		}

		const containers = extractContainers(spec.template?.spec);

		return {
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			desired,
			current,
			ready,
			status: rsStatus,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			selector: spec.selector?.matchLabels || {},
			conditions: extractConditions(status),
			createdAt: item.metadata.creationTimestamp || new Date().toISOString(),
			containers
		};
	});

	return { success: true, replicaSets };
}

export async function deleteReplicaSet(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/replicasets/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete replica set ${name}`
		};
	}

	return { success: true };
}

export async function scaleReplicaSet(
	clusterId: number,
	name: string,
	namespace: string,
	replicas: number
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/replicasets/${name}`;

	const result = await makeClusterRequest(clusterId, path, 30000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({ spec: { replicas } })
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to scale replica set ${name}`
		};
	}

	return { success: true };
}

export async function restartReplicaSet(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/apps/v1/namespaces/${namespace}/replicasets/${name}`;
	const restartedAt = new Date().toISOString();

	const result = await makeClusterRequest(clusterId, path, 30000, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/merge-patch+json' },
		body: JSON.stringify({
			spec: {
				template: {
					metadata: {
						annotations: {
							'kubectl.kubernetes.io/restartedAt': restartedAt
						}
					}
				}
			}
		})
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to restart replica set ${name}`
		};
	}

	return { success: true };
}
