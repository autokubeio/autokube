/**
 * Kubernetes Resource Path Utilities
 * Shared logic for building API paths and watch paths across different resource types
 */

export interface ResourceConfig {
	/** API resource path (e.g., 'pods', 'deployments') */
	path: string;
	/** Whether the resource is namespaced */
	namespaced: boolean;
	/** API group and version (e.g., '/api/v1', '/apis/apps/v1') */
	apiGroup: string;
}

/**
 * Complete resource type to API configuration mapping
 */
export const RESOURCE_CONFIGS: Record<string, ResourceConfig> = {
	// Core API (v1) resources
	pod: { path: 'pods', namespaced: true, apiGroup: '/api/v1' },
	service: { path: 'services', namespaced: true, apiGroup: '/api/v1' },
	configmap: { path: 'configmaps', namespaced: true, apiGroup: '/api/v1' },
	secret: { path: 'secrets', namespaced: true, apiGroup: '/api/v1' },
	namespace: { path: 'namespaces', namespaced: false, apiGroup: '/api/v1' },
	node: { path: 'nodes', namespaced: false, apiGroup: '/api/v1' },
	persistentvolume: { path: 'persistentvolumes', namespaced: false, apiGroup: '/api/v1' },
	persistentvolumeclaim: { path: 'persistentvolumeclaims', namespaced: true, apiGroup: '/api/v1' },
	serviceaccount: { path: 'serviceaccounts', namespaced: true, apiGroup: '/api/v1' },
	endpoint: { path: 'endpoints', namespaced: true, apiGroup: '/api/v1' },
	event: { path: 'events', namespaced: true, apiGroup: '/api/v1' },
	resourcequota: { path: 'resourcequotas', namespaced: true, apiGroup: '/api/v1' },
	limitrange: { path: 'limitranges', namespaced: true, apiGroup: '/api/v1' },

	// Apps API (apps/v1) resources
	deployment: { path: 'deployments', namespaced: true, apiGroup: '/apis/apps/v1' },
	daemonset: { path: 'daemonsets', namespaced: true, apiGroup: '/apis/apps/v1' },
	statefulset: { path: 'statefulsets', namespaced: true, apiGroup: '/apis/apps/v1' },
	replicaset: { path: 'replicasets', namespaced: true, apiGroup: '/apis/apps/v1' },

	// Batch API (batch/v1) resources
	job: { path: 'jobs', namespaced: true, apiGroup: '/apis/batch/v1' },
	cronjob: { path: 'cronjobs', namespaced: true, apiGroup: '/apis/batch/v1' },

	// Networking API (networking.k8s.io/v1) resources
	ingress: { path: 'ingresses', namespaced: true, apiGroup: '/apis/networking.k8s.io/v1' },
	networkpolicy: {
		path: 'networkpolicies',
		namespaced: true,
		apiGroup: '/apis/networking.k8s.io/v1'
	},
	ingressclass: {
		path: 'ingressclasses',
		namespaced: false,
		apiGroup: '/apis/networking.k8s.io/v1'
	},

	// Discovery API (discovery.k8s.io/v1) resources
	endpointslice: {
		path: 'endpointslices',
		namespaced: true,
		apiGroup: '/apis/discovery.k8s.io/v1'
	},

	// RBAC API (rbac.authorization.k8s.io/v1) resources
	role: { path: 'roles', namespaced: true, apiGroup: '/apis/rbac.authorization.k8s.io/v1' },
	rolebinding: {
		path: 'rolebindings',
		namespaced: true,
		apiGroup: '/apis/rbac.authorization.k8s.io/v1'
	},
	clusterrole: {
		path: 'clusterroles',
		namespaced: false,
		apiGroup: '/apis/rbac.authorization.k8s.io/v1'
	},
	clusterrolebinding: {
		path: 'clusterrolebindings',
		namespaced: false,
		apiGroup: '/apis/rbac.authorization.k8s.io/v1'
	},

	// Autoscaling API (autoscaling/v2) resources
	hpa: { path: 'horizontalpodautoscalers', namespaced: true, apiGroup: '/apis/autoscaling/v2' },

	// Storage API (storage.k8s.io/v1) resources
	storageclass: { path: 'storageclasses', namespaced: false, apiGroup: '/apis/storage.k8s.io/v1' },

	// Gateway API (gateway.networking.k8s.io) — beta
	gateway: { path: 'gateways', namespaced: true, apiGroup: '/apis/gateway.networking.k8s.io/v1' },
	gatewayclass: {
		path: 'gatewayclasses',
		namespaced: false,
		apiGroup: '/apis/gateway.networking.k8s.io/v1'
	},
	httproute: {
		path: 'httproutes',
		namespaced: true,
		apiGroup: '/apis/gateway.networking.k8s.io/v1'
	},
	grpcroute: {
		path: 'grpcroutes',
		namespaced: true,
		apiGroup: '/apis/gateway.networking.k8s.io/v1'
	},
	referencegrant: {
		path: 'referencegrants',
		namespaced: true,
		apiGroup: '/apis/gateway.networking.k8s.io/v1beta1'
	},
	backendtlspolicy: {
		path: 'backendtlspolicies',
		namespaced: true,
		apiGroup: '/apis/gateway.networking.k8s.io/v1alpha3'
	},
	backendtrafficpolicy: {
		path: 'backendtrafficpolicies',
		namespaced: true,
		apiGroup: '/apis/gateway.envoyproxy.io/v1alpha1'
	}
};

/**
 * Alias mapping for common plural/alternate resource names
 */
export const RESOURCE_ALIASES: Record<string, string> = {
	pods: 'pod',
	services: 'service',
	configmaps: 'configmap',
	secrets: 'secret',
	namespaces: 'namespace',
	nodes: 'node',
	persistentvolumes: 'persistentvolume',
	persistentvolumeclaims: 'persistentvolumeclaim',
	serviceaccounts: 'serviceaccount',
	endpoints: 'endpoint',
	events: 'event',
	resourcequotas: 'resourcequota',
	limitranges: 'limitrange',
	deployments: 'deployment',
	daemonsets: 'daemonset',
	statefulsets: 'statefulset',
	replicasets: 'replicaset',
	jobs: 'job',
	cronjobs: 'cronjob',
	ingresses: 'ingress',
	ingressclasses: 'ingressclass',
	networkpolicies: 'networkpolicy',
	endpointslices: 'endpointslice',
	roles: 'role',
	rolebindings: 'rolebinding',
	clusterroles: 'clusterrole',
	clusterrolebindings: 'clusterrolebinding',
	hpas: 'hpa',
	horizontalpodautoscalers: 'hpa',
	storageclasses: 'storageclass',
	gateways: 'gateway',
	gatewayclasses: 'gatewayclass',
	httproutes: 'httproute',
	grpcroutes: 'grpcroute',
	referencegrants: 'referencegrant',
	backendtlspolicies: 'backendtlspolicy',
	backendtrafficpolicies: 'backendtrafficpolicy'
};

/**
 * Get resource configuration for a given resource type
 * @param resourceType - Resource type (supports singular, plural, and aliases)
 * @returns Resource configuration
 */
export function getResourceConfig(resourceType: string): ResourceConfig {
	const normalized = resourceType.toLowerCase();
	const canonical = RESOURCE_ALIASES[normalized] || normalized;
	const config = RESOURCE_CONFIGS[canonical];

	if (!config) {
		throw new Error(`Unsupported resource type: ${resourceType}`);
	}

	return config;
}

/**
 * Build API path for a specific resource instance
 * @param resourceType - Resource type (e.g., 'pod', 'deployment')
 * @param resourceName - Name of the resource instance
 * @param namespace - Namespace (required for namespaced resources)
 * @returns Full API path (e.g., '/api/v1/namespaces/default/pods/my-pod')
 */
export function buildApiPath(
	resourceType: string,
	resourceName: string,
	namespace?: string
): string {
	const config = getResourceConfig(resourceType);

	if (config.namespaced) {
		if (!namespace) {
			throw new Error(`Namespace is required for resource type: ${resourceType}`);
		}
		return `${config.apiGroup}/namespaces/${namespace}/${config.path}/${resourceName}`;
	} else {
		return `${config.apiGroup}/${config.path}/${resourceName}`;
	}
}

/**
 * Build API path for listing resources
 * @param resourceType - Resource type (e.g., 'pod', 'deployment')
 * @param namespace - Namespace (optional for namespaced resources, lists all if omitted)
 * @returns API path for listing resources
 */
export function buildListApiPath(resourceType: string, namespace?: string): string {
	const config = getResourceConfig(resourceType);

	if (config.namespaced && namespace) {
		return `${config.apiGroup}/namespaces/${namespace}/${config.path}`;
	} else {
		return `${config.apiGroup}/${config.path}`;
	}
}

/**
 * Build watch API path for monitoring resource changes
 * @param resourceType - Resource type (e.g., 'pod', 'deployment')
 * @param namespace - Namespace (optional for namespaced resources)
 * @param timeoutSeconds - Watch timeout in seconds (default: 300)
 * @returns Watch API path with query parameters
 */
export function buildWatchPath(
	resourceType: string,
	namespace?: string,
	timeoutSeconds = 300
): string {
	const listPath = buildListApiPath(resourceType, namespace);
	return `${listPath}?watch=1&timeoutSeconds=${timeoutSeconds}`;
}

/**
 * Legacy alias for buildWatchPath (for backward compatibility)
 * @deprecated Use buildWatchPath instead
 */
export function getWatchPath(resource: string, namespace?: string, timeoutSeconds = 300): string {
	return buildWatchPath(resource, namespace, timeoutSeconds);
}
