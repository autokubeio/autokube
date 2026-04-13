import type { ColumnConfig } from './components/data-table-view';

/**
 * Table identifier enum
 */
export enum TableName {
	audit = 'audit',
	nodes = 'nodes',
	namespaces = 'namespaces',
	pods = 'pods',
	deployments = 'deployments',
	daemonsets = 'daemonsets',
	statefulsets = 'statefulsets',
	replicasets = 'replicasets',
	jobs = 'jobs',
	cronjobs = 'cronjobs',
	events = 'events',
	services = 'services',
	ingress = 'ingress',
	configmaps = 'configmaps',
	secrets = 'secrets',
	resourcequotas = 'resourcequotas',
	limitranges = 'limitranges',
	hpas = 'hpas',
	endpoints = 'endpoints',
	endpointslices = 'endpointslices',
	networkpolicies = 'networkpolicies',
	ingressclasses = 'ingressclasses',
	persistentvolumeclaims = 'persistentvolumeclaims',
	persistentvolumes = 'persistentvolumes',
	storageclasses = 'storageclasses',
	serviceaccounts = 'serviceaccounts',
	roles = 'roles',
	clusterroles = 'clusterroles',
	rolebindings = 'rolebindings',
	clusterrolebindings = 'clusterrolebindings',
	helmreleases = 'helmreleases',
	imagescans = 'imagescans'
}

// Audit log table columns
export const auditColumns: ColumnConfig[] = [
	{ id: 'createdAt', label: 'Timestamp', width: 168, minWidth: 140, sortable: true },
	{ id: 'clusterName', label: 'Cluster', width: 150, minWidth: 120, sortable: true },
	{ id: 'username', label: 'User', width: 180, minWidth: 140, sortable: true },
	{ id: 'action', label: 'Action', width: 140, minWidth: 110, sortable: true },
	{ id: 'entityType', label: 'Entity', width: 180, minWidth: 140, sortable: true },
	{ id: 'entityName', label: 'Name', grow: true, minWidth: 180, sortable: true },
	{ id: 'ipAddress', label: 'IP Address', width: 130, minWidth: 110, sortable: true },
	{ id: 'actions', label: '', fixed: 'end', width: 50, resizable: false }
];
// Nodes table columns
export const nodesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'status', label: 'Status', width: 120, minWidth: 100, sortable: true },
	{ id: 'roles', label: 'Roles', width: 160, minWidth: 100, sortable: true },
	{ id: 'internalIP', label: 'Internal IP', width: 140, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'version', label: 'Version', width: 120, minWidth: 100, sortable: true },
	{ id: 'cpu', label: 'CPU', width: 100, minWidth: 80, sortable: true, sortField: 'cpuUsage' },
	{ id: 'memory', label: 'Memory', width: 100, minWidth: 80, sortable: true, sortField: 'memoryUsage' },
	{ id: 'disk', label: 'Disk', width: 100, minWidth: 80, sortable: true, sortField: 'diskCapacity' },
	{ id: 'pods', label: 'Pods', width: 80, minWidth: 60, sortable: true, sortField: 'podsCount' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

// Namespaces table columns
export const namespacesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 120, grow: true, sortable: true },
	{ id: 'status', label: 'Status', width: 120, minWidth: 100, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'labels', label: 'Labels', width: 450, minWidth: 200, sortable: true },
	{
		id: 'created',
		label: 'Created',
		width: 180,
		minWidth: 150,
		sortable: true,
		sortField: 'createdAt'
	},
	{ id: 'actions', label: '', fixed: 'end', width: 100, resizable: false }
];

// Pods table columns
export const podsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 220, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'status', label: 'Status', width: 125, minWidth: 110, sortable: true },
	{ id: 'ready', label: 'Ready', width: 75, minWidth: 65, sortable: true },
	{ id: 'restarts', label: 'Restarts', width: 80, minWidth: 65, sortable: true },
	{ id: 'cpu', label: 'CPU', width: 140, minWidth: 120, sortable: true },
	{ id: 'memory', label: 'Memory', width: 140, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 75, minWidth: 65, sortable: true, sortField: 'createdAt' },
	{ id: 'node', label: 'Node', width: 200, minWidth: 140, sortable: true },
	{ id: 'ip', label: 'IP', width: 130, minWidth: 110, sortable: true },
	{ id: 'actions', label: '', fixed: 'end', width: 170, resizable: false }
];

// Deployments table columns
export const deploymentsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'ready', label: 'Ready', width: 80, minWidth: 60, sortable: true },
	{ id: 'upToDate', label: 'Up-to-date', width: 100, minWidth: 80, sortable: true },
	{ id: 'available', label: 'Available', width: 100, minWidth: 80, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'strategy', label: 'Strategy', width: 140, minWidth: 100, sortable: true },
	{ id: 'containers', label: 'Containers', width: 220, minWidth: 120, sortable: true },
	{ id: 'actions', label: '', fixed: 'end', width: 140, resizable: false }
];

// Jobs table columns
export const jobsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'status', label: 'Status', width: 120, minWidth: 100, sortable: true },
	{ id: 'completions', label: 'Completions', width: 110, minWidth: 90, sortable: true },
	{ id: 'duration', label: 'Duration', width: 100, minWidth: 80, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'containers', label: 'Containers', width: 220, minWidth: 120, sortable: true },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

// CronJobs table columns
export const cronJobsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'schedule', label: 'Schedule', width: 140, minWidth: 100, sortable: true },
	{ id: 'suspend', label: 'Suspend', width: 90, minWidth: 70, sortable: true },
	{ id: 'active', label: 'Active', width: 80, minWidth: 60, sortable: true },
	{ id: 'lastSchedule', label: 'Last Schedule', width: 130, minWidth: 100, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 140, resizable: false }
];

// Events table columns
export const eventsColumns: ColumnConfig[] = [
	{ id: 'type', label: 'Type', width: 100, minWidth: 80, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 140, minWidth: 100, sortable: true },
	{ id: 'reason', label: 'Reason', width: 160, minWidth: 120, sortable: true },
	{ id: 'object', label: 'Object', width: 200, minWidth: 150, sortable: true },
	{ id: 'message', label: 'Message', width: 350, minWidth: 200, grow: true, sortable: true },
	{ id: 'count', label: 'Count', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 140, minWidth: 100, sortable: true, sortField: 'lastSeen' },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

// Services table columns
export const servicesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'type', label: 'Type', width: 120, minWidth: 100, sortable: true },
	{ id: 'clusterIP', label: 'Cluster IP', width: 140, minWidth: 120, sortable: true },
	{ id: 'externalIP', label: 'External IP', width: 140, minWidth: 120, sortable: true },
	{ id: 'ports', label: 'Ports', width: 160, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

export const ingressColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'hosts', label: 'Hosts', width: 200, minWidth: 150, sortable: true },
	{ id: 'addresses', label: 'Addresses', width: 180, minWidth: 120, sortable: true },
	{ id: 'ingressClass', label: 'Class', width: 120, minWidth: 100, sortable: true },
	{ id: 'tls', label: 'TLS', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

export const daemonSetsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'desired', label: 'Desired', width: 90, minWidth: 70, sortable: true },
	{ id: 'current', label: 'Current', width: 90, minWidth: 70, sortable: true },
	{ id: 'ready', label: 'Ready', width: 80, minWidth: 60, sortable: true },
	{ id: 'upToDate', label: 'Up-to-Date', width: 110, minWidth: 90, sortable: true },
	{ id: 'available', label: 'Available', width: 100, minWidth: 80, sortable: true },
	{ id: 'nodeSelector', label: 'Node Selector', width: 180, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 120, resizable: false }
];

export const statefulSetsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'ready', label: 'Ready', width: 100, minWidth: 80, sortable: true },
	{ id: 'serviceName', label: 'Service', width: 150, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 140, resizable: false }
];

export const replicaSetsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'desired', label: 'Desired', width: 90, minWidth: 70, sortable: true },
	{ id: 'current', label: 'Current', width: 90, minWidth: 70, sortable: true },
	{ id: 'ready', label: 'Ready', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 140, resizable: false }
];

export const configMapsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'dataCount', label: 'Data', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 100, resizable: false }
];

export const secretsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'type', label: 'Type', width: 150, minWidth: 120, sortable: true },
	{ id: 'dataCount', label: 'Data', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 100, resizable: false }
];

export const resourceQuotasColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100 },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60 },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

export const limitRangesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100 },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60 },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

export const hpasColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'reference', label: 'Scale Target', width: 180, minWidth: 150, sortable: true },
	{ id: 'currentReplicas', label: 'Current', width: 90, minWidth: 70, sortable: true },
	{ id: 'desiredReplicas', label: 'Desired', width: 90, minWidth: 70, sortable: true },
	{ id: 'minPods', label: 'Min', width: 70, minWidth: 50, sortable: true },
	{ id: 'maxPods', label: 'Max', width: 70, minWidth: 50, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

export const endpointsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'addresses', label: 'Addresses', width: 200, minWidth: 120, sortable: true },
	{ id: 'ports', label: 'Ports', width: 180, minWidth: 100, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const endpointSlicesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'addressType', label: 'Address Type', width: 110, minWidth: 90, sortable: true },
	{ id: 'endpoints', label: 'Endpoints', width: 100, minWidth: 70, sortable: true },
	{ id: 'ports', label: 'Ports', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const networkPoliciesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 250, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'policyTypes', label: 'Policy Types', width: 150, minWidth: 100, sortable: true },
	{ id: 'ingressRules', label: 'Ingress Rules', width: 110, minWidth: 80, sortable: true },
	{ id: 'egressRules', label: 'Egress Rules', width: 110, minWidth: 80, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const ingressClassesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'controller', label: 'Controller', width: 280, minWidth: 200, sortable: true },
	{ id: 'isDefault', label: 'Default', width: 90, minWidth: 70, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const persistentVolumeClaimsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'status', label: 'Status', width: 100, minWidth: 80, sortable: true },
	{ id: 'volume', label: 'Volume', width: 180, minWidth: 150, sortable: true },
	{ id: 'capacity', label: 'Capacity', width: 100, minWidth: 80, sortable: true },
	{ id: 'accessModes', label: 'Access Modes', width: 150, minWidth: 120, sortable: true },
	{ id: 'storageClass', label: 'Storage Class', width: 150, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const persistentVolumesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'capacity', label: 'Capacity', width: 100, minWidth: 80, sortable: true },
	{ id: 'accessModes', label: 'Access Modes', width: 150, minWidth: 120, sortable: true },
	{ id: 'reclaimPolicy', label: 'Reclaim Policy', width: 130, minWidth: 110, sortable: true },
	{ id: 'status', label: 'Status', width: 100, minWidth: 80, sortable: true },
	{ id: 'claim', label: 'Claim', width: 180, minWidth: 150, sortable: true },
	{ id: 'storageClass', label: 'Storage Class', width: 150, minWidth: 120, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const storageClassesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'provisioner', label: 'Provisioner', width: 240, minWidth: 180, sortable: true },
	{ id: 'reclaimPolicy', label: 'Reclaim Policy', width: 130, minWidth: 110, sortable: true },
	{ id: 'volumeBindingMode', label: 'Volume Binding', width: 140, minWidth: 120, sortable: true },
	{
		id: 'allowVolumeExpansion',
		label: 'Allow Expansion',
		width: 130,
		minWidth: 110,
		sortable: true
	},
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const serviceAccountsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'secrets', label: 'Secrets', width: 90, minWidth: 70, sortable: true },
	{
		id: 'imagePullSecrets',
		label: 'Image Pull Secrets',
		width: 150,
		minWidth: 130,
		sortable: true
	},
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const rolesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'rules', label: 'Rules', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const clusterRolesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 220, minWidth: 160, grow: true, sortable: true },
	{ id: 'rules', label: 'Rules', width: 80, minWidth: 60, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const roleBindingsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 150, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 120, minWidth: 100, sortable: true },
	{ id: 'role', label: 'Role', width: 180, minWidth: 140, sortable: true },
	{ id: 'roleKind', label: 'Role Kind', width: 120, minWidth: 100, sortable: true },
	{ id: 'subjects', label: 'Subjects', width: 90, minWidth: 70, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const clusterRoleBindingsColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 220, minWidth: 160, grow: true, sortable: true },
	{ id: 'role', label: 'Role', width: 180, minWidth: 140, sortable: true },
	{ id: 'subjects', label: 'Subjects', width: 90, minWidth: 70, sortable: true },
	{ id: 'age', label: 'Age', width: 80, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];

export const helmReleasesColumns: ColumnConfig[] = [
	{ id: 'name', label: 'Name', width: 200, minWidth: 140, grow: true, sortable: true },
	{ id: 'namespace', label: 'Namespace', width: 130, minWidth: 100, sortable: true },
	{ id: 'chart', label: 'Chart', width: 160, minWidth: 120, sortable: true },
	{ id: 'chartVersion', label: 'Version', width: 100, minWidth: 80, sortable: true },
	{ id: 'appVersion', label: 'App Version', width: 110, minWidth: 80, sortable: true },
	{ id: 'status', label: 'Status', width: 140, minWidth: 110, sortable: true },
	{ id: 'revision', label: 'Rev', width: 65, minWidth: 55, sortable: true },
	{ id: 'age', label: 'Age', width: 75, minWidth: 60, sortable: true, sortField: 'createdAt' },
	{ id: 'actions', label: '', fixed: 'end', width: 80, resizable: false }
];

export const imageScansColumns: ColumnConfig[] = [	
	{ id: 'select', label: '', fixed: 'start', width: 36, resizable: false },	
	{ id: 'expand', label: '', fixed: 'start', width: 36, resizable: false },
	{ id: 'image', label: 'Image', width: 250, minWidth: 200, grow: true, sortable: true },
	{ id: 'tag', label: 'Tag', width: 120, minWidth: 80, sortable: true },
	{ id: 'status', label: 'Status', width: 110, minWidth: 90, sortable: true },
	{ id: 'critical', label: 'Critical', width: 80, minWidth: 65, sortable: true },
	{ id: 'high', label: 'High', width: 70, minWidth: 55, sortable: true },
	{ id: 'medium', label: 'Medium', width: 75, minWidth: 60, sortable: true },
	{ id: 'low', label: 'Low', width: 65, minWidth: 50, sortable: true },
	{ id: 'resource', label: 'Resource', width: 180, minWidth: 130, sortable: true },
	{ id: 'actions', label: '', fixed: 'end', width: 90, resizable: false }
];
