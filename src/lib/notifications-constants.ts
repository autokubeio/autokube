/**
 * Notification constants shared between client and server.
 * Keep this file free of any server-only imports.
 */

export const NOTIFICATION_EVENT_TYPES = [
	{
		id: 'cluster_offline',
		label: 'Cluster offline',
		description: 'Cluster became unreachable',
		group: 'system',
		scope: 'cluster'
	},
	{
		id: 'cluster_online',
		label: 'Cluster online',
		description: 'Cluster came back online',
		group: 'system',
		scope: 'cluster'
	},
	{
		id: 'license_expiring',
		label: 'License expiring',
		description: 'Enterprise license expiring soon (global)',
		group: 'system',
		scope: 'system'
	}
] as const;

export const NOTIFICATION_EVENT_GROUPS = [
	{ id: 'security', label: 'Security events' },
	{ id: 'system', label: 'System events' }
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]['id'];

// ── Per-cluster notification config (NotifGroups) ───────────────────────────

/** Metadata for a single notification event toggle */
export interface NotifEventMeta {
	key: string;
	label: string;
	description?: string;
}

/** Metadata for a resource within a group */
export interface NotifResourceMeta {
	key: string;
	label: string;
	events: NotifEventMeta[];
}

/** Metadata for a top-level notification group */
export interface NotifGroupMeta {
	key: keyof NotifGroups;
	label: string;
	icon: string; // lucide icon component name
	/** Pre-built Tailwind classes so dynamic color interpolation is avoided (Tailwind v4 compat) */
	classes: {
		headerBg: string;
		iconColor: string;
		textColor: string;
		badgeBg: string;
		badgeText: string;
	};
	resources: NotifResourceMeta[];
}

/**
 * Declarative metadata for all notification groups, resources and events.
 * Drives both the UI rendering and acts as a source of truth for labels/descriptions.
 */
export const NOTIF_GROUP_META: NotifGroupMeta[] = [
	{
		key: 'workload',
		label: 'Workload',
		icon: 'Layers',
		classes: {
			headerBg: 'bg-blue-500/5',
			iconColor: 'text-blue-500',
			textColor: 'text-blue-600 dark:text-blue-400',
			badgeBg: 'bg-blue-500/10',
			badgeText: 'text-blue-600 dark:text-blue-400'
		},
		resources: [
			{
				key: 'pods',
				label: 'Pods',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'phaseChange', label: 'Phase change', description: 'Pending → Running → Failed → Succeeded' }
				]
			},
			{
				key: 'deployments',
				label: 'Deployments',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'scaled', label: 'Scaled' },
					{ key: 'rollout', label: 'Rollout', description: 'Progress, paused or failed' }
				]
			},
			{
				key: 'daemonsets',
				label: 'DaemonSets',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'rollout', label: 'Rollout', description: 'Update applied across nodes' }
				]
			},
			{
				key: 'statefulsets',
				label: 'StatefulSets',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'scaled', label: 'Scaled' }
				]
			},
			{
				key: 'replicasets',
				label: 'ReplicaSets',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'scaled', label: 'Scaled' }
				]
			},
			{
				key: 'jobs',
				label: 'Jobs',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'completed', label: 'Completed' },
					{ key: 'failed', label: 'Failed' }
				]
			},
			{
				key: 'cronjobs',
				label: 'CronJobs',
				events: [
					{ key: 'triggered', label: 'Triggered', description: 'Scheduled run started' },
					{ key: 'missed', label: 'Missed', description: 'Scheduled run skipped' },
					{ key: 'suspended', label: 'Suspended' }
				]
			},
			{
				key: 'hpas',
				label: 'Pod Auto Scaling',
				events: [
					{ key: 'scaleUp', label: 'Scale Up' },
					{ key: 'scaleDown', label: 'Scale Down' }
				]
			},
			{
				key: 'nodes',
				label: 'Nodes',
				events: [
					{ key: 'joined', label: 'Joined cluster' },
					{ key: 'removed', label: 'Removed' },
					{ key: 'notReady', label: 'Not Ready', description: 'Node condition changed to NotReady' }
				]
			},
			{
				key: 'namespaces',
				label: 'Namespaces',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'events',
				label: 'Events',
				events: [
					{ key: 'warning', label: 'Warning', description: 'Warning-level events across all resources' }
				]
			}
		]
	},
	{
		key: 'network',
		label: 'Network & Routing',
		icon: 'Globe',
		classes: {
			headerBg: 'bg-emerald-500/5',
			iconColor: 'text-emerald-500',
			textColor: 'text-emerald-600 dark:text-emerald-400',
			badgeBg: 'bg-emerald-500/10',
			badgeText: 'text-emerald-600 dark:text-emerald-400'
		},
		resources: [
			{
				key: 'services',
				label: 'Services',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'updated', label: 'Updated', description: 'Type, ports or selector changed' }
				]
			},
			{
				key: 'endpoints',
				label: 'Endpoints',
				events: [
					{ key: 'updated', label: 'Updated', description: 'Backing pod addresses added or removed' }
				]
			},
			{
				key: 'ingresses',
				label: 'Ingresses',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'updated', label: 'Updated', description: 'Routing rules or TLS config changed' }
				]
			},
			{
				key: 'networkPolicies',
				label: 'Network Policies',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' },
					{ key: 'updated', label: 'Updated', description: 'Traffic policy rules modified' }
				]
			}
		]
	},
	{
		key: 'configuration',
		label: 'Configuration',
		icon: 'Settings2',
		classes: {
			headerBg: 'bg-amber-500/5',
			iconColor: 'text-amber-500',
			textColor: 'text-amber-600 dark:text-amber-400',
			badgeBg: 'bg-amber-500/10',
			badgeText: 'text-amber-600 dark:text-amber-400'
		},
		resources: [
			{
				key: 'configmaps',
				label: 'ConfigMaps',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'updated', label: 'Updated', description: 'Data keys modified' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'secrets',
				label: 'Secrets',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'updated', label: 'Updated', description: 'Secret data changed' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'resourceQuotas',
				label: 'Resource Quotas',
				events: [
					{ key: 'updated', label: 'Updated', description: 'Namespace CPU/memory limits changed' }
				]
			},
			{
				key: 'limitRanges',
				label: 'Limit Ranges',
				events: [
					{ key: 'updated', label: 'Updated', description: 'Container resource constraints modified' }
				]
			}
		]
	},
	{
		key: 'storage',
		label: 'Storage',
		icon: 'HardDrive',
		classes: {
			headerBg: 'bg-purple-500/5',
			iconColor: 'text-purple-500',
			textColor: 'text-purple-600 dark:text-purple-400',
			badgeBg: 'bg-purple-500/10',
			badgeText: 'text-purple-600 dark:text-purple-400'
		},
		resources: [
			{
				key: 'pvcs',
				label: 'PVCs',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'bound', label: 'Bound', description: 'Claim matched to a volume' },
					{ key: 'released', label: 'Released', description: 'Volume detached from claim' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'pvs',
				label: 'Persistent Volumes',
				events: [
					{ key: 'provisioned', label: 'Provisioned' },
					{ key: 'released', label: 'Released' },
					{ key: 'failed', label: 'Failed' }
				]
			},
			{
				key: 'storageClasses',
				label: 'Storage Classes',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' }
				]
			}
		]
	},
	{
		key: 'accessControl',
		label: 'Access Control',
		icon: 'Shield',
		classes: {
			headerBg: 'bg-rose-500/5',
			iconColor: 'text-rose-500',
			textColor: 'text-rose-600 dark:text-rose-400',
			badgeBg: 'bg-rose-500/10',
			badgeText: 'text-rose-600 dark:text-rose-400'
		},
		resources: [
			{
				key: 'serviceAccounts',
				label: 'Service Accounts',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'roles',
				label: 'Roles',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'updated', label: 'Updated', description: 'RBAC rules modified' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'clusterRoles',
				label: 'Cluster Roles',
				events: [
					{ key: 'created', label: 'Created' },
					{ key: 'updated', label: 'Updated', description: 'Cluster-wide RBAC rules modified' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'roleBindings',
				label: 'Role Bindings',
				events: [
					{ key: 'created', label: 'Created', description: 'Role assigned to user/group in namespace' },
					{ key: 'deleted', label: 'Deleted' }
				]
			},
			{
				key: 'clusterRoleBindings',
				label: 'Cluster Role Bindings',
				events: [
					{ key: 'created', label: 'Created', description: 'Cluster-wide role assigned to user/group' },
					{ key: 'deleted', label: 'Deleted' }
				]
			}
		]
	}
];

export interface NotifGroups {
	workload: {
		pods: { created: boolean; deleted: boolean; phaseChange: boolean };
		deployments: { created: boolean; deleted: boolean; scaled: boolean; rollout: boolean };
		daemonsets: { created: boolean; deleted: boolean; rollout: boolean };
		statefulsets: { created: boolean; deleted: boolean; scaled: boolean };
		replicasets: { created: boolean; deleted: boolean; scaled: boolean };
		jobs: { created: boolean; completed: boolean; failed: boolean };
		cronjobs: { triggered: boolean; missed: boolean; suspended: boolean };
		hpas: { scaleUp: boolean; scaleDown: boolean };
		nodes: { joined: boolean; removed: boolean; notReady: boolean };
		namespaces: { created: boolean; deleted: boolean };
		events: { warning: boolean };
	};
	network: {
		services: { created: boolean; deleted: boolean; updated: boolean };
		endpoints: { updated: boolean };
		ingresses: { created: boolean; deleted: boolean; updated: boolean };
		networkPolicies: { created: boolean; deleted: boolean; updated: boolean };
	};
	configuration: {
		configmaps: { created: boolean; updated: boolean; deleted: boolean };
		secrets: { created: boolean; updated: boolean; deleted: boolean };
		resourceQuotas: { updated: boolean };
		limitRanges: { updated: boolean };
	};
	storage: {
		pvcs: { created: boolean; bound: boolean; released: boolean; deleted: boolean };
		pvs: { provisioned: boolean; released: boolean; failed: boolean };
		storageClasses: { created: boolean; deleted: boolean };
	};
	accessControl: {
		serviceAccounts: { created: boolean; deleted: boolean };
		roles: { created: boolean; updated: boolean; deleted: boolean };
		clusterRoles: { created: boolean; updated: boolean; deleted: boolean };
		roleBindings: { created: boolean; deleted: boolean };
		clusterRoleBindings: { created: boolean; deleted: boolean };
	};
}

export function defaultNotifGroups(): NotifGroups {
	return {
		workload: {
			pods: { created: true, deleted: true, phaseChange: true },
			deployments: { created: true, deleted: true, scaled: true, rollout: true },
			daemonsets: { created: false, deleted: false, rollout: false },
			statefulsets: { created: true, deleted: true, scaled: true },
			replicasets: { created: false, deleted: false, scaled: false },
			jobs: { created: true, completed: true, failed: true },
			cronjobs: { triggered: true, missed: true, suspended: false },
			hpas: { scaleUp: false, scaleDown: false },
			nodes: { joined: true, removed: true, notReady: true },
			namespaces: { created: false, deleted: false },
			events: { warning: false }
		},
		network: {
			services: { created: false, deleted: false, updated: false },
			endpoints: { updated: false },
			ingresses: { created: true, deleted: true, updated: true },
			networkPolicies: { created: false, deleted: false, updated: false }
		},
		configuration: {
			configmaps: { created: false, updated: false, deleted: false },
			secrets: { created: true, updated: true, deleted: true },
			resourceQuotas: { updated: false },
			limitRanges: { updated: false }
		},
		storage: {
			pvcs: { created: true, bound: true, released: true, deleted: true },
			pvs: { provisioned: false, released: false, failed: false },
			storageClasses: { created: false, deleted: false }
		},
		accessControl: {
			serviceAccounts: { created: false, deleted: false },
			roles: { created: true, updated: true, deleted: true },
			clusterRoles: { created: true, updated: true, deleted: true },
			roleBindings: { created: true, deleted: true },
			clusterRoleBindings: { created: true, deleted: true }
		}
	};
}

/**
 * Maps K8s event (involvedObject.kind + reason) → NotifGroups path.
 * A single K8s event can match multiple notification config paths.
 */
export interface NotifMatch {
	group: keyof NotifGroups;
	resource: string;
	event: string;
}

export const K8S_EVENT_MAP: Record<string, NotifMatch[]> = {
	// ── Pods ───────────────────────────────────────────
	'Pod:Created': [{ group: 'workload', resource: 'pods', event: 'created' }],
	'Pod:Scheduled': [{ group: 'workload', resource: 'pods', event: 'created' }],
	'Pod:Started': [{ group: 'workload', resource: 'pods', event: 'created' }],
	'Pod:Killing': [{ group: 'workload', resource: 'pods', event: 'deleted' }],
	'Pod:BackOff': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],
	'Pod:Failed': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],
	'Pod:Unhealthy': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],
	'Pod:FailedScheduling': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],
	'Pod:Evicted': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],
	'Pod:OOMKilling': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],
	'Pod:ContainerStatusUnknown': [{ group: 'workload', resource: 'pods', event: 'phaseChange' }],

	// ── Deployments ────────────────────────────────────
	'Deployment:ScalingReplicaSet': [
		{ group: 'workload', resource: 'deployments', event: 'scaled' },
		{ group: 'workload', resource: 'deployments', event: 'rollout' }
	],
	'Deployment:DeploymentRollback': [{ group: 'workload', resource: 'deployments', event: 'rollout' }],
	'Deployment:DeploymentPaused': [{ group: 'workload', resource: 'deployments', event: 'rollout' }],
	'Deployment:DeploymentResumed': [{ group: 'workload', resource: 'deployments', event: 'rollout' }],

	// ── DaemonSets ─────────────────────────────────────
	'DaemonSet:SuccessfulCreate': [{ group: 'workload', resource: 'daemonsets', event: 'created' }],
	'DaemonSet:SuccessfulDelete': [{ group: 'workload', resource: 'daemonsets', event: 'deleted' }],
	'DaemonSet:SelectingAll': [{ group: 'workload', resource: 'daemonsets', event: 'rollout' }],

	// ── StatefulSets ───────────────────────────────────
	'StatefulSet:SuccessfulCreate': [{ group: 'workload', resource: 'statefulsets', event: 'created' }],
	'StatefulSet:SuccessfulDelete': [{ group: 'workload', resource: 'statefulsets', event: 'deleted' }],

	// ── ReplicaSets ────────────────────────────────────
	'ReplicaSet:SuccessfulCreate': [{ group: 'workload', resource: 'replicasets', event: 'created' }],
	'ReplicaSet:SuccessfulDelete': [{ group: 'workload', resource: 'replicasets', event: 'deleted' }],

	// ── Jobs ──────────────────────────────────────────
	'Job:SuccessfulCreate': [{ group: 'workload', resource: 'jobs', event: 'created' }],
	'Job:Completed': [{ group: 'workload', resource: 'jobs', event: 'completed' }],
	'Job:Failed': [{ group: 'workload', resource: 'jobs', event: 'failed' }],
	'Job:BackoffLimitExceeded': [{ group: 'workload', resource: 'jobs', event: 'failed' }],
	'Job:DeadlineExceeded': [{ group: 'workload', resource: 'jobs', event: 'failed' }],

	// ── CronJobs ──────────────────────────────────────
	'CronJob:SuccessfulCreate': [{ group: 'workload', resource: 'cronjobs', event: 'triggered' }],
	'CronJob:SawCompletedJob': [{ group: 'workload', resource: 'cronjobs', event: 'triggered' }],
	'CronJob:MissSchedule': [{ group: 'workload', resource: 'cronjobs', event: 'missed' }],
	'CronJob:JobSuspended': [{ group: 'workload', resource: 'cronjobs', event: 'suspended' }],

	// ── HPAs ──────────────────────────────────────────
	'HorizontalPodAutoscaler:SuccessfulRescale': [
		{ group: 'workload', resource: 'hpas', event: 'scaleUp' },
		{ group: 'workload', resource: 'hpas', event: 'scaleDown' }
	],

	// ── Nodes ─────────────────────────────────────────
	'Node:RegisteredNode': [{ group: 'workload', resource: 'nodes', event: 'joined' }],
	'Node:NodeReady': [{ group: 'workload', resource: 'nodes', event: 'joined' }],
	'Node:RemovingNode': [{ group: 'workload', resource: 'nodes', event: 'removed' }],
	'Node:NodeNotReady': [{ group: 'workload', resource: 'nodes', event: 'notReady' }],
	'Node:NodeNotSchedulable': [{ group: 'workload', resource: 'nodes', event: 'notReady' }],

	// ── Namespaces ────────────────────────────────────
	'Namespace:Created': [{ group: 'workload', resource: 'namespaces', event: 'created' }],

	// ── Services ──────────────────────────────────────
	'Service:CreatedLoadBalancer': [{ group: 'network', resource: 'services', event: 'created' }],
	'Service:UpdatedLoadBalancer': [{ group: 'network', resource: 'services', event: 'updated' }],
	'Service:DeletedLoadBalancer': [{ group: 'network', resource: 'services', event: 'deleted' }],

	// ── Ingresses ─────────────────────────────────────
	'Ingress:CREATE': [{ group: 'network', resource: 'ingresses', event: 'created' }],
	'Ingress:UPDATE': [{ group: 'network', resource: 'ingresses', event: 'updated' }],
	'Ingress:DELETE': [{ group: 'network', resource: 'ingresses', event: 'deleted' }],

	// ── PVCs ──────────────────────────────────────────
	'PersistentVolumeClaim:ProvisioningSucceeded': [{ group: 'storage', resource: 'pvcs', event: 'created' }],
	'PersistentVolumeClaim:Bound': [{ group: 'storage', resource: 'pvcs', event: 'bound' }],
	'PersistentVolumeClaim:Released': [{ group: 'storage', resource: 'pvcs', event: 'released' }],

	// ── PVs ───────────────────────────────────────────
	'PersistentVolume:ProvisioningSucceeded': [{ group: 'storage', resource: 'pvs', event: 'provisioned' }],
	'PersistentVolume:Released': [{ group: 'storage', resource: 'pvs', event: 'released' }],
	'PersistentVolume:ProvisioningFailed': [{ group: 'storage', resource: 'pvs', event: 'failed' }],
};

/**
 * Check if a K8s event matches any enabled notification in a NotifGroups config.
 * Returns the matched paths or empty array.
 */
export function matchK8sEvent(
	kind: string,
	reason: string,
	eventType: string,
	config: NotifGroups
): NotifMatch[] {
	const matches: NotifMatch[] = [];

	// Direct kind:reason lookup
	const key = `${kind}:${reason}`;
	const mappings = K8S_EVENT_MAP[key];
	if (mappings) {
		for (const m of mappings) {
			const groupObj = config[m.group] as Record<string, Record<string, boolean>>;
			const resourceObj = groupObj?.[m.resource];
			if (resourceObj?.[m.event]) {
				matches.push(m);
			}
		}
	}

	// Warning-type events match workload.events.warning
	if (eventType === 'Warning' && config.workload.events.warning) {
		matches.push({ group: 'workload', resource: 'events', event: 'warning' });
	}

	return matches;
}
