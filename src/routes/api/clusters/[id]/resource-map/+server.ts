import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { makeClusterRequest } from '$lib/server/services/kubernetes/utils';

interface K8sListResult<T> {
	items: T[];
}

interface K8sMeta {
	name?: string;
	namespace?: string;
	labels?: Record<string, string>;
	creationTimestamp?: string;
	ownerReferences?: Array<{ kind: string; name: string; uid?: string }>;
	uid?: string;
}

interface K8sPod {
	metadata: K8sMeta;
	spec: { containers?: Array<{ name: string; image?: string }>; nodeName?: string };
	status: { phase?: string; containerStatuses?: Array<{ ready: boolean; restartCount: number; state?: Record<string, unknown> }> };
}

interface K8sDeployment {
	metadata: K8sMeta;
	spec: { replicas?: number; selector?: { matchLabels?: Record<string, string> } };
	status: { readyReplicas?: number; availableReplicas?: number; replicas?: number };
}

interface K8sReplicaSet {
	metadata: K8sMeta;
	spec: { replicas?: number };
	status: { readyReplicas?: number; replicas?: number };
}

interface K8sDaemonSet {
	metadata: K8sMeta;
	status: { desiredNumberScheduled?: number; numberReady?: number; numberAvailable?: number };
}

interface K8sStatefulSet {
	metadata: K8sMeta;
	spec: { replicas?: number };
	status: { readyReplicas?: number; replicas?: number };
}

interface K8sService {
	metadata: K8sMeta;
	spec: { type?: string; clusterIP?: string; ports?: Array<{ port: number; targetPort?: number | string; protocol?: string }>; selector?: Record<string, string> };
}

interface K8sIngress {
	metadata: K8sMeta;
	spec: { rules?: Array<{ host?: string; http?: { paths?: Array<{ path?: string; backend?: { service?: { name?: string; port?: { number?: number } } } }> } }>; tls?: Array<{ hosts?: string[] }> };
}

interface K8sJob {
	metadata: K8sMeta;
	spec: { completions?: number };
	status: { succeeded?: number; failed?: number; active?: number; startTime?: string; completionTime?: string };
}

interface K8sCronJob {
	metadata: K8sMeta;
	spec: { schedule?: string; suspend?: boolean };
	status: { lastScheduleTime?: string };
}

/**
 * GET /api/clusters/[id]/resource-map
 * Fetches all resources for the resource topology diagram.
 * Query params:
 *   - namespace: (optional) Filter by namespace, or 'all' for all namespaces
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterId = parseInt(params.id);
	const namespace = url.searchParams.get('namespace') || 'all';

	if (isNaN(clusterId)) {
		return json({ error: 'Invalid cluster ID' }, { status: 400 });
	}

	const nsPath = namespace === 'all' ? '' : `/namespaces/${namespace}`;
	const prefix = namespace === 'all' ? '' : `/namespaces/${namespace}`;

	// Fetch all resources in parallel
	const [
		podsRes,
		deploymentsRes,
		replicaSetsRes,
		daemonSetsRes,
		statefulSetsRes,
		servicesRes,
		ingressesRes,
		jobsRes,
		cronJobsRes
	] = await Promise.all([
		makeClusterRequest<K8sListResult<K8sPod>>(clusterId, namespace === 'all' ? '/api/v1/pods' : `/api/v1/namespaces/${namespace}/pods`, 30000),
		makeClusterRequest<K8sListResult<K8sDeployment>>(clusterId, namespace === 'all' ? '/apis/apps/v1/deployments' : `/apis/apps/v1/namespaces/${namespace}/deployments`, 30000),
		makeClusterRequest<K8sListResult<K8sReplicaSet>>(clusterId, namespace === 'all' ? '/apis/apps/v1/replicasets' : `/apis/apps/v1/namespaces/${namespace}/replicasets`, 30000),
		makeClusterRequest<K8sListResult<K8sDaemonSet>>(clusterId, namespace === 'all' ? '/apis/apps/v1/daemonsets' : `/apis/apps/v1/namespaces/${namespace}/daemonsets`, 30000),
		makeClusterRequest<K8sListResult<K8sStatefulSet>>(clusterId, namespace === 'all' ? '/apis/apps/v1/statefulsets' : `/apis/apps/v1/namespaces/${namespace}/statefulsets`, 30000),
		makeClusterRequest<K8sListResult<K8sService>>(clusterId, namespace === 'all' ? '/api/v1/services' : `/api/v1/namespaces/${namespace}/services`, 30000),
		makeClusterRequest<K8sListResult<K8sIngress>>(clusterId, namespace === 'all' ? '/apis/networking.k8s.io/v1/ingresses' : `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`, 30000),
		makeClusterRequest<K8sListResult<K8sJob>>(clusterId, namespace === 'all' ? '/apis/batch/v1/jobs' : `/apis/batch/v1/namespaces/${namespace}/jobs`, 30000),
		makeClusterRequest<K8sListResult<K8sCronJob>>(clusterId, namespace === 'all' ? '/apis/batch/v1/cronjobs' : `/apis/batch/v1/namespaces/${namespace}/cronjobs`, 30000)
	]);

	// Process pods
	const pods = (podsRes.success && podsRes.data?.items || []).map((p) => {
		const containers = p.status?.containerStatuses || [];
		const ready = containers.filter((c) => c.ready).length;
		const total = containers.length || p.spec?.containers?.length || 0;
		const restarts = containers.reduce((sum, c) => sum + (c.restartCount || 0), 0);
		return {
			name: p.metadata?.name || 'unknown',
			namespace: p.metadata?.namespace || 'default',
			phase: p.status?.phase || 'Unknown',
			ready: `${ready}/${total}`,
			restarts,
			nodeName: p.spec?.nodeName,
			labels: p.metadata?.labels || {},
			ownerKind: p.metadata?.ownerReferences?.[0]?.kind,
			ownerName: p.metadata?.ownerReferences?.[0]?.name,
			uid: p.metadata?.uid
		};
	});

	// Process deployments
	const deployments = (deploymentsRes.success && deploymentsRes.data?.items || []).map((d) => ({
		name: d.metadata?.name || 'unknown',
		namespace: d.metadata?.namespace || 'default',
		replicas: d.spec?.replicas || 0,
		readyReplicas: d.status?.readyReplicas || 0,
		availableReplicas: d.status?.availableReplicas || 0,
		labels: d.metadata?.labels || {},
		selector: d.spec?.selector?.matchLabels || {},
		uid: d.metadata?.uid
	}));

	// Process replicasets
	const replicaSets = (replicaSetsRes.success && replicaSetsRes.data?.items || []).map((r) => ({
		name: r.metadata?.name || 'unknown',
		namespace: r.metadata?.namespace || 'default',
		replicas: r.status?.replicas || 0,
		readyReplicas: r.status?.readyReplicas || 0,
		ownerKind: r.metadata?.ownerReferences?.[0]?.kind,
		ownerName: r.metadata?.ownerReferences?.[0]?.name,
		uid: r.metadata?.uid
	}));

	// Process daemonsets
	const daemonSets = (daemonSetsRes.success && daemonSetsRes.data?.items || []).map((d) => ({
		name: d.metadata?.name || 'unknown',
		namespace: d.metadata?.namespace || 'default',
		desired: d.status?.desiredNumberScheduled || 0,
		ready: d.status?.numberReady || 0,
		available: d.status?.numberAvailable || 0,
		uid: d.metadata?.uid
	}));

	// Process statefulsets
	const statefulSets = (statefulSetsRes.success && statefulSetsRes.data?.items || []).map((s) => ({
		name: s.metadata?.name || 'unknown',
		namespace: s.metadata?.namespace || 'default',
		replicas: s.spec?.replicas || 0,
		readyReplicas: s.status?.readyReplicas || 0,
		uid: s.metadata?.uid
	}));

	// Process services
	const services = (servicesRes.success && servicesRes.data?.items || []).map((s) => ({
		name: s.metadata?.name || 'unknown',
		namespace: s.metadata?.namespace || 'default',
		type: s.spec?.type || 'ClusterIP',
		clusterIP: s.spec?.clusterIP,
		ports: (s.spec?.ports || []).map((p) => ({ port: p.port, targetPort: p.targetPort, protocol: p.protocol })),
		selector: s.spec?.selector || {},
		uid: s.metadata?.uid
	}));

	// Process ingresses
	const ingresses = (ingressesRes.success && ingressesRes.data?.items || []).map((i) => {
		const hosts = i.spec?.rules?.map((r) => r.host).filter(Boolean) || [];
		const backends = i.spec?.rules?.flatMap((r) =>
			r.http?.paths?.map((p) => ({
				path: p.path,
				serviceName: p.backend?.service?.name,
				servicePort: p.backend?.service?.port?.number
			})) || []
		) || [];
		return {
			name: i.metadata?.name || 'unknown',
			namespace: i.metadata?.namespace || 'default',
			hosts,
			backends,
			tls: (i.spec?.tls || []).length > 0,
			uid: i.metadata?.uid
		};
	});

	// Process jobs
	const jobs = (jobsRes.success && jobsRes.data?.items || []).map((j) => ({
		name: j.metadata?.name || 'unknown',
		namespace: j.metadata?.namespace || 'default',
		succeeded: j.status?.succeeded || 0,
		failed: j.status?.failed || 0,
		active: j.status?.active || 0,
		ownerKind: j.metadata?.ownerReferences?.[0]?.kind,
		ownerName: j.metadata?.ownerReferences?.[0]?.name,
		uid: j.metadata?.uid
	}));

	// Process cronjobs
	const cronJobs = (cronJobsRes.success && cronJobsRes.data?.items || []).map((c) => ({
		name: c.metadata?.name || 'unknown',
		namespace: c.metadata?.namespace || 'default',
		schedule: c.spec?.schedule || '',
		suspended: c.spec?.suspend || false,
		uid: c.metadata?.uid
	}));

	return json({
		success: true,
		data: {
			pods,
			deployments,
			replicaSets,
			daemonSets,
			statefulSets,
			services,
			ingresses,
			jobs,
			cronJobs
		}
	});
};
