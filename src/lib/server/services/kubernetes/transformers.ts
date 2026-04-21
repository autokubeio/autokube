/**
 * Kubernetes Event Transformers
 * Transforms raw Kubernetes API objects to application models
 */

import type { PodInfo, PodMetrics } from './types';

// Raw Kubernetes Pod types (simplified for transformation)
interface K8sContainerStatus {
	name?: string;
	ready?: boolean;
	restartCount?: number;
	state?: {
		running?: unknown;
		waiting?: { reason?: string };
		terminated?: unknown;
	};
}

interface K8sContainer {
	name?: string;
	image?: string;
}

interface K8sCondition {
	type?: string;
	status?: string;
	reason?: string;
	message?: string;
}

interface K8sPodObject {
	metadata?: {
		name?: string;
		namespace?: string;
		uid?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		ownerReferences?: Array<{ kind?: string; name?: string; uid?: string }>;
	};
	spec?: {
		nodeName?: string;
		containers?: K8sContainer[];
	};
	status?: {
		phase?: string;
		podIP?: string;
		containerStatuses?: K8sContainerStatus[];
		conditions?: K8sCondition[];
	};
}

// Raw Kubernetes Metrics types
interface K8sPodMetricsObject {
	metadata: {
		name: string;
		namespace?: string;
	};
	containers?: Array<{
		name?: string;
		usage?: {
			cpu?: string;
			memory?: string;
		};
	}>;
}

// Helper to format CPU from nanocores to millicores
function formatCpu(cpuString: string): string {
	if (!cpuString) return '0m';
	if (cpuString.endsWith('n')) {
		const nanocores = parseInt(cpuString.slice(0, -1));
		const millicores = Math.round(nanocores / 1000000);
		return `${millicores}m`;
	}
	return cpuString;
}

// Helper to format memory
function formatMemory(memString: string): string {
	if (!memString) return '0Mi';
	if (memString.endsWith('Ki')) {
		const kilobytes = parseInt(memString.slice(0, -2));
		const megabytes = Math.round(kilobytes / 1024);
		return `${megabytes}Mi`;
	}
	return memString;
}

/**
 * Transform a raw Kubernetes Pod object to PodInfo model
 * This ensures SSE events match the same format as listPods()
 */
export function transformPod(rawPod: K8sPodObject): PodInfo {
	const metadata = rawPod.metadata || {};
	const spec = rawPod.spec || {};
	const status = rawPod.status || {};

	// Calculate container statuses
	const containerStatuses = status.containerStatuses || [];
	const readyCount = containerStatuses.filter((c) => c.ready).length;
	const totalCount = containerStatuses.length;
	const totalRestarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

	const phase = status.phase || 'Unknown';

	// Determine pod status (check for common error states)
	let podStatus = phase;

	// Check for container issues
	const hasWaiting = containerStatuses.some((c) => c.state?.waiting);
	const hasTerminated = containerStatuses.some((c) => c.state?.terminated);

	if (phase === 'Running' && readyCount < totalCount) {
		podStatus = 'NotReady';
	} else if (hasWaiting) {
		const waitingContainer = containerStatuses.find((c) => c.state?.waiting);
		const waitingState = waitingContainer?.state?.waiting;
		podStatus = waitingState?.reason || 'Waiting';
	} else if (hasTerminated && phase !== 'Succeeded') {
		podStatus = 'Error';
	}

	// Extract container details
	const containers = (spec.containers || []).map((container, idx) => {
		const containerStatus = containerStatuses.find((cs) => cs.name === container.name) || {};
		let state = 'Unknown';
		if (containerStatus.state?.running) state = 'Running';
		else if (containerStatus.state?.waiting) state = 'Waiting';
		else if (containerStatus.state?.terminated) state = 'Terminated';

		return {
			name: container.name || `container-${idx}`,
			image: container.image || 'unknown',
			ready: containerStatus.ready || false,
			restartCount: containerStatus.restartCount || 0,
			state
		};
	});

	const createdAt = metadata.creationTimestamp || new Date().toISOString();

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		uid: metadata.uid,
		status: podStatus,
		phase,
		ready: `${readyCount}/${totalCount}`,
		restarts: totalRestarts,
		node: spec.nodeName || 'N/A',
		ip: status.podIP || 'N/A',
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		ownerKind: metadata.ownerReferences?.[0]?.kind,
		ownerName: metadata.ownerReferences?.[0]?.name,
		containers,
		conditions: (status.conditions || []).map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		createdAt
	};
}

/**
 * Transform a raw Kubernetes PodMetrics object to PodMetrics model
 * This ensures SSE events match the same format as listPodMetrics()
 */
export function transformPodMetrics(rawMetrics: K8sPodMetricsObject): PodMetrics {
	const containers = rawMetrics.containers || [];

	const containerMetrics = containers.map((container) => ({
		name: container.name || 'unknown',
		cpu: formatCpu(container.usage?.cpu || '0'),
		memory: formatMemory(container.usage?.memory || '0')
	}));

	// Sum total pod metrics
	let totalCpuNano = 0;
	let totalMemoryKi = 0;

	containers.forEach((container) => {
		const cpuStr = container.usage?.cpu || '0';
		const memStr = container.usage?.memory || '0';

		if (cpuStr.endsWith('n')) {
			totalCpuNano += parseInt(cpuStr.slice(0, -1));
		} else if (cpuStr.endsWith('m')) {
			totalCpuNano += parseInt(cpuStr.slice(0, -1)) * 1000000;
		}

		if (memStr.endsWith('Ki')) {
			totalMemoryKi += parseInt(memStr.slice(0, -2));
		} else if (memStr.endsWith('Mi')) {
			totalMemoryKi += parseInt(memStr.slice(0, -2)) * 1024;
		}
	});

	return {
		name: rawMetrics.metadata.name || 'unknown',
		namespace: rawMetrics.metadata.namespace || 'default',
		cpu: formatCpu(`${totalCpuNano}n`),
		memory: formatMemory(`${totalMemoryKi}Ki`),
		containers: containerMetrics
	};
}

// ── Deployment ───────────────────────────────────────────────────────────────

interface K8sDeploymentObject {
	metadata?: {
		name?: string;
		namespace?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: {
		replicas?: number;
		strategy?: { type?: string };
		selector?: { matchLabels?: Record<string, string> };
		template?: {
			spec?: {
				containers?: Array<{
					name?: string;
					image?: string;
					ports?: Array<{ containerPort?: number; protocol?: string }>;
				}>;
			};
		};
	};
	status?: {
		replicas?: number;
		readyReplicas?: number;
		updatedReplicas?: number;
		availableReplicas?: number;
		conditions?: K8sCondition[];
	};
}

/**
 * Transform a raw Kubernetes Deployment object to match listDeployments() shape
 */
export function transformDeployment(raw: unknown) {
	const deployment = raw as K8sDeploymentObject;
	const metadata = deployment.metadata || {};
	const spec = deployment.spec || {};
	const status = deployment.status || {};

	const replicas = spec.replicas || 0;
	const ready = status.readyReplicas || 0;

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		ready: `${ready}/${replicas}`,
		upToDate: status.updatedReplicas || 0,
		available: status.availableReplicas || 0,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		replicas,
		updatedReplicas: status.updatedReplicas || 0,
		readyReplicas: ready,
		availableReplicas: status.availableReplicas || 0,
		strategy: spec.strategy?.type || 'RollingUpdate',
		selector: spec.selector?.matchLabels || {},
		containers: (spec.template?.spec?.containers || []).map((c) => ({
			name: c.name || 'unknown',
			image: c.image || 'unknown',
			ports: (c.ports || []).map((p) => ({
				containerPort: p.containerPort || 0,
				protocol: p.protocol || 'TCP'
			}))
		})),
		conditions: (status.conditions || []).map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		createdAt: metadata.creationTimestamp
	};
}

// ── DaemonSet ────────────────────────────────────────────────────────────────

interface K8sDaemonSetObject {
	metadata?: {
		name?: string;
		namespace?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: {
		selector?: { matchLabels?: Record<string, string> };
		template?: {
			spec?: {
				containers?: Array<{
					name?: string;
					image?: string;
				}>;
				nodeSelector?: Record<string, string>;
			};
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
}

/**
 * Transform a raw Kubernetes DaemonSet object to match listDaemonSets() shape
 */
export function transformDaemonSet(raw: unknown) {
	const ds = raw as K8sDaemonSetObject;
	const metadata = ds.metadata || {};
	const spec = ds.spec || {};
	const status = ds.status || {};

	const desired = status.desiredNumberScheduled || 0;
	const ready = status.numberReady || 0;

	let dsStatus = 'Running';
	if (ready === desired && desired > 0) {
		dsStatus = 'Ready';
	} else if (ready === 0) {
		dsStatus = 'NotReady';
	}

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		desired,
		current: status.currentNumberScheduled || 0,
		ready,
		upToDate: status.updatedNumberScheduled || 0,
		available: status.numberAvailable || 0,
		status: dsStatus,
		nodeSelector: spec.template?.spec?.nodeSelector || {},
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		selector: spec.selector?.matchLabels || {},
		containers: (spec.template?.spec?.containers || []).map((c) => ({
			name: c.name || 'unknown',
			image: c.image || 'unknown'
		})),
		conditions: (status.conditions || []).map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		createdAt: metadata.creationTimestamp
	};
}

// ── StatefulSet ──────────────────────────────────────────────────────────────

interface K8sStatefulSetObject {
	metadata?: {
		name?: string;
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
			spec?: {
				containers?: Array<{
					name?: string;
					image?: string;
				}>;
			};
		};
	};
	status?: {
		replicas?: number;
		readyReplicas?: number;
		currentReplicas?: number;
		updatedReplicas?: number;
		conditions?: K8sCondition[];
	};
}

/**
 * Transform a raw Kubernetes StatefulSet object to match listStatefulSets() shape
 */
export function transformStatefulSet(raw: unknown) {
	const sts = raw as K8sStatefulSetObject;
	const metadata = sts.metadata || {};
	const spec = sts.spec || {};
	const status = sts.status || {};

	const replicas = spec.replicas || 0;
	const readyReplicas = status.readyReplicas || 0;
	const currentReplicas = status.currentReplicas || 0;

	let stsStatus = 'Running';
	if (readyReplicas === replicas && replicas > 0) {
		stsStatus = 'Ready';
	} else if (readyReplicas === 0) {
		stsStatus = 'NotReady';
	}

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		ready: `${readyReplicas}/${replicas}`,
		replicas,
		readyReplicas,
		currentReplicas,
		updatedReplicas: status.updatedReplicas || 0,
		status: stsStatus,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		selector: spec.selector?.matchLabels || {},
		serviceName: spec.serviceName || '',
		containers: (spec.template?.spec?.containers || []).map((c) => ({
			name: c.name || 'unknown',
			image: c.image || 'unknown'
		})),
		conditions: (status.conditions || []).map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		createdAt: metadata.creationTimestamp
	};
}

// ── ReplicaSet ───────────────────────────────────────────────────────────────

interface K8sReplicaSetObject {
	metadata?: {
		name?: string;
		namespace?: string;
		uid?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		ownerReferences?: Array<{ kind?: string; name?: string; uid?: string }>;
	};
	spec?: {
		replicas?: number;
		selector?: { matchLabels?: Record<string, string> };
		template?: {
			spec?: {
				containers?: Array<{
					name?: string;
					image?: string;
				}>;
			};
		};
	};
	status?: {
		replicas?: number;
		readyReplicas?: number;
		conditions?: K8sCondition[];
	};
}

/**
 * Transform a raw Kubernetes ReplicaSet object to match listReplicaSets() shape
 */
export function transformReplicaSet(raw: unknown) {
	const rs = raw as K8sReplicaSetObject;
	const metadata = rs.metadata || {};
	const spec = rs.spec || {};
	const status = rs.status || {};

	const desired = spec.replicas || 0;
	const current = status.replicas || 0;
	const ready = status.readyReplicas || 0;

	let rsStatus = 'Running';
	if (ready === desired && desired > 0) {
		rsStatus = 'Ready';
	} else if (ready === 0 && desired > 0) {
		rsStatus = 'NotReady';
	} else if (desired === 0) {
		rsStatus = 'Scaled Down';
	}

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		uid: metadata.uid,
		desired,
		current,
		ready,
		status: rsStatus,
		ownerKind: metadata.ownerReferences?.[0]?.kind,
		ownerName: metadata.ownerReferences?.[0]?.name,
		selector: spec.selector?.matchLabels || {},
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		containers: (spec.template?.spec?.containers || []).map((c) => ({
			name: c.name || 'unknown',
			image: c.image || 'unknown'
		})),
		conditions: (status.conditions || []).map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		createdAt: metadata.creationTimestamp
	};
}

// ── Job ──────────────────────────────────────────────────────────────────────

interface K8sJobObject {
	metadata?: {
		name?: string;
		namespace?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: {
		completions?: number;
		suspend?: boolean;
		template?: {
			spec?: {
				containers?: Array<{
					name?: string;
					image?: string;
				}>;
			};
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
}

/**
 * Transform a raw Kubernetes Job object to match listJobs() shape
 */
export function transformJob(raw: unknown) {
	const job = raw as K8sJobObject;
	const metadata = job.metadata || {};
	const spec = job.spec || {};
	const status = job.status || {};

	const active = status.active || 0;
	const succeeded = status.succeeded || 0;
	const failed = status.failed || 0;

	let jobStatus = 'Running';
	if (spec.suspend) {
		jobStatus = 'Suspended';
	} else if (succeeded > 0 && active === 0) {
		jobStatus = 'Complete';
	} else if (failed > 0) {
		jobStatus = 'Failed';
	} else if (active > 0) {
		jobStatus = 'Running';
	}

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
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		status: jobStatus,
		completions,
		duration,
		active,
		succeeded,
		failed,
		startTime: status.startTime || '',
		completionTime: status.completionTime,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		containers: (spec.template?.spec?.containers || []).map((c) => ({
			name: c.name || 'unknown',
			image: c.image || 'unknown'
		})),
		conditions: (status.conditions || []).map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		createdAt: metadata.creationTimestamp
	};
}

// ── Node ─────────────────────────────────────────────────────────────────────

interface K8sNodeObject {
	metadata?: {
		name?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: {
		taints?: Array<{ key?: string; value?: string; effect?: string }>;
		unschedulable?: boolean;
	};
	status?: {
		conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
		addresses?: Array<{ type?: string; address?: string }>;
		nodeInfo?: {
			kubeletVersion?: string;
			osImage?: string;
			kernelVersion?: string;
			containerRuntimeVersion?: string;
		};
		capacity?: Record<string, string>;
		allocatable?: Record<string, string>;
	};
}

export function transformNode(raw: unknown): {
	name: string;
	status: string;
	roles: string[];
	version: string;
	internalIP: string;
	osImage: string;
	kernelVersion: string;
	containerRuntime: string;
	cpuCapacity: string;
	memoryCapacity: string;
	podsCapacity: string;
	diskCapacity: string;
	podsCount: number;
	cpuAllocatable: string;
	memoryAllocatable: string;
	podsAllocatable: string;
	diskAllocatable: string;
	conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
	addresses: Array<{ type: string; address: string }>;
	taints: Array<{ key: string; value?: string; effect: string }>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
	unschedulable: boolean;
} {
	const node = raw as K8sNodeObject;
	const metadata = node.metadata ?? {};
	const spec = node.spec ?? {};
	const status = node.status ?? {};
	const conditions = status.conditions || [];
	const readyCondition = conditions.find((c) => c.type === 'Ready');
	const nodeStatus = readyCondition?.status === 'True' ? 'Ready' : 'NotReady';
	const nodeInfo = status.nodeInfo || {};
	const capacity = status.capacity || {};
	const allocatable = status.allocatable || {};
	const addresses = (status.addresses || []).map((a) => ({
		type: a.type || 'Unknown',
		address: a.address || ''
	}));

	return {
		name: metadata.name || 'unknown',
		status: nodeStatus,
		roles: metadata.labels?.['node-role.kubernetes.io/control-plane'] !== undefined
			? ['control-plane']
			: ['worker'],
		version: nodeInfo.kubeletVersion || 'Unknown',
		internalIP: addresses.find((a) => a.type === 'InternalIP')?.address || 'Unknown',
		osImage: nodeInfo.osImage || 'Unknown',
		kernelVersion: nodeInfo.kernelVersion || 'Unknown',
		containerRuntime: nodeInfo.containerRuntimeVersion || 'Unknown',
		cpuCapacity: capacity.cpu || '0',
		memoryCapacity: capacity.memory || '0',
		podsCapacity: capacity.pods || '0',
		diskCapacity: capacity['ephemeral-storage'] || '0',
		// Node objects don't contain running pod count; callers that know it (listNodes)
		// will overwrite this with the real value.
		podsCount: 0,
		cpuAllocatable: allocatable.cpu || '0',
		memoryAllocatable: allocatable.memory || '0',
		podsAllocatable: allocatable.pods || '0',
		diskAllocatable: allocatable['ephemeral-storage'] || '0',
		conditions: conditions.map((c) => ({
			type: c.type || 'Unknown',
			status: c.status || 'Unknown',
			reason: c.reason,
			message: c.message
		})),
		addresses,
		taints: (spec.taints || []).map((t) => ({
			key: t.key || '',
			value: t.value,
			effect: t.effect || ''
		})),
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || '',
		unschedulable: spec.unschedulable === true
	};
}

// ── CronJob ──────────────────────────────────────────────────────────────────

interface K8sCronJobObject {
	metadata?: {
		name?: string;
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
					spec?: {
						containers?: Array<{ name?: string; image?: string }>;
					};
				};
			};
		};
	};
	status?: {
		lastScheduleTime?: string;
		active?: Array<unknown>;
	};
}

export function transformCronJob(raw: unknown): {
	name: string;
	namespace: string;
	status: string;
	schedule: string;
	suspend: boolean;
	lastSchedule?: string;
	active: number;
	containers: Array<{ name: string; image: string }>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const cj = raw as K8sCronJobObject;
	const metadata = cj.metadata ?? {};
	const spec = cj.spec ?? {};
	const status = cj.status ?? {};
	const isSuspended = spec.suspend === true;

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		status: isSuspended ? 'Suspended' : 'Active',
		schedule: spec.schedule || '',
		suspend: isSuspended,
		lastSchedule: status.lastScheduleTime,
		active: (status.active || []).length,
		containers: (spec.jobTemplate?.spec?.template?.spec?.containers || []).map((c) => ({
			name: c.name || 'unknown',
			image: c.image || 'unknown'
		})),
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── Namespace ────────────────────────────────────────────────────────────────

interface K8sNamespaceObject {
	metadata?: {
		name?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	status?: {
		phase?: string;
	};
}

export function transformNamespace(raw: unknown): {
	name: string;
	status: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const ns = raw as K8sNamespaceObject;
	const metadata = ns.metadata ?? {};
	return {
		name: metadata.name || 'unknown',
		status: ns.status?.phase || 'Unknown',
		labels: metadata.labels ?? {},
		annotations: metadata.annotations ?? {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── Event ────────────────────────────────────────────────────────────────────

interface K8sEventObject {
	metadata?: {
		name?: string;
		namespace?: string;
		creationTimestamp?: string;
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
}

export function transformEvent(raw: unknown): {
	name: string;
	namespace: string;
	type: string;
	reason: string;
	message: string;
	source: string;
	count: number;
	firstSeen: string;
	lastSeen: string;
	involvedObject: {
		kind: string;
		name: string;
		namespace?: string;
	};
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const evt = raw as K8sEventObject;
	const metadata = evt.metadata ?? {};
	const involvedObject = evt.involvedObject ?? {};

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		type: evt.type || 'Normal',
		reason: evt.reason || 'Unknown',
		message: evt.message || '',
		source: evt.source?.component || 'unknown',
		count: evt.count || 1,
		firstSeen: evt.firstTimestamp || metadata.creationTimestamp || '',
		lastSeen: evt.lastTimestamp || metadata.creationTimestamp || '',
		involvedObject: {
			kind: involvedObject.kind || 'Unknown',
			name: involvedObject.name || 'unknown',
			namespace: involvedObject.namespace
		},
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── Service ──────────────────────────────────────────────────────────────────

interface K8sServiceObject {
	metadata?: {
		name?: string;
		namespace?: string;
		creationTimestamp?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: {
		type?: string;
		clusterIP?: string;
		externalIPs?: string[];
		ports?: Array<{
			name?: string;
			port?: number;
			targetPort?: string | number;
			protocol?: string;
			nodePort?: number;
		}>;
		selector?: Record<string, string>;
		sessionAffinity?: string;
		loadBalancerIP?: string;
	};
	status?: {
		loadBalancer?: {
			ingress?: Array<{
				ip?: string;
				hostname?: string;
			}>;
		};
	};
}

export function transformService(raw: unknown): {
	name: string;
	namespace: string;
	type: string;
	clusterIP: string;
	externalIPs: string[];
	ports: Array<{
		name?: string;
		port: number;
		targetPort: string | number;
		protocol: string;
		nodePort?: number;
	}>;
	selector: Record<string, string>;
	sessionAffinity: string;
	loadBalancerIP?: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const svc = raw as K8sServiceObject;
	const metadata = svc.metadata ?? {};
	const spec = svc.spec ?? {};
	const status = svc.status ?? {};

	const ports = (spec.ports || []).map((p) => ({
		name: p.name,
		port: p.port || 0,
		targetPort: p.targetPort || p.port || 0,
		protocol: p.protocol || 'TCP',
		nodePort: p.nodePort
	}));

	const externalIPs: string[] = [];
	if (spec.externalIPs && Array.isArray(spec.externalIPs)) {
		externalIPs.push(...spec.externalIPs);
	}
	if (status?.loadBalancer?.ingress) {
		for (const ingress of status.loadBalancer.ingress) {
			if (ingress.ip) externalIPs.push(ingress.ip);
			if (ingress.hostname) externalIPs.push(ingress.hostname);
		}
	}

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		type: spec.type || 'ClusterIP',
		clusterIP: spec.clusterIP || 'None',
		externalIPs,
		ports,
		selector: spec.selector || {},
		sessionAffinity: spec.sessionAffinity || 'None',
		loadBalancerIP: spec.loadBalancerIP,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

export function transformEndpoint(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	subsets: Array<{
		addresses?: Array<{ ip?: string; nodeName?: string }>;
		ports?: Array<{ name?: string; port?: number; protocol?: string }>;
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const ep = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			uid?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		subsets?: Array<{
			addresses?: Array<{ ip?: string; nodeName?: string }>;
			ports?: Array<{ name?: string; port?: number; protocol?: string }>;
		}>;
	};
	const metadata = ep.metadata ?? {};

	return {
		id: metadata.uid || `${metadata.namespace}/${metadata.name}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		subsets: (ep.subsets || []).map((s) => ({
			addresses: s.addresses,
			ports: s.ports
		})),
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

export function transformEndpointSlice(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	addressType: string;
	endpoints: Array<{
		addresses?: string[];
		conditions?: { ready?: boolean };
	}>;
	ports: Array<{
		name?: string;
		port?: number;
		protocol?: string;
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const slice = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			uid?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		addressType?: string;
		endpoints?: Array<{
			addresses?: string[];
			conditions?: { ready?: boolean };
		}>;
		ports?: Array<{
			name?: string;
			port?: number;
			protocol?: string;
		}>;
	};
	const metadata = slice.metadata ?? {};

	return {
		id: metadata.uid || `${metadata.namespace}/${metadata.name}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		addressType: slice.addressType || 'IPv4',
		endpoints: (slice.endpoints || []).map((ep) => ({
			addresses: ep.addresses,
			conditions: ep.conditions
		})),
		ports: (slice.ports || []).map((p) => ({
			name: p.name,
			port: p.port,
			protocol: p.protocol || 'TCP'
		})),
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

interface K8sIngressObject {
	metadata?: {
		name?: string;
		namespace?: string;
		uid?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
		creationTimestamp?: string;
	};
	spec?: {
		ingressClassName?: string;
		tls?: Array<{
			hosts?: string[];
			secretName?: string;
		}>;
		rules?: Array<{
			host?: string;
			http?: {
				paths?: Array<{
					path?: string;
					pathType?: string;
					backend?: {
						service?: {
							name?: string;
							port?: { number?: number; name?: string };
						};
					};
				}>;
			};
		}>;
	};
	status?: {
		loadBalancer?: {
			ingress?: Array<{ ip?: string; hostname?: string }>;
		};
	};
}

export function transformIngress(raw: unknown): {
	name: string;
	namespace: string;
	hosts: string[];
	paths: Array<{
		path: string;
		pathType: string;
		host: string;
		backend: { service: string; port: string | number };
	}>;
	tls: Array<{ hosts: string[]; secretName?: string }>;
	ingressClass?: string;
	addresses: string[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const ing = raw as K8sIngressObject;
	const metadata = ing.metadata ?? {};
	const spec = ing.spec ?? {};
	const status = ing.status ?? {};

	const hosts: string[] = [];
	const paths: Array<{
		path: string;
		pathType: string;
		host: string;
		backend: { service: string; port: string | number };
	}> = [];

	if (spec.rules && Array.isArray(spec.rules)) {
		for (const rule of spec.rules) {
			const host = rule.host || '*';
			if (rule.host && !hosts.includes(rule.host)) {
				hosts.push(rule.host);
			}
			if (rule.http?.paths) {
				for (const pathItem of rule.http.paths) {
					const backend = pathItem.backend || {};
					let serviceName = '';
					let servicePort: string | number = '';
					if (backend.service) {
						serviceName = backend.service.name || '';
						if (backend.service.port?.number) {
							servicePort = backend.service.port.number;
						} else if (backend.service.port?.name) {
							servicePort = backend.service.port.name;
						}
					}
					paths.push({
						path: pathItem.path || '/',
						pathType: pathItem.pathType || 'Prefix',
						host,
						backend: { service: serviceName, port: servicePort }
					});
				}
			}
		}
	}

	const addresses: string[] = [];
	if (status.loadBalancer?.ingress) {
		for (const entry of status.loadBalancer.ingress) {
			if (entry.ip) addresses.push(entry.ip);
			if (entry.hostname) addresses.push(entry.hostname);
		}
	}

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		hosts,
		paths,
		tls: (spec.tls || []).map((t) => ({ hosts: t.hosts || [], secretName: t.secretName })),
		ingressClass: spec.ingressClassName || 'default',
		addresses,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

export function transformIngressClass(raw: unknown): {
	name: string;
	controller: string;
	parameters?: {
		apiGroup?: string;
		kind?: string;
		name?: string;
	};
	isDefault: boolean;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const ic = raw as {
		metadata?: {
			name?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		spec?: {
			controller?: string;
			parameters?: {
				apiGroup?: string;
				kind?: string;
				name?: string;
			};
		};
	};
	const metadata = ic.metadata ?? {};
	const spec = ic.spec ?? {};

	return {
		name: metadata.name || 'unknown',
		controller: spec.controller || 'Unknown',
		parameters: spec.parameters,
		isDefault: metadata.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true',
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── NetworkPolicy ────────────────────────────────────────────────────────────

export function transformNetworkPolicy(raw: unknown): {
	name: string;
	namespace: string;
	podSelector: Record<string, any>;
	policyTypes: string[];
	ingress: any[];
	egress: any[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const np = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		spec?: {
			podSelector?: unknown;
			policyTypes?: string[];
			ingress?: unknown[];
			egress?: unknown[];
		};
	};
	const metadata = np.metadata ?? {};
	const spec = np.spec ?? {};

	return {
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		podSelector: (spec.podSelector as Record<string, any>) || {},
		policyTypes: spec.policyTypes || [],
		ingress: (spec.ingress as any[]) || [],
		egress: (spec.egress as any[]) || [],
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── ConfigMap ────────────────────────────────────────────────────────────────

export function transformConfigMap(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	dataCount: number;
	data: Record<string, string>;
	binaryData: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const cm = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		data?: Record<string, string>;
		binaryData?: Record<string, string>;
	};
	const metadata = cm.metadata ?? {};
	const data = cm.data || {};
	const binaryData = cm.binaryData || {};

	return {
		id: `${metadata.namespace || 'default'}/${metadata.name || 'unknown'}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		dataCount: Object.keys(data).length,
		data,
		binaryData,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── Secret ───────────────────────────────────────────────────────────────────

export function transformSecret(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	type: string;
	dataCount: number;
	data: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const secret = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		type?: string;
		data?: Record<string, string>;
	};
	const metadata = secret.metadata ?? {};
	const data = secret.data || {};

	return {
		id: `${metadata.namespace || 'default'}/${metadata.name || 'unknown'}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		type: secret.type || 'Opaque',
		dataCount: Object.keys(data).length,
		data,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── ResourceQuota ────────────────────────────────────────────────────────────

export function transformResourceQuota(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	hard: Record<string, string>;
	used: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const rq = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		spec?: {
			hard?: Record<string, string>;
		};
		status?: {
			used?: Record<string, string>;
		};
	};
	const metadata = rq.metadata ?? {};

	return {
		id: `${metadata.namespace || 'default'}/${metadata.name || 'unknown'}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		hard: rq.spec?.hard || {},
		used: rq.status?.used || {},
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── LimitRange ──────────────────────────────────────────────────────────────

export function transformLimitRange(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	limits: Array<{
		type?: string;
		max?: Record<string, string>;
		min?: Record<string, string>;
		default?: Record<string, string>;
		defaultRequest?: Record<string, string>;
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const lr = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		spec?: {
			limits?: Array<{
				type?: string;
				max?: Record<string, string>;
				min?: Record<string, string>;
				default?: Record<string, string>;
				defaultRequest?: Record<string, string>;
			}>;
		};
	};
	const metadata = lr.metadata ?? {};

	return {
		id: `${metadata.namespace || 'default'}/${metadata.name || 'unknown'}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		limits: lr.spec?.limits || [],
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── PersistentVolumeClaim ───────────────────────────────────────────────────

export function transformPVC(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	status: string;
	volume: string;
	capacity: string;
	accessModes: string[];
	storageClass: string;
	volumeMode: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const pvc = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		spec?: {
			volumeName?: string;
			accessModes?: string[];
			storageClassName?: string;
			volumeMode?: string;
			resources?: { requests?: { storage?: string } };
		};
		status?: {
			phase?: string;
			capacity?: { storage?: string };
		};
	};
	const metadata = pvc.metadata ?? {};
	const spec = pvc.spec ?? {};
	const status = pvc.status ?? {};

	return {
		id: `${metadata.namespace || 'default'}/${metadata.name || 'unknown'}`,
		name: metadata.name || 'unknown',
		namespace: metadata.namespace || 'default',
		status: status.phase || 'Unknown',
		volume: spec.volumeName || '',
		capacity: status.capacity?.storage || spec.resources?.requests?.storage || 'Unknown',
		accessModes: spec.accessModes || [],
		storageClass: spec.storageClassName || '',
		volumeMode: spec.volumeMode || 'Filesystem',
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── PersistentVolume ────────────────────────────────────────────────────────

export function transformPV(raw: unknown): {
	id: string;
	name: string;
	capacity: string;
	accessModes: string[];
	reclaimPolicy: string;
	status: string;
	claim: string;
	storageClass: string;
	volumeMode: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const pv = raw as {
		metadata?: {
			name?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		spec?: {
			capacity?: { storage?: string };
			accessModes?: string[];
			persistentVolumeReclaimPolicy?: string;
			storageClassName?: string;
			volumeMode?: string;
			claimRef?: {
				namespace?: string;
				name?: string;
			};
		};
		status?: {
			phase?: string;
		};
	};
	const metadata = pv.metadata ?? {};
	const spec = pv.spec ?? {};
	const status = pv.status ?? {};

	return {
		id: metadata.name || 'unknown',
		name: metadata.name || 'unknown',
		capacity: spec.capacity?.storage || 'Unknown',
		accessModes: spec.accessModes || [],
		reclaimPolicy: spec.persistentVolumeReclaimPolicy || 'Retain',
		status: status.phase || 'Unknown',
		claim: spec.claimRef ? `${spec.claimRef.namespace}/${spec.claimRef.name}` : '',
		storageClass: spec.storageClassName || '',
		volumeMode: spec.volumeMode || 'Filesystem',
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── StorageClass ────────────────────────────────────────────────────────────

export function transformStorageClass(raw: unknown): {
	id: string;
	name: string;
	provisioner: string;
	reclaimPolicy: string;
	volumeBindingMode: string;
	allowVolumeExpansion: boolean;
	isDefault: boolean;
	parameters: Record<string, string>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const sc = raw as {
		metadata?: {
			name?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		provisioner?: string;
		reclaimPolicy?: string;
		volumeBindingMode?: string;
		allowVolumeExpansion?: boolean;
		parameters?: Record<string, string>;
	};
	const metadata = sc.metadata ?? {};

	return {
		id: metadata.name || 'unknown',
		name: metadata.name || 'unknown',
		provisioner: sc.provisioner || 'Unknown',
		reclaimPolicy: sc.reclaimPolicy || 'Delete',
		volumeBindingMode: sc.volumeBindingMode || 'Immediate',
		allowVolumeExpansion: sc.allowVolumeExpansion || false,
		isDefault:
			metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
		parameters: sc.parameters || {},
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── ServiceAccount ──────────────────────────────────────────────────────────

export function transformServiceAccount(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	secrets: number;
	imagePullSecrets: number;
	secretNames: string[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const sa = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		secrets?: Array<{ name?: string }>;
		imagePullSecrets?: Array<{ name?: string }>;
	};
	const metadata = sa.metadata ?? {};
	const namespace = metadata.namespace || 'default';
	const name = metadata.name || 'unknown';

	return {
		id: `${namespace}/${name}`,
		name,
		namespace,
		secrets: (sa.secrets || []).length,
		imagePullSecrets: (sa.imagePullSecrets || []).length,
		secretNames: (sa.secrets || []).map((s) => s.name || ''),
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── Role ────────────────────────────────────────────────────────────────────

export function transformRole(raw: unknown): {
	id: string;
	name: string;
	namespace: string;
	rules: Array<{
		apiGroups?: string[];
		resources?: string[];
		verbs: string[];
	}>;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const role = raw as {
		metadata?: {
			name?: string;
			namespace?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		rules?: Array<{
			apiGroups?: string[];
			resources?: string[];
			verbs: string[];
		}>;
	};
	const metadata = role.metadata ?? {};
	const namespace = metadata.namespace || 'default';
	const name = metadata.name || 'unknown';

	return {
		id: `${namespace}/${name}`,
		name,
		namespace,
		rules: role.rules || [],
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

// ── ClusterRole ─────────────────────────────────────────────────────────────

export function transformClusterRole(raw: unknown): {
	id: string;
	name: string;
	rules: Array<{
		apiGroups?: string[];
		resources?: string[];
		verbs: string[];
	}>;
	aggregationRule?: {
		clusterRoleSelectors?: Array<{
			matchLabels?: Record<string, string>;
		}>;
	};
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
} {
	const cr = raw as {
		metadata?: {
			name?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
			creationTimestamp?: string;
		};
		rules?: Array<{
			apiGroups?: string[];
			resources?: string[];
			verbs: string[];
		}>;
		aggregationRule?: {
			clusterRoleSelectors?: Array<{
				matchLabels?: Record<string, string>;
			}>;
		};
	};
	const metadata = cr.metadata ?? {};
	const name = metadata.name || 'unknown';

	return {
		id: name,
		name,
		rules: cr.rules || [],
		aggregationRule: cr.aggregationRule,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

/**
 * Transform a raw RoleBinding watch event object into RoleBindingInfo
 */
export function transformRoleBinding(rb: Record<string, any>): Record<string, any> {
	const metadata = rb.metadata ?? {};
	const name = metadata.name || 'unknown';
	const namespace = metadata.namespace || 'default';

	return {
		id: `${namespace}/${name}`,
		name,
		namespace,
		roleRef: rb.roleRef || {},
		subjects: rb.subjects || [],
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

/**
 * Transform a raw ClusterRoleBinding watch event object into ClusterRoleBindingInfo
 */
export function transformClusterRoleBinding(crb: Record<string, any>): Record<string, any> {
	const metadata = crb.metadata ?? {};
	const name = metadata.name || 'unknown';

	return {
		id: name,
		name,
		roleRef: crb.roleRef || {},
		subjects: crb.subjects || [],
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}