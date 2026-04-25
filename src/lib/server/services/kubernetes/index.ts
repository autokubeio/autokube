/**
 * Kubernetes Service - Main Entry Point
 * Exports all Kubernetes operations with backward compatibility
 */

// ── Type Exports ────────────────────────────────────────────────────────────
export type * from './types';

// ── Utility Exports ─────────────────────────────────────────────────────────
export {
	parseKubeconfig,
	k8sRequest,
	formatConnectionError,
	withKubeconfig,
	withConnection,
	makeClusterRequest,
	invalidateClusterConfigCache,
	testConnectionCredentials,
	createBearerTokenConnection,
	createAgentConnection,
	buildConnectionConfig,
	DEFAULT_TIMEOUT,
	type AuthType,
	type KubeconfigData,
	type BearerTokenConnection,
	type AgentConnection,
	type ConnectionConfig,
	type ApiRequestOptions,
	type ApiResult
} from './utils';

// ── Factory Exports ─────────────────────────────────────────────────────────
export {
	createListOperation,
	createDeleteOperation,
	createScaleOperation,
	createRestartOperation,
	extractBaseMetadata,
	extractContainers,
	extractConditions,
	type K8sListItem,
	type K8sListResponse
} from './factory';

// ── Core Resources ──────────────────────────────────────────────────────────
export {
	testKubeconfigConnection,
	listNamespaces,
	deleteNamespace,
	listPods,
	deletePod,
	listDeployments,
	deleteDeployment,
	scaleDeployment,
	restartDeployment
} from './core';

// ── Services & Networking ───────────────────────────────────────────────────
export {
	listServices,
	deleteService,
	listIngresses,
	deleteIngress,
	listIngressClasses,
	deleteIngressClass,
	listEndpoints,
	deleteEndpoint,
	listEndpointSlices,
	deleteEndpointSlice
} from './services';

// ── Workloads ───────────────────────────────────────────────────────────────
export {
	listJobs,
	deleteJob,
	suspendJob,
	listCronJobs,
	deleteCronJob,
	suspendCronJob,
	triggerCronJob,
	listDaemonSets,
	deleteDaemonSet,
	restartDaemonSet,
	listStatefulSets,
	deleteStatefulSet,
	scaleStatefulSet,
	restartStatefulSet,
	listReplicaSets,
	deleteReplicaSet,
	scaleReplicaSet,
	restartReplicaSet
} from './workloads';

// ── Storage & Configuration ─────────────────────────────────────────────────
export {
	listConfigMaps,
	deleteConfigMap,
	listSecrets,
	deleteSecret,
	listPersistentVolumes,
	deletePersistentVolume,
	listPersistentVolumeClaims,
	deletePVC,
	listStorageClasses,
	deleteStorageClass,
	listResourceQuotas,
	deleteResourceQuota,
	listLimitRanges,
	deleteLimitRange
} from './storage';

// ── RBAC ────────────────────────────────────────────────────────────────────
export {
	listRoles,
	deleteRole,
	listRoleBindings,
	deleteRoleBinding,
	listClusterRoles,
	deleteClusterRole,
	listClusterRoleBindings,
	deleteClusterRoleBinding,
	listServiceAccounts,
	deleteServiceAccount
} from './rbac';

// ── Policy ──────────────────────────────────────────────────────────────────
export { listNetworkPolicies, deleteNetworkPolicy } from './policy';

// ── Metrics & Nodes ─────────────────────────────────────────────────────────
export { listNodes, listPodMetrics, listNodeMetrics, cordonNode, drainNode } from './metrics';

// ── Events ──────────────────────────────────────────────────────────────────
export { listEvents, deleteEvent } from './events';

// ── Autoscaling ─────────────────────────────────────────────────────────────
export { listHorizontalPodAutoscalers, deleteHorizontalPodAutoscaler } from './autoscaling';

// ── Helm Releases ────────────────────────────────────────────────────────────
export {
	listHelmReleases,
	deleteHelmRelease,
	type HelmRelease,
	type ListHelmReleasesResult
} from './helm';

// ── YAML Operations ─────────────────────────────────────────────────────────
export { getPodYaml, updatePodYaml, getResourceYaml, updateResourceYaml } from './yaml-ops';
// ── Watch API ───────────────────────────────────────────────────────────────
export {
	watchResource,
	watchResourceByCluster,
	getWatchPath,
	type WatchEventType,
	type WatchEvent,
	type WatchCallback,
	type WatchOptions
} from './watch';

// ── Transformers ────────────────────────────────────────────────────────────
export {
	transformPod,
	transformPodMetrics,
	transformDeployment,
	transformDaemonSet,
	transformStatefulSet,
	transformReplicaSet,
	transformJob,
	transformCronJob,
	transformNode,
	transformEvent,
	transformService,
	transformEndpoint,
	transformEndpointSlice,
	transformIngress,
	transformIngressClass,
	transformNetworkPolicy,
	transformConfigMap,
	transformSecret,
	transformResourceQuota,
	transformLimitRange,
	transformPVC,
	transformPV,
	transformStorageClass,
	transformServiceAccount,
	transformRole,
	transformClusterRole,
	transformRoleBinding,
	transformClusterRoleBinding
} from './transformers';

// ── Gateway API (beta) ──────────────────────────────────────────────────────
export {
	listGateways,
	deleteGateway,
	transformGateway,
	listGatewayClasses,
	deleteGatewayClass,
	transformGatewayClass,
	listHTTPRoutes,
	deleteHTTPRoute,
	transformHTTPRoute,
	listGRPCRoutes,
	deleteGRPCRoute,
	transformGRPCRoute,
	listReferenceGrants,
	deleteReferenceGrant,
	transformReferenceGrant,
	listBackendTLSPolicies,
	deleteBackendTLSPolicy,
	transformBackendTLSPolicy,
	listBackendTrafficPolicies,
	deleteBackendTrafficPolicy,
	transformBackendTrafficPolicy,
	type GatewayInfo,
	type GatewayClassInfo,
	type HTTPRouteInfo,
	type GRPCRouteInfo,
	type ReferenceGrantInfo,
	type BackendTLSPolicyInfo,
	type BackendTrafficPolicyInfo
} from './gateway-api';
