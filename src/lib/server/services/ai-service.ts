/**
 * Shared AI Service
 * Unified provider calling, tool definitions, tool execution, and cluster manifest builder.
 * Used by /api/ai/chat and /api/ai/analyze endpoints.
 */

import {
	listPods,
	listPodMetrics,
	listNodes,
	listEvents,
	listDeployments,
	listNamespaces,
	listServices,
	listIngresses,
	listIngressClasses,
	listDaemonSets,
	listStatefulSets,
	listReplicaSets,
	listJobs,
	listCronJobs,
	listHorizontalPodAutoscalers,
	listEndpoints,
	listEndpointSlices,
	listNetworkPolicies,
	listConfigMaps,
	listSecrets,
	listPersistentVolumes,
	listPersistentVolumeClaims,
	listStorageClasses,
	listResourceQuotas,
	listLimitRanges,
	listServiceAccounts,
	listRoles,
	listClusterRoles,
	listRoleBindings,
	listClusterRoleBindings,
	buildConnectionConfig,
	k8sRequest
} from '$lib/server/services/kubernetes';
import { findCluster } from '$lib/server/queries/clusters';
import { getAiProviderWithKey, getDefaultProvider } from '$lib/server/queries/ai-providers';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AiMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface AiProvider {
	id: number;
	name: string;
	provider: string;
	model: string;
	apiKey: string;
	baseUrl?: string | null;
	enabled: boolean | null;
}

interface ToolProperty {
	type: string;
	description?: string;
	enum?: string[];
}

interface ToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, ToolProperty>;
		required?: string[];
	};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Shorthand for namespaced tools that accept a namespace parameter. */
function nsTool(name: string, description: string): ToolDefinition {
	return {
		name,
		description,
		parameters: {
			type: 'object',
			properties: {
				namespace: { type: 'string', description: 'Namespace to list from. Use "all" for all namespaces.' }
			},
			required: ['namespace']
		}
	};
}

// ── Tool Definitions (single source of truth) ───────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	// ── Workloads ──────────────────────────────────────────────────────────
	nsTool('list_pods', 'List pods. Returns name, namespace, status, restart counts, and container states.'),
	nsTool('list_pod_metrics', 'List pod CPU and memory usage. Returns per-pod and per-container metrics.'),
	{
		name: 'list_nodes',
		description: 'List all cluster nodes with status, roles, CPU/memory capacity, and health conditions.',
		parameters: { type: 'object', properties: {} }
	},
	nsTool('list_deployments', 'List Deployments. Returns ready replicas, strategy, and conditions.'),
	nsTool('list_daemonsets', 'List DaemonSets. Returns desired/ready/available counts and conditions.'),
	nsTool('list_statefulsets', 'List StatefulSets. Returns ready replicas and service name.'),
	nsTool('list_replicasets', 'List ReplicaSets. Returns desired/current/ready counts.'),
	nsTool('list_jobs', 'List Jobs. Returns completions, succeeded/failed/active counts, and duration.'),
	nsTool('list_cronjobs', 'List CronJobs. Returns schedule, suspend status, and last schedule time.'),
	nsTool(
		'list_hpas',
		'List HorizontalPodAutoscalers. Returns min/max pods, current/desired replicas, and target reference.'
	),
	{
		name: 'list_namespaces',
		description: 'List all Namespaces in the cluster with their status.',
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'list_events',
		description: 'List Kubernetes events. Use type="Warning" to see only warning events.',
		parameters: {
			type: 'object',
			properties: {
				namespace: { type: 'string', description: 'Namespace filter. Use "all" for all namespaces.' },
				type: { type: 'string', enum: ['Warning', 'Normal', 'all'], description: 'Event type filter.' }
			},
			required: ['namespace']
		}
	},
	{
		name: 'get_pod_logs',
		description:
			'Fetch recent log lines from a pod to diagnose errors, crashes, and application issues.',
		parameters: {
			type: 'object',
			properties: {
				namespace: { type: 'string', description: 'Namespace the pod is in.' },
				pod: { type: 'string', description: 'Pod name.' },
				container: { type: 'string', description: 'Container name (optional).' },
				tailLines: { type: 'number', description: 'Lines to return from log end. Default 100.' }
			},
			required: ['namespace', 'pod']
		}
	},
	// ── Network & Routing ──────────────────────────────────────────────────
	nsTool('list_services', 'List Services. Returns name, type, clusterIP, external IPs, and ports.'),
	nsTool('list_endpoints', 'List Endpoints. Returns endpoint subsets for services.'),
	nsTool('list_endpointslices', 'List EndpointSlices. Returns address type, endpoints, and ports.'),
	nsTool('list_ingresses', 'List Ingresses. Returns hosts, paths, TLS config, and ingress class.'),
	{
		name: 'list_ingressclasses',
		description: 'List IngressClasses. Returns controller and default status.',
		parameters: { type: 'object', properties: {} }
	},
	nsTool('list_networkpolicies', 'List NetworkPolicies. Returns pod selector and policy types.'),
	// ── Configuration ──────────────────────────────────────────────────────
	nsTool(
		'list_configmaps',
		'List ConfigMaps. Returns name, namespace, and data key count (not values).'
	),
	nsTool(
		'list_secrets',
		'List Secrets. Returns name, namespace, type, and key count (not values).'
	),
	nsTool('list_resourcequotas', 'List ResourceQuotas. Returns hard limits and current usage.'),
	nsTool('list_limitranges', 'List LimitRanges. Returns limit definitions per resource type.'),
	// ── Storage ────────────────────────────────────────────────────────────
	nsTool(
		'list_pvcs',
		'List PersistentVolumeClaims. Returns status, capacity, access modes, and storage class.'
	),
	{
		name: 'list_persistentvolumes',
		description:
			'List PersistentVolumes. Returns capacity, access modes, reclaim policy, and bound claim.',
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'list_storageclasses',
		description: 'List StorageClasses. Returns provisioner, reclaim policy, and default status.',
		parameters: { type: 'object', properties: {} }
	},
	// ── Access Control ─────────────────────────────────────────────────────
	nsTool('list_serviceaccounts', 'List ServiceAccounts. Returns name, namespace, and secret counts.'),
	nsTool('list_roles', 'List Roles. Returns name, namespace, and rule count.'),
	{
		name: 'list_clusterroles',
		description: 'List ClusterRoles. Returns name and rule count.',
		parameters: { type: 'object', properties: {} }
	},
	nsTool('list_rolebindings', 'List RoleBindings. Returns role reference and subjects.'),
	{
		name: 'list_clusterrolebindings',
		description: 'List ClusterRoleBindings. Returns role reference and subjects.',
		parameters: { type: 'object', properties: {} }
	},
	// ── Resource inspector ──────────────────────────────────────────────────
	{
		name: 'get_resource',
		description:
			'Fetch the full live spec of a specific Kubernetes resource by kind and name. ' +
			'Returns spec (resources/limits, env vars, volumes, probes), status, and labels. ' +
			'Use this whenever the user asks about a specific named pod, deployment, statefulset, service, etc.',
		parameters: {
			type: 'object',
			properties: {
				kind: {
					type: 'string',
					enum: [
						'pod', 'deployment', 'statefulset', 'daemonset', 'replicaset',
						'job', 'cronjob', 'service', 'configmap', 'pvc', 'ingress'
					],
					description: 'The resource kind to fetch.'
				},
				namespace: { type: 'string', description: 'Namespace the resource is in.' },
				name: { type: 'string', description: 'The exact resource name.' }
			},
			required: ['kind', 'namespace', 'name']
		}
	}
];

/**
 * Core tools sent on every request — kept minimal to save tokens.
	* Full TOOL_DEFINITIONS available via { tools: TOOL_DEFINITIONS } in CallAiOptions.
 */
export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
	nsTool('list_pods', 'List pods with status and restarts.'),
	nsTool('list_pod_metrics', 'List pod CPU and memory usage.'),
	{
		name: 'get_resource',
		description:
			'Fetch the full live spec of a named resource (pod, deployment, statefulset, service …). ' +
			'Returns resources/limits, env vars, volumes, probes. Use when the user mentions a specific resource name.',
		parameters: {
			type: 'object',
			properties: {
				kind: {
					type: 'string',
					enum: ['pod','deployment','statefulset','daemonset','replicaset','job','cronjob','service','configmap','pvc','ingress']
				},
				namespace: { type: 'string' },
				name: { type: 'string' }
			},
			required: ['kind', 'namespace', 'name']
		}
	},
	{
		name: 'list_nodes',
		description: 'List nodes with status and capacity.',
		parameters: { type: 'object', properties: {} }
	},
	nsTool('list_deployments', 'List Deployments with replica status.'),
	{
		name: 'list_events',
		description: 'List events. Use type="Warning" for errors.',
		parameters: {
			type: 'object',
			properties: {
				namespace: { type: 'string', description: 'Namespace or "all".' },
				type: { type: 'string', enum: ['Warning', 'Normal', 'all'] }
			},
			required: ['namespace']
		}
	},
	{
		name: 'get_pod_logs',
		description: 'Fetch recent log lines from a pod.',
		parameters: {
			type: 'object',
			properties: {
				namespace: { type: 'string' },
				pod: { type: 'string' },
				container: { type: 'string' },
				tailLines: { type: 'number' }
			},
			required: ['namespace', 'pod']
		}
	},
	nsTool('list_services', 'List Services with type and ports.'),
	nsTool('list_ingresses', 'List Ingresses with hosts and addresses.'),
	nsTool('list_statefulsets', 'List StatefulSets with replica status.'),
	nsTool('list_pvcs', 'List PersistentVolumeClaims with status and capacity.')
];

// ── Tool Result Cache (30s TTL) ─────────────────────────────────────────────

const _toolCache = new Map<string, { data: string; exp: number }>();

function _cacheKey(clusterId: number, name: string, args: Record<string, unknown>): string {
	return `${clusterId}:${name}:${JSON.stringify(args)}`;
}

function _cacheGet(key: string): string | null {
	const entry = _toolCache.get(key);
	if (!entry) return null;
	if (Date.now() > entry.exp) { _toolCache.delete(key); return null; }
	return entry.data;
}

function _cacheSet(key: string, data: string): void {
	if (_toolCache.size > 100) {
		const now = Date.now();
		for (const [k, v] of _toolCache) if (now > v.exp) _toolCache.delete(k);
	}
	_toolCache.set(key, { data, exp: Date.now() + 30_000 });
}

// ── Keyword Tool Selector ────────────────────────────────────────────────────

/**
 * Select a minimal relevant subset of CORE_TOOL_DEFINITIONS based on the user message.
 * Reduces tool-definition tokens from ~1000 to ~200-500 per request.
 */
export function selectToolsForMessage(message: string): ToolDefinition[] {
	const m = message.toLowerCase();
	const include = new Set<string>();

	// Always include get_resource — handles any specific named resource
	include.add('get_resource');

	if (/\bpod|container|crash|restart|oom|evict|log|running|stuck\b/.test(m)) {
		include.add('list_pods');
		include.add('get_pod_logs');
	}
	if (/\bcpu|memory|metric|usage|consum|resource limit\b/.test(m)) {
		include.add('list_pod_metrics');
		include.add('list_pods');
	}
	if (/\bnode|capacity|taint|drain|master|worker\b/.test(m)) {
		include.add('list_nodes');
	}
	if (/\bevent|warning|error|issue|problem|fail|why\b/.test(m)) {
		include.add('list_events');
	}
	if (/\bservice|svc|endpoint|port\b/.test(m)) {
		include.add('list_services');
	}
	if (/\bingress|route|host|domain|tls|ssl\b/.test(m)) {
		include.add('list_ingresses');
	}
	if (/\bdeploy|deployment|rollout\b/.test(m)) {
		include.add('list_deployments');
	}
	if (/\bstatefulset|sts\b/.test(m)) {
		include.add('list_statefulsets');
	}
	if (/\bpvc|volume|storage|disk|bound|claim\b/.test(m)) {
		include.add('list_pvcs');
	}
	// Generic health / overview questions — use broader set
	if (include.size <= 1 || /\bhealthy|health|overall|overview|status|all\b/.test(m)) {
		include.add('list_pods');
		include.add('list_events');
		include.add('list_nodes');
		include.add('list_deployments');
	}

	return CORE_TOOL_DEFINITIONS.filter((t) => include.has(t.name));
}

// ── Format Converters ────────────────────────────────────────────────────────

function toOpenAITools(tools: ToolDefinition[]) {
	return tools.map((t) => ({
		type: 'function',
		function: { name: t.name, description: t.description, parameters: t.parameters }
	}));
}

function toAnthropicTools(tools: ToolDefinition[]) {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.parameters
	}));
}

// ── Tool Executor ────────────────────────────────────────────────────────────

/** Public entry point — adds 30s result caching for all list_ tools. */
export async function executeTool(
	name: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	args: Record<string, any>,
	clusterId: number
): Promise<string> {
	const cacheable = name.startsWith('list_');
	if (cacheable) {
		const key = _cacheKey(clusterId, name, args);
		const hit = _cacheGet(key);
		if (hit) return hit;
	}
	const result = await _execTool(name, args, clusterId);
	if (cacheable && !result.startsWith('Error')) {
		_cacheSet(_cacheKey(clusterId, name, args), result);
	}
	return result;
}

async function _execTool(
	name: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	args: Record<string, any>,
	clusterId: number
): Promise<string> {
	const ns = args.namespace || 'all';
	try {
		// ── Workloads ───────────────────────────────────────────────────────
		if (name === 'list_pods') {
			const result = await listPods(clusterId, ns);
			if (!result.success) return `Error: ${result.error}`;
			const allPods = result.pods ?? [];
			// Healthy pods: compact (name, ns, phase, restarts only). Unhealthy: full detail.
			const items = allPods.map((p) => {
				const unhealthy = p.phase !== 'Running' || (p.restarts ?? 0) >= 3;
				if (!unhealthy) return { name: p.name, namespace: p.namespace, phase: p.phase, restarts: p.restarts };
				return {
					name: p.name,
					namespace: p.namespace,
					status: p.status,
					phase: p.phase,
					ready: p.ready,
					restarts: p.restarts,
					node: p.node,
					containers: p.containers?.map((c) => ({ name: c.name, state: c.state, restartCount: c.restartCount }))
				};
			});
			const unhealthyCount = allPods.filter((p) => p.phase !== 'Running' || (p.restarts ?? 0) >= 3).length;
			return JSON.stringify({ total: allPods.length, unhealthy: unhealthyCount, pods: items });
		}
		if (name === 'list_pod_metrics')
			// No container breakdown — saves ~2x tokens. Pod-level metrics are sufficient for most queries.
			return sim(await listPodMetrics(clusterId, ns), 'metrics', (m) => ({
				name: m.name,
				namespace: m.namespace,
				cpu: m.cpu,
				memory: m.memory
			}));
		if (name === 'list_nodes') {
			const result = await listNodes(clusterId);
			if (!result.success) return `Error: ${result.error}`;
			const items = (result.nodes ?? []).map((n) => {
				const base = { name: n.name, status: n.status, roles: n.roles, version: n.version, cpuCapacity: n.cpuCapacity, memoryCapacity: n.memoryCapacity };
				// Only include conditions if node is not Ready (saves tokens for healthy nodes)
				const notReady = n.conditions?.some((c: { type: string; status: string }) => c.type === 'Ready' && c.status !== 'True');
				if (!notReady) return base;
				return { ...base, conditions: n.conditions?.filter((c: { type: string; status: string }) => c.status !== 'True' || c.type === 'Ready') };
			});
			return JSON.stringify({ total: items.length, nodes: items });
		}
		if (name === 'list_deployments') {
			const dResult = await listDeployments(clusterId, ns);
			if (!dResult.success) return `Error: ${dResult.error}`;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const deploys = (dResult.deployments ?? [] as any[]).map((d: any) => {
				const healthy = d.ready && d.readyReplicas === d.replicas;
				if (healthy) return { name: d.name, namespace: d.namespace, replicas: d.replicas, ready: true };
				return {
					name: d.name,
					namespace: d.namespace,
					ready: d.ready,
					replicas: d.replicas,
					readyReplicas: d.readyReplicas,
					availableReplicas: d.availableReplicas,
					strategy: d.strategy,
					createdAt: d.createdAt,
					conditions: d.conditions?.filter((c: { status: string }) => c.status !== 'True')
						.map((c: { type: string; status: string; message?: string }) => ({ type: c.type, status: c.status, message: c.message }))
				};
			});
			return JSON.stringify({ total: deploys.length, deployments: deploys });
		}
		if (name === 'list_daemonsets')
			return sim(await listDaemonSets(clusterId, ns), 'daemonSets', (d) => ({
				name: d.name,
				namespace: d.namespace,
				desired: d.desired,
				current: d.current,
				ready: d.ready,
				upToDate: d.upToDate,
				available: d.available,
				createdAt: d.createdAt
			}));
		if (name === 'list_statefulsets')
			return sim(await listStatefulSets(clusterId, ns), 'statefulSets', (s) => ({
				name: s.name,
				namespace: s.namespace,
				ready: s.ready,
				replicas: s.replicas,
				readyReplicas: s.readyReplicas,
				serviceName: s.serviceName,
				createdAt: s.createdAt
			}));
		if (name === 'list_replicasets')
			return sim(await listReplicaSets(clusterId, ns), 'replicaSets', (r) => ({
				name: r.name,
				namespace: r.namespace,
				desired: r.desired,
				current: r.current,
				ready: r.ready,
				createdAt: r.createdAt
			}));
		if (name === 'list_jobs')
			return sim(await listJobs(clusterId, ns), 'jobs', (j) => ({
				name: j.name,
				namespace: j.namespace,
				completions: j.completions,
				succeeded: j.succeeded,
				failed: j.failed,
				active: j.active,
				duration: j.duration,
				createdAt: j.createdAt
			}));
		if (name === 'list_cronjobs')
			return sim(await listCronJobs(clusterId, ns), 'cronJobs', (c) => ({
				name: c.name,
				namespace: c.namespace,
				schedule: c.schedule,
				suspend: c.suspend,
				active: c.active,
				lastSchedule: c.lastSchedule,
				createdAt: c.createdAt
			}));
		if (name === 'list_hpas')
			return sim(await listHorizontalPodAutoscalers(clusterId, ns), 'hpas', (h) => ({
				name: h.name,
				namespace: h.namespace,
				reference: h.reference,
				minPods: h.minPods,
				maxPods: h.maxPods,
				currentReplicas: h.currentReplicas,
				desiredReplicas: h.desiredReplicas,
				createdAt: h.createdAt
			}));
		if (name === 'list_namespaces')
			return sim(await listNamespaces(clusterId), 'namespaces', (n) => ({
				name: n.name,
				status: n.status
			}));
		if (name === 'list_events') {
			const result = await listEvents(clusterId, ns);
			if (!result.success) return `Error: ${result.error}`;
			let events = result.events ?? [];
			// Default to Warning-only unless caller explicitly requests 'all' or 'Normal'
			const typeFilter = args.type && args.type !== 'all' ? args.type : 'Warning';
			const filtered = typeFilter !== 'all' ? events.filter((e) => e.type === typeFilter) : events;
			const recent = filtered
				.slice(-15) // cap at 15 events (was 50)
				.map((e) => ({
					reason: e.reason,
					namespace: e.namespace,
					name: e.name,
					message: typeof e.message === 'string' ? e.message.slice(0, 150) : e.message, // truncate long messages
					count: e.count,
					lastSeen: e.lastSeen
				}));
			return JSON.stringify({ totalWarnings: filtered.length, events: recent });
		}
		if (name === 'get_pod_logs') {
			const clusterRow = await findCluster(clusterId);
			if (!clusterRow) return 'Cluster not found.';
			let config;
			try {
				config = buildConnectionConfig({
					...clusterRow,
					authType: clusterRow.authType ?? undefined
				});
			} catch (e) {
				return `Failed to connect to cluster: ${e instanceof Error ? e.message : String(e)}`;
			}
			const podNs = args.namespace || 'default';
			const pod = args.pod as string;
			if (!pod) return 'Pod name is required.';
			const tail = args.tailLines ? parseInt(String(args.tailLines)) : 100;
			const qs = new URLSearchParams({ tailLines: String(tail), timestamps: 'true' });
			if (args.container) qs.set('container', String(args.container));
			const logPath = `/api/v1/namespaces/${encodeURIComponent(podNs)}/pods/${encodeURIComponent(pod)}/log?${qs.toString()}`;
			try {
				const raw = await k8sRequest<string>(config, logPath, 20_000);
				const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
				const lines = text.split('\n').filter(Boolean);
				if (!lines.length) return 'No logs found (pod may not have started yet).';
				return JSON.stringify({ pod, namespace: podNs, lineCount: lines.length, logs: lines });
			} catch (e) {
				return `Error fetching logs: ${e instanceof Error ? e.message : String(e)}`;
			}
		}

		// ── Network & Routing ───────────────────────────────────────────────
		if (name === 'list_services')
			return sim(await listServices(clusterId, ns), 'services', (s) => ({
				name: s.name,
				namespace: s.namespace,
				type: s.type,
				clusterIP: s.clusterIP,
				externalIPs: s.externalIPs,
				ports: s.ports?.map(
					(p: { port: number; protocol: string; targetPort: string | number }) => ({
						port: p.port,
						protocol: p.protocol,
						targetPort: p.targetPort
					})
				)
			}));
		if (name === 'list_endpoints')
			return sim(await listEndpoints(clusterId, ns), 'endpoints', (e) => ({
				name: e.name,
				namespace: e.namespace,
				subsets: e.subsets,
				createdAt: e.createdAt
			}));
		if (name === 'list_endpointslices')
			return sim(await listEndpointSlices(clusterId, ns), 'endpointSlices', (e) => ({
				name: e.name,
				namespace: e.namespace,
				addressType: e.addressType,
				endpoints: e.endpoints,
				ports: e.ports,
				createdAt: e.createdAt
			}));
		if (name === 'list_ingresses')
			return sim(await listIngresses(clusterId, ns), 'ingresses', (i) => ({
				name: i.name,
				namespace: i.namespace,
				hosts: i.hosts,
				ingressClass: i.ingressClass,
				addresses: i.addresses,
				paths: i.paths?.map((p: { host: string; path: string; backend: string }) => ({
					host: p.host,
					path: p.path,
					backend: p.backend
				}))
			}));
		if (name === 'list_ingressclasses')
			return sim(await listIngressClasses(clusterId), 'ingressClasses', (i) => ({
				name: i.name,
				controller: i.controller,
				isDefault: i.isDefault,
				createdAt: i.createdAt
			}));
		if (name === 'list_networkpolicies')
			return sim(await listNetworkPolicies(clusterId, ns), 'networkPolicies', (n) => ({
				name: n.name,
				namespace: n.namespace,
				podSelector: n.podSelector,
				policyTypes: n.policyTypes,
				createdAt: n.createdAt
			}));

		// ── Configuration ───────────────────────────────────────────────────
		if (name === 'list_configmaps')
			return sim(await listConfigMaps(clusterId, ns), 'configMaps', (c) => ({
				name: c.name,
				namespace: c.namespace,
				dataCount: c.dataCount,
				createdAt: c.createdAt
			}));
		if (name === 'list_secrets')
			return sim(await listSecrets(clusterId, ns), 'secrets', (s) => ({
				name: s.name,
				namespace: s.namespace,
				type: s.type,
				dataCount: s.dataCount,
				createdAt: s.createdAt
			}));
		if (name === 'list_resourcequotas')
			return sim(await listResourceQuotas(clusterId, ns), 'resourceQuotas', (r) => ({
				name: r.name,
				namespace: r.namespace,
				hard: r.hard,
				used: r.used,
				createdAt: r.createdAt
			}));
		if (name === 'list_limitranges')
			return sim(await listLimitRanges(clusterId, ns), 'limitRanges', (l) => ({
				name: l.name,
				namespace: l.namespace,
				limits: l.limits,
				createdAt: l.createdAt
			}));

		// ── Storage ─────────────────────────────────────────────────────────
		if (name === 'list_pvcs')
			return sim(await listPersistentVolumeClaims(clusterId, ns), 'persistentVolumeClaims', (p) => ({
				name: p.name,
				namespace: p.namespace,
				status: p.status,
				volume: p.volume,
				capacity: p.capacity,
				accessModes: p.accessModes,
				storageClass: p.storageClass,
				createdAt: p.createdAt
			}));
		if (name === 'list_persistentvolumes')
			return sim(await listPersistentVolumes(clusterId), 'persistentVolumes', (p) => ({
				name: p.name,
				capacity: p.capacity,
				accessModes: p.accessModes,
				reclaimPolicy: p.reclaimPolicy,
				status: p.status,
				claim: p.claim,
				storageClass: p.storageClass,
				createdAt: p.createdAt
			}));
		if (name === 'list_storageclasses')
			return sim(await listStorageClasses(clusterId), 'storageClasses', (s) => ({
				name: s.name,
				provisioner: s.provisioner,
				reclaimPolicy: s.reclaimPolicy,
				volumeBindingMode: s.volumeBindingMode,
				allowVolumeExpansion: s.allowVolumeExpansion,
				isDefault: s.isDefault,
				createdAt: s.createdAt
			}));

		// ── Access Control ──────────────────────────────────────────────────
		if (name === 'list_serviceaccounts')
			return sim(await listServiceAccounts(clusterId, ns), 'serviceAccounts', (s) => ({
				name: s.name,
				namespace: s.namespace,
				secrets: s.secrets,
				imagePullSecrets: s.imagePullSecrets,
				createdAt: s.createdAt
			}));
		if (name === 'list_roles')
			return sim(await listRoles(clusterId, ns), 'roles', (r) => ({
				name: r.name,
				namespace: r.namespace,
				ruleCount: r.rules?.length ?? 0,
				createdAt: r.createdAt
			}));
		if (name === 'list_clusterroles')
			return sim(await listClusterRoles(clusterId), 'clusterRoles', (r) => ({
				name: r.name,
				ruleCount: r.rules?.length ?? 0,
				createdAt: r.createdAt
			}));
		if (name === 'list_rolebindings')
			return sim(await listRoleBindings(clusterId, ns), 'roleBindings', (r) => ({
				name: r.name,
				namespace: r.namespace,
				roleRef: r.roleRef,
				subjectCount: r.subjects?.length ?? 0,
				subjects: r.subjects,
				createdAt: r.createdAt
			}));
		if (name === 'list_clusterrolebindings')
			return sim(await listClusterRoleBindings(clusterId), 'clusterRoleBindings', (r) => ({
				name: r.name,
				roleRef: r.roleRef,
				subjectCount: r.subjects?.length ?? 0,
				subjects: r.subjects,
				createdAt: r.createdAt
			}));

		if (name === 'get_resource') return getResource(clusterId, args.kind, args.namespace, args.name);

		return `Unknown tool: ${name}`;
	} catch (err) {
		return `Tool execution error: ${err instanceof Error ? err.message : String(err)}`;
	}
}

// ── get_resource helper ───────────────────────────────────────────────────────

/** API path for a namespaced resource kind. */
function resourceApiPath(kind: string, namespace: string, name: string): string | null {
	const n = encodeURIComponent(namespace);
	const r = encodeURIComponent(name);
	switch (kind.toLowerCase()) {
		case 'pod':         return `/api/v1/namespaces/${n}/pods/${r}`;
		case 'deployment':  return `/apis/apps/v1/namespaces/${n}/deployments/${r}`;
		case 'statefulset': return `/apis/apps/v1/namespaces/${n}/statefulsets/${r}`;
		case 'daemonset':   return `/apis/apps/v1/namespaces/${n}/daemonsets/${r}`;
		case 'replicaset':  return `/apis/apps/v1/namespaces/${n}/replicasets/${r}`;
		case 'job':         return `/apis/batch/v1/namespaces/${n}/jobs/${r}`;
		case 'cronjob':     return `/apis/batch/v1/namespaces/${n}/cronjobs/${r}`;
		case 'service':     return `/api/v1/namespaces/${n}/services/${r}`;
		case 'configmap':   return `/api/v1/namespaces/${n}/configmaps/${r}`;
		case 'pvc':         return `/api/v1/namespaces/${n}/persistentvolumeclaims/${r}`;
		case 'ingress':     return `/apis/networking.k8s.io/v1/namespaces/${n}/ingresses/${r}`;
		default:            return null;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContainerDiagnostics(containers: any[]) {
	if (!Array.isArray(containers)) return [];
	return containers.map((c) => ({
		name: c.name,
		image: c.image,
		resources: c.resources ?? {},
		env: (c.env ?? []).map((e: { name: string; value?: string; valueFrom?: unknown }) => ({
			name: e.name,
			value: e.value ?? (e.valueFrom ? '<from ref>' : undefined)
		})),
		livenessProbe: c.livenessProbe ? { httpGet: c.livenessProbe.httpGet, exec: c.livenessProbe.exec, initialDelaySeconds: c.livenessProbe.initialDelaySeconds, failureThreshold: c.livenessProbe.failureThreshold } : undefined,
		readinessProbe: c.readinessProbe ? { httpGet: c.readinessProbe.httpGet, exec: c.readinessProbe.exec } : undefined,
		volumeMounts: (c.volumeMounts ?? []).map((v: { name: string; mountPath: string }) => ({ name: v.name, mountPath: v.mountPath }))
	}));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDiagnostic(kind: string, raw: any): unknown {
	const meta = { name: raw.metadata?.name, namespace: raw.metadata?.namespace, labels: raw.metadata?.labels, annotations: raw.metadata?.annotations };

	switch (kind.toLowerCase()) {
		case 'pod':
			return {
				meta,
				containers: extractContainerDiagnostics(raw.spec?.containers ?? []),
				initContainers: extractContainerDiagnostics(raw.spec?.initContainers ?? []),
				volumes: (raw.spec?.volumes ?? []).map((v: { name: string; persistentVolumeClaim?: unknown; configMap?: unknown; secret?: unknown }) => ({ name: v.name, pvc: v.persistentVolumeClaim, configMap: v.configMap, secret: v.secret })),
				nodeSelector: raw.spec?.nodeSelector,
				containerStatuses: (raw.status?.containerStatuses ?? []).map((s: { name: string; ready: boolean; restartCount: number; state: unknown; lastState: unknown }) => ({ name: s.name, ready: s.ready, restartCount: s.restartCount, state: s.state, lastState: s.lastState })),
				phase: raw.status?.phase,
				conditions: raw.status?.conditions
			};
		case 'deployment':
		case 'statefulset':
		case 'daemonset':
			return {
				meta,
				replicas: raw.spec?.replicas,
				selector: raw.spec?.selector,
				strategy: raw.spec?.strategy ?? raw.spec?.updateStrategy,
				containers: extractContainerDiagnostics(raw.spec?.template?.spec?.containers ?? []),
				initContainers: extractContainerDiagnostics(raw.spec?.template?.spec?.initContainers ?? []),
				volumes: (raw.spec?.template?.spec?.volumes ?? []).map((v: { name: string; persistentVolumeClaim?: unknown; configMap?: unknown }) => ({ name: v.name, pvc: v.persistentVolumeClaim, configMap: v.configMap })),
				volumeClaimTemplates: raw.spec?.volumeClaimTemplates?.map((v: { metadata: { name: string }; spec: unknown }) => ({ name: v.metadata?.name, spec: v.spec })),
				statusReady: `${raw.status?.readyReplicas ?? 0}/${raw.spec?.replicas ?? '?'}`,
				conditions: raw.status?.conditions
			};
		case 'service':
			return { meta, type: raw.spec?.type, clusterIP: raw.spec?.clusterIP, ports: raw.spec?.ports, selector: raw.spec?.selector, loadBalancer: raw.status?.loadBalancer };
		case 'pvc':
			return { meta, storageClass: raw.spec?.storageClassName, accessModes: raw.spec?.accessModes, resources: raw.spec?.resources, volumeName: raw.spec?.volumeName, phase: raw.status?.phase, capacity: raw.status?.capacity };
		case 'ingress':
			return { meta, ingressClass: raw.spec?.ingressClassName, rules: raw.spec?.rules, tls: raw.spec?.tls, loadBalancer: raw.status?.loadBalancer };
		case 'configmap':
			return { meta, keys: Object.keys(raw.data ?? {}) };
		case 'job':
		case 'cronjob':
			return {
				meta,
				schedule: raw.spec?.schedule,
				containers: extractContainerDiagnostics((raw.spec?.jobTemplate?.spec?.template?.spec?.containers ?? raw.spec?.template?.spec?.containers) ?? []),
				status: raw.status
			};
		default:
			return { meta, spec: raw.spec, status: raw.status };
	}
}

async function getResource(clusterId: number, kind: string, namespace: string, name: string): Promise<string> {
	if (!kind) return 'kind is required (pod, deployment, statefulset …)';
	if (!name) return 'name is required.';
	if (!namespace) return 'namespace is required.';

	const path = resourceApiPath(kind, namespace, name);
	if (!path) return `Unsupported kind: ${kind}`;

	const clusterRow = await findCluster(clusterId);
	if (!clusterRow) return 'Cluster not found.';
	let config;
	try {
		config = buildConnectionConfig({ ...clusterRow, authType: clusterRow.authType ?? undefined });
	} catch (e) {
		return `Connection error: ${e instanceof Error ? e.message : String(e)}`;
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = await k8sRequest<any>(config, path, 20_000);
		// Extract only diagnostically relevant fields — avoids dumping full K8s objects
		return JSON.stringify(extractDiagnostic(kind, raw));
	} catch (e) {
		return `Error fetching ${kind} ${name}: ${e instanceof Error ? e.message : String(e)}`;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sim<T extends { success: boolean; error?: string }>(
	result: T,
	key: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mapper: (item: any) => unknown
): string {
	if (!result.success) return `Error: ${result.error}`;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const items = ((result as any)[key] ?? []).map(mapper);
	return JSON.stringify({ total: items.length, [key]: items });
}

// ── Cluster Manifest Builder ─────────────────────────────────────────────────

/**
 * Fetch live cluster state for ALL resource types in parallel and return a compact
 * JSON snapshot injected into the AI system context. Gives the AI immediate
 * cluster awareness without requiring tool calls for basic questions.
 */
export async function buildClusterManifest(clusterId: number): Promise<string> {
	// Fetch core health data in parallel — detailed/RBAC/config resources available via tools
	const [
		namespacesR,
		nodesR,
		podsR,
		podMetricsR,
		deploymentsR,
		daemonSetsR,
		statefulSetsR,
		jobsR,
		cronJobsR,
		hpasR,
		servicesR,
		ingressesR,
		pvcsR,
		eventsR
	] = await Promise.allSettled([
		listNamespaces(clusterId),
		listNodes(clusterId),
		listPods(clusterId, 'all'),
		listPodMetrics(clusterId, 'all'),
		listDeployments(clusterId, 'all'),
		listDaemonSets(clusterId, 'all'),
		listStatefulSets(clusterId, 'all'),
		listJobs(clusterId, 'all'),
		listCronJobs(clusterId, 'all'),
		listHorizontalPodAutoscalers(clusterId, 'all'),
		listServices(clusterId, 'all'),
		listIngresses(clusterId, 'all'),
		listPersistentVolumeClaims(clusterId, 'all'),
		listEvents(clusterId, 'all')
	]);

	const sections: string[] = ['## Live Cluster Snapshot (health-focused — use tools for full lists)'];

	// ── Namespaces ─────────────────────────────────────────────────────────
	ms(namespacesR, 'namespaces', 'Namespaces', (n) => ({ name: n.name, status: n.status }), sections);

	// ── Nodes ──────────────────────────────────────────────────────────────
	ms(
		nodesR,
		'nodes',
		'Nodes',
		(n) => ({
			name: n.name,
			status: n.status,
			roles: n.roles,
			version: n.version,
			cpuCapacity: n.cpuCapacity,
			memoryCapacity: n.memoryCapacity,
			conditions: n.conditions
				?.filter((c: { type: string; status: string }) => c.status !== 'True' || c.type === 'Ready')
				.map((c: { type: string; status: string; message?: string }) => ({
					type: c.type,
					status: c.status,
					message: c.message
				}))
		}),
		sections
	);

	// ── Pods: full list but compact — container detail only for unhealthy ──
	if (podsR.status === 'fulfilled' && podsR.value.success) {
		const allPods = podsR.value.pods ?? [];
		const healthy = allPods.filter((p) => p.phase === 'Running' && (p.restarts ?? 0) < 5);
		const unhealthy = allPods.filter((p) => p.phase !== 'Running' || (p.restarts ?? 0) >= 5);

		const items = [
			// Summary line for healthy pods to save tokens
			...(healthy.length
				? [{ _summary: `${healthy.length} Running pods (low restarts) — use list_pods tool for details` }]
				: []),
			// Full detail for unhealthy pods
			...unhealthy.map((p) => ({
				name: p.name,
				namespace: p.namespace,
				status: p.status,
				phase: p.phase,
				ready: p.ready,
				restarts: p.restarts,
				node: p.node,
				containers: p.containers?.map((c: { name: string; state: string; restartCount: number }) => ({
					name: c.name,
					state: c.state,
					restartCount: c.restartCount
				}))
			}))
		];
		sections.push(msection(`Pods (${allPods.length} total, ${unhealthy.length} unhealthy)`, items));
	}

	// ── Pod metrics: only top consumers, not full list ─────────────────────
	if (podMetricsR.status === 'fulfilled') {
		if (podMetricsR.value.success) {
			const allMetrics = podMetricsR.value.metrics ?? [];
			const topCpu = [...allMetrics]
				.sort((a, b) => parseCpuMillicores(b.cpu) - parseCpuMillicores(a.cpu))
				.slice(0, 5)
				.map((m) => ({
					name: m.name,
					namespace: m.namespace,
					cpu: m.cpu,
					memory: m.memory
				}));

			const topMemory = [...allMetrics]
				.sort((a, b) => parseMemoryMi(b.memory) - parseMemoryMi(a.memory))
				.slice(0, 5)
				.map((m) => ({
					name: m.name,
					namespace: m.namespace,
					cpu: m.cpu,
					memory: m.memory
				}));

			sections.push(
				msection('Pod Metrics Summary', [
					{ _summary: `${allMetrics.length} pods have metrics available` },
					{ topCpu },
					{ topMemory }
				])
			);
		} else {
			sections.push(
				msection('Pod Metrics Summary', [
					{ _summary: `Metrics unavailable: ${podMetricsR.value.error ?? 'metrics-server not installed'}` }
				])
			);
		}
	}

	// ── Workloads: only show not-fully-ready + count summary ──────────────
	if (deploymentsR.status === 'fulfilled' && deploymentsR.value.success) {
		const all = deploymentsR.value.deployments ?? [];
		const notReady = all.filter((d) => (d.readyReplicas ?? 0) < (d.replicas ?? 0));
		const items = [
			{ _summary: `${all.length} total deployments, ${all.length - notReady.length} healthy` },
			...notReady.map((d) => ({
				name: d.name,
				namespace: d.namespace,
				ready: d.ready,
				replicas: d.replicas,
				readyReplicas: d.readyReplicas,
				availableReplicas: d.availableReplicas
			}))
		];
		sections.push(msection(`Deployments (${all.length} total)`, items));
	}

	if (daemonSetsR.status === 'fulfilled' && daemonSetsR.value.success) {
		const all = daemonSetsR.value.daemonSets ?? [];
		const notReady = all.filter((d) => (d.ready ?? 0) < (d.desired ?? 0));
		if (all.length > 0) {
			const items = [
				{ _summary: `${all.length} total, ${all.length - notReady.length} healthy` },
				...notReady.map((d) => ({
					name: d.name,
					namespace: d.namespace,
					desired: d.desired,
					current: d.current,
					ready: d.ready,
					available: d.available
				}))
			];
			sections.push(msection(`DaemonSets (${all.length} total)`, items));
		}
	}

	if (statefulSetsR.status === 'fulfilled' && statefulSetsR.value.success) {
		const all = statefulSetsR.value.statefulSets ?? [];
		const notReady = all.filter((s) => (s.readyReplicas ?? 0) < (s.replicas ?? 0));
		if (all.length > 0) {
			const items = [
				{ _summary: `${all.length} total, ${all.length - notReady.length} healthy` },
				...notReady.map((s) => ({
					name: s.name,
					namespace: s.namespace,
					replicas: s.replicas,
					readyReplicas: s.readyReplicas
				}))
			];
			sections.push(msection(`StatefulSets (${all.length} total)`, items));
		}
	}

	// Jobs: only active/failed
	if (jobsR.status === 'fulfilled' && jobsR.value.success) {
		const all = jobsR.value.jobs ?? [];
		const notable = all.filter((j) => (j.active ?? 0) > 0 || (j.failed ?? 0) > 0);
		if (notable.length > 0) {
			sections.push(
				msection(
					`Jobs with Issues (${notable.length} of ${all.length})`,
					notable.map((j) => ({
						name: j.name,
						namespace: j.namespace,
						active: j.active,
						failed: j.failed,
						succeeded: j.succeeded
					}))
				)
			);
		}
	}

	// CronJobs: compact summary
	ms(
		cronJobsR,
		'cronJobs',
		'CronJobs',
		(c) => ({
			name: c.name,
			namespace: c.namespace,
			schedule: c.schedule,
			suspend: c.suspend,
			active: c.active,
			lastSchedule: c.lastSchedule
		}),
		sections
	);

	// HPAs: all (usually few)
	ms(
		hpasR,
		'hpas',
		'HorizontalPodAutoscalers',
		(h) => ({
			name: h.name,
			namespace: h.namespace,
			reference: h.reference,
			minPods: h.minPods,
			maxPods: h.maxPods,
			currentReplicas: h.currentReplicas,
			desiredReplicas: h.desiredReplicas
		}),
		sections
	);

	// ── Network & Routing (compact) ────────────────────────────────────────
	if (servicesR.status === 'fulfilled' && servicesR.value.success) {
		const all = servicesR.value.services ?? [];
		// Only show non-ClusterIP (LoadBalancer/NodePort/ExternalName) and cap at 30
		const notable = all
			.filter((s) => s.type !== 'ClusterIP')
			.slice(0, 30)
			.map((s) => ({ name: s.name, namespace: s.namespace, type: s.type, externalIPs: s.externalIPs }));
		sections.push(
			msection(
				`Services (${all.length} total, ${notable.length} external shown)`,
				notable.length
					? notable
					: [{ _summary: `${all.length} ClusterIP services — use list_services tool for details` }]
			)
		);
	}

	ms(
		ingressesR,
		'ingresses',
		'Ingresses',
		(i) => ({ name: i.name, namespace: i.namespace, hosts: i.hosts, addresses: i.addresses }),
		sections
	);

	// ── Storage: only non-Bound PVCs ──────────────────────────────────────
	if (pvcsR.status === 'fulfilled' && pvcsR.value.success) {
		const all = pvcsR.value.persistentVolumeClaims ?? [];
		const notBound = all.filter((p) => p.status !== 'Bound');
		if (notBound.length > 0) {
			sections.push(
				msection(
					`PVC Issues (${notBound.length} of ${all.length} not Bound)`,
					notBound.map((p) => ({
						name: p.name,
						namespace: p.namespace,
						status: p.status,
						capacity: p.capacity,
						storageClass: p.storageClass
					}))
				)
			);
		} else if (all.length > 0) {
			sections.push(
				msection('PersistentVolumeClaims', [
					{ _summary: `${all.length} PVCs, all Bound — use list_pvcs tool for details` }
				])
			);
		}
	}

	// ── Warning Events (recent 20) ─────────────────────────────────────────
	if (eventsR.status === 'fulfilled' && eventsR.value.success) {
		const warnings = (eventsR.value.events ?? [])
			.filter((e) => e.type === 'Warning')
			.slice(-20)
			.map((e) => ({
				reason: e.reason,
				namespace: e.namespace,
				name: e.name,
				message: e.message,
				count: e.count,
				lastSeen: e.lastSeen
			}));
		if (warnings.length > 0) sections.push(msection('Warning Events (recent 20)', warnings));
	}

	sections.push(
		'\n> Use tools (list_pods, list_deployments, list_services, etc.) to fetch full resource lists.'
	);

	return sections.join('\n\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ms<T extends { success: boolean }>(
	result: PromiseSettledResult<T>,
	key: string,
	title: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mapper: (item: any) => unknown,
	sections: string[]
): void {
	if (result.status !== 'fulfilled' || !result.value.success) return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const items = ((result.value as any)[key] ?? []).map(mapper);
	sections.push(msection(title, items));
}

function msection(title: string, items: unknown[]): string {
	return `### ${title} (${items.length})\n\`\`\`json\n${JSON.stringify(items)}\n\`\`\``;
}

function parseCpuMillicores(value: string): number {
	if (!value) return 0;
	if (value.endsWith('m')) return Number.parseInt(value.slice(0, -1), 10) || 0;
	return (Number.parseFloat(value) || 0) * 1000;
}

function parseMemoryMi(value: string): number {
	if (!value) return 0;
	if (value.endsWith('Mi')) return Number.parseInt(value.slice(0, -2), 10) || 0;
	if (value.endsWith('Gi')) return (Number.parseFloat(value.slice(0, -2)) || 0) * 1024;
	if (value.endsWith('Ki')) return (Number.parseFloat(value.slice(0, -2)) || 0) / 1024;
	return Number.parseFloat(value) || 0;
}

// ── Provider Resolution ──────────────────────────────────────────────────────

export async function resolveProvider(providerId?: number): Promise<AiProvider | null> {
	const p = providerId ? await getAiProviderWithKey(providerId) : await getDefaultProvider();
	return p ?? null;
}

// ── Unified AI Caller ────────────────────────────────────────────────────────

export interface CallAiOptions {
	/** If set, tools are enabled and executed against this cluster. */
	clusterId?: number;
	/**
	 * Override which tools to expose.
	 * Defaults to keyword-selected subset of CORE_TOOL_DEFINITIONS.
	 * Pass TOOL_DEFINITIONS for the full 30-tool set.
	 */
	tools?: ToolDefinition[];
	/** Max tool-call iterations before giving up. Default 5. */
	maxIterations?: number;
	/**
	 * Auto-select tools from CORE_TOOL_DEFINITIONS based on message keywords.
	 * Enabled by default — set to false to use `tools` as-is.
	 */
	autoSelectTools?: boolean;
}

/**
 * Call an AI provider with optional tool-calling support.
 * Handles both OpenAI-compatible and Anthropic providers transparently.
 */
export async function callAI(
	provider: AiProvider,
	messages: AiMessage[],
	options: CallAiOptions = {}
): Promise<string> {
	const { clusterId, maxIterations = 5, autoSelectTools = true } = options;
	const useTools = !!clusterId;

	// Auto-select minimal relevant tools from last user message unless overridden
	let tools: ToolDefinition[] = options.tools ?? CORE_TOOL_DEFINITIONS;
	if (useTools && autoSelectTools && !options.tools) {
		const lastUser = [...messages].reverse().find((m) => m.role === 'user');
		if (lastUser) tools = selectToolsForMessage(lastUser.content);
	}

	if (provider.provider === 'anthropic') {
		return callAnthropic(provider, messages, useTools ? tools : [], clusterId, maxIterations);
	}

	const baseUrl =
		provider.baseUrl?.replace(/\/$/, '') ??
		(provider.provider === 'openai' ? 'https://api.openai.com' : 'https://openrouter.ai/api');
	return callOpenAI(provider, baseUrl, messages, useTools ? tools : [], clusterId, maxIterations);
}

// ── Internal: OpenAI ─────────────────────────────────────────────────────────

async function callOpenAI(
	provider: AiProvider,
	baseUrl: string,
	messages: AiMessage[],
	tools: ToolDefinition[],
	clusterId: number | undefined,
	maxIterations: number
): Promise<string> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const conversation: any[] = [...messages];

	for (let i = 0; i < maxIterations; i++) {
		const body: Record<string, unknown> = {
			model: provider.model,
			messages: conversation,
			temperature: 0.4,
			max_tokens: 1000
		};
		if (tools.length) {
			body.tools = toOpenAITools(tools);
			body.tool_choice = 'auto';
		}

		const res = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${provider.apiKey}`
			},
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(`Provider returned ${res.status}: ${await res.text()}`);

		const data = await res.json();
		const msg = data.choices?.[0]?.message;

		if (!msg?.tool_calls?.length) return msg?.content ?? '';

		conversation.push(msg);
		for (const tc of msg.tool_calls) {
			const tArgs = JSON.parse(tc.function.arguments || '{}');
			const result = await executeTool(tc.function.name, tArgs, clusterId!);
			conversation.push({ role: 'tool', tool_call_id: tc.id, content: result });
		}
	}

	return 'Max tool iterations reached.';
}

// ── Internal: Anthropic ──────────────────────────────────────────────────────

async function callAnthropic(
	provider: AiProvider,
	messages: AiMessage[],
	tools: ToolDefinition[],
	clusterId: number | undefined,
	maxIterations: number
): Promise<string> {
	const system = messages.find((m) => m.role === 'system')?.content ?? '';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const conversation: any[] = messages.filter((m) => m.role !== 'system');

	for (let i = 0; i < maxIterations; i++) {
		const body: Record<string, unknown> = {
			model: provider.model,
			max_tokens: 1000,
			system,
			messages: conversation
		};
		if (tools.length) body.tools = toAnthropicTools(tools);

		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': provider.apiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(`Anthropic returned ${res.status}: ${await res.text()}`);

		const data = await res.json();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const toolUseBlocks = (data.content ?? []).filter((b: any) => b.type === 'tool_use');

		if (!toolUseBlocks.length) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (data.content ?? []).find((b: any) => b.type === 'text')?.text ?? '';
		}

		conversation.push({ role: 'assistant', content: data.content });

		const toolResults = await Promise.all(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			toolUseBlocks.map(async (block: any) => {
				const result = await executeTool(block.name, block.input ?? {}, clusterId!);
				return { type: 'tool_result', tool_use_id: block.id, content: result };
			})
		);
		conversation.push({ role: 'user', content: toolResults });
	}

	return 'Max tool iterations reached.';
}
