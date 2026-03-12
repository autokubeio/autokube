/**
 * Kubernetes Type Definitions
 * All interfaces and types for Kubernetes operations
 */

// ── Connection & Testing ─────────────────────────────────────────────────

export interface TestConnectionResult {
	success: boolean;
	info?: {
		version: string;
		nodes: number;
		namespaces: number;
		cluster: string;
	};
	error?: string;
}

// ── Common Types ─────────────────────────────────────────────────────────

export interface BaseResourceInfo {
	name: string;
	namespace?: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
}

export interface ResourceCondition {
	type: string;
	status: string;
	reason?: string;
	message?: string;
}

export interface ContainerInfo {
	name: string;
	image: string;
}

// ── Resources ────────────────────────────────────────────────────────────

export interface NodeInfo extends BaseResourceInfo {
	namespace?: never;
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
	conditions: ResourceCondition[];
	addresses: Array<{ type: string; address: string }>;
	taints: Array<{ key: string; value?: string; effect: string }>;
	unschedulable: boolean;
}

export interface NamespaceInfo {
	name: string;
	status: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
}

export interface PodInfo extends Required<BaseResourceInfo> {
	status: string;
	phase: string;
	ready: string;
	restarts: number;
	node: string;
	ip: string;
	containers: Array<
		ContainerInfo & {
			ready: boolean;
			restartCount: number;
			state: string;
		}
	>;
	conditions: ResourceCondition[];
}

export interface DeploymentInfo extends Required<BaseResourceInfo> {
	ready: string;
	upToDate: number;
	available: number;
	replicas: number;
	updatedReplicas: number;
	readyReplicas: number;
	availableReplicas: number;
	strategy: string;
	selector: Record<string, string>;
	containers: Array<ContainerInfo & { ports?: Array<{ containerPort: number; protocol: string }> }>;
	conditions: ResourceCondition[];
}

export interface ServiceInfo extends Required<BaseResourceInfo> {
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
}

export interface JobInfo extends Required<BaseResourceInfo> {
	completions: string;
	duration: string;
	succeeded: number;
	failed: number;
	active: number;
	startTime: string;
	completionTime?: string;
	containers: ContainerInfo[];
	conditions: ResourceCondition[];
}

export interface CronJobInfo extends Required<BaseResourceInfo> {
	schedule: string;
	suspend: boolean;
	lastSchedule?: string;
	active: number;
	containers: ContainerInfo[];
}

export interface EventInfo extends Required<BaseResourceInfo> {
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
}

export interface ConfigMapInfo extends Required<BaseResourceInfo> {
	id: string;
	dataCount: number;
	data: Record<string, string>;
	binaryData: Record<string, string>;
}

export interface SecretInfo extends Required<BaseResourceInfo> {
	id: string;
	type: string;
	dataCount: number;
	data: Record<string, string>;
}

export interface IngressInfo extends Required<BaseResourceInfo> {
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
}

export interface DaemonSetInfo extends Required<BaseResourceInfo> {
	desired: number;
	current: number;
	ready: number;
	upToDate: number;
	available: number;
	nodeSelector: Record<string, string>;
	selector: Record<string, string>;
	containers: ContainerInfo[];
	conditions: ResourceCondition[];
}

export interface StatefulSetInfo extends Required<BaseResourceInfo> {
	ready: string;
	replicas: number;
	readyReplicas: number;
	currentReplicas: number;
	updatedReplicas: number;
	selector: Record<string, string>;
	serviceName: string;
	containers: ContainerInfo[];
	conditions: ResourceCondition[];
}

export interface ReplicaSetInfo extends Required<BaseResourceInfo> {
	desired: number;
	current: number;
	ready: number;
	selector: Record<string, string>;
	containers: ContainerInfo[];
	conditions: ResourceCondition[];
}

// ── Metrics ──────────────────────────────────────────────────────────────

export interface PodMetrics {
	name: string;
	namespace: string;
	cpu: string;
	memory: string;
	containers: Array<{
		name: string;
		cpu: string;
		memory: string;
	}>;
}

export interface NodeMetrics {
	name: string;
	cpu: string;
	memory: string;
}

// ── Results ──────────────────────────────────────────────────────────────

export interface ListNodesResult {
	success: boolean;
	nodes?: NodeInfo[];
	error?: string;
}

export interface ListNamespacesResult {
	success: boolean;
	namespaces?: NamespaceInfo[];
	error?: string;
}

export interface ListPodsResult {
	success: boolean;
	pods?: PodInfo[];
	error?: string;
}

export interface ListDeploymentsResult {
	success: boolean;
	deployments?: DeploymentInfo[];
	error?: string;
}

export interface ListServicesResult {
	success: boolean;
	services?: ServiceInfo[];
	error?: string;
}

export interface ListJobsResult {
	success: boolean;
	jobs?: JobInfo[];
	error?: string;
}

export interface ListCronJobsResult {
	success: boolean;
	cronJobs?: CronJobInfo[];
	error?: string;
}

export interface ListEventsResult {
	success: boolean;
	events?: EventInfo[];
	error?: string;
}

export interface ListConfigMapsResult {
	success: boolean;
	configMaps?: ConfigMapInfo[];
	error?: string;
}

export interface ListSecretsResult {
	success: boolean;
	secrets?: SecretInfo[];
	error?: string;
}

export interface ListIngressResult {
	success: boolean;
	ingresses?: IngressInfo[];
	error?: string;
}

export interface ListDaemonSetsResult {
	success: boolean;
	daemonSets?: DaemonSetInfo[];
	error?: string;
}

export interface ListStatefulSetsResult {
	success: boolean;
	statefulSets?: StatefulSetInfo[];
	error?: string;
}

export interface ListReplicaSetsResult {
	success: boolean;
	replicaSets?: ReplicaSetInfo[];
	error?: string;
}

export interface ListPodMetricsResult {
	success: boolean;
	metrics?: PodMetrics[];
	error?: string;
}

export interface ListNodeMetricsResult {
	success: boolean;
	metrics?: NodeMetrics[];
	error?: string;
}

// ── Additional Resource Types (for complete module coverage) ────────────────

export interface IngressClassInfo extends BaseResourceInfo {
	controller: string;
	parameters?: any;
	isDefault: boolean;
}

export interface EndpointInfo {
	id: string;
	name: string;
	namespace: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	subsets: any[];
	createdAt: string;
}

export interface EndpointSliceInfo {
	id: string;
	name: string;
	namespace: string;
	addressType: string;
	endpoints: any[];
	ports: any[];
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
}

export interface HorizontalPodAutoscalerInfo {
	id: string;
	name: string;
	namespace: string;
	reference: string;
	minPods: number;
	maxPods: number;
	currentReplicas: number;
	desiredReplicas: number;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	metrics: any[];
	conditions: any[];
	createdAt: string;
}

export interface NetworkPolicyInfo extends Required<BaseResourceInfo> {
	podSelector: Record<string, any>;
	policyTypes: string[];
	ingress: any[];
	egress: any[];
}

export interface PersistentVolumeInfo extends BaseResourceInfo {
	id: string;
	capacity: string;
	accessModes: string[];
	reclaimPolicy: string;
	status: string;
	claim: string;
	storageClass: string;
	volumeMode: string;
}

export interface PersistentVolumeClaimInfo extends Required<BaseResourceInfo> {
	id: string;
	status: string;
	volume: string;
	capacity: string;
	accessModes: string[];
	storageClass: string;
	volumeMode: string;
}

export interface StorageClassInfo extends BaseResourceInfo {
	id: string;
	provisioner: string;
	reclaimPolicy: string;
	volumeBindingMode: string;
	allowVolumeExpansion: boolean;
	isDefault: boolean;
	parameters: Record<string, string>;
}

export interface ResourceQuotaInfo extends Required<BaseResourceInfo> {
	id: string;
	hard: Record<string, string>;
	used: Record<string, string>;
}

export interface LimitRangeInfo extends Required<BaseResourceInfo> {
	id: string;
	limits: any[];
}

export interface RoleInfo extends Required<BaseResourceInfo> {
	id: string;
	rules: any[];
}

export interface RoleBindingInfo extends Required<BaseResourceInfo> {
	id: string;
	roleRef: any;
	subjects: any[];
}

export interface ClusterRoleInfo extends BaseResourceInfo {
	id: string;
	rules: any[];
	aggregationRule?: any;
}

export interface ClusterRoleBindingInfo extends BaseResourceInfo {
	id: string;
	roleRef: any;
	subjects: any[];
}

export interface ServiceAccountInfo extends Required<BaseResourceInfo> {
	id: string;
	secrets: number;
	imagePullSecrets: number;
	secretNames: string[];
}

// ── Additional Result Types ─────────────────────────────────────────────────

export interface ListIngressClassesResult {
	success: boolean;
	ingressClasses?: IngressClassInfo[];
	error?: string;
}

export interface ListEndpointsResult {
	success: boolean;
	endpoints?: EndpointInfo[];
	error?: string;
}

export interface ListEndpointSlicesResult {
	success: boolean;
	endpointSlices?: EndpointSliceInfo[];
	error?: string;
}

export interface ListHorizontalPodAutoscalersResult {
	success: boolean;
	hpas?: HorizontalPodAutoscalerInfo[];
	error?: string;
}

export interface ListNetworkPoliciesResult {
	success: boolean;
	networkPolicies?: NetworkPolicyInfo[];
	error?: string;
}

export interface ListPersistentVolumesResult {
	success: boolean;
	persistentVolumes?: PersistentVolumeInfo[];
	error?: string;
}

export interface ListPersistentVolumeClaimsResult {
	success: boolean;
	persistentVolumeClaims?: PersistentVolumeClaimInfo[];
	error?: string;
}

export interface ListStorageClassesResult {
	success: boolean;
	storageClasses?: StorageClassInfo[];
	error?: string;
}

export interface ListResourceQuotasResult {
	success: boolean;
	resourceQuotas?: ResourceQuotaInfo[];
	error?: string;
}

export interface ListLimitRangesResult {
	success: boolean;
	limitRanges?: LimitRangeInfo[];
	error?: string;
}

export interface ListRolesResult {
	success: boolean;
	roles?: RoleInfo[];
	error?: string;
}

export interface ListRoleBindingsResult {
	success: boolean;
	roleBindings?: RoleBindingInfo[];
	error?: string;
}

export interface ListClusterRolesResult {
	success: boolean;
	clusterRoles?: ClusterRoleInfo[];
	error?: string;
}

export interface ListClusterRoleBindingsResult {
	success: boolean;
	clusterRoleBindings?: ClusterRoleBindingInfo[];
	error?: string;
}

export interface ListServiceAccountsResult {
	success: boolean;
	serviceAccounts?: ServiceAccountInfo[];
	error?: string;
}
