/**
 * Kubernetes Services & Networking Resources
 * Services, Ingresses, IngressClasses, Endpoints, EndpointSlices
 */

import type {
	ServiceInfo,
	IngressInfo,
	IngressClassInfo,
	EndpointInfo,
	EndpointSliceInfo,
	ListServicesResult,
	ListIngressResult,
	ListIngressClassesResult,
	ListEndpointsResult,
	ListEndpointSlicesResult
} from './types';
import { makeClusterRequest } from './utils';

// ── Type Definitions ────────────────────────────────────────────────────────

type K8sServiceList = {
	items: Array<{
		metadata: {
			name: string;
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
	}>;
};

type K8sIngressList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
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
								port?: {
									number?: number;
									name?: string;
								};
							};
						};
					}>;
				};
			}>;
		};
		status?: {
			loadBalancer?: {
				ingress?: Array<{
					ip?: string;
					hostname?: string;
				}>;
			};
		};
	}>;
};

type K8sIngressClassList = {
	items: Array<{
		metadata: {
			name: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			controller?: string;
			parameters?: {
				apiGroup?: string;
				kind?: string;
				name?: string;
			};
		};
	}>;
};

type K8sEndpointList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		subsets?: Array<{
			addresses?: Array<{
				ip?: string;
				nodeName?: string;
			}>;
			ports?: Array<{
				name?: string;
				port?: number;
				protocol?: string;
			}>;
		}>;
	}>;
};

type K8sEndpointSliceList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		addressType?: string;
		endpoints?: Array<{
			addresses?: string[];
			conditions?: {
				ready?: boolean;
			};
		}>;
		ports?: Array<{
			name?: string;
			port?: number;
			protocol?: string;
		}>;
	}>;
};

// ── Services ────────────────────────────────────────────────────────────────

export async function listServices(
	clusterId: number,
	namespace?: string
): Promise<ListServicesResult> {
	const path = namespace ? `/api/v1/namespaces/${namespace}/services` : '/api/v1/services';

	const result = await makeClusterRequest<K8sServiceList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch services',
			services: []
		};
	}

	const services: ServiceInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		// Parse ports
		const ports = (spec.ports || []).map((port) => ({
			name: port.name,
			port: port.port || 0,
			targetPort: port.targetPort || port.port || 0,
			protocol: port.protocol || 'TCP',
			nodePort: port.nodePort
		}));

		// Parse external IPs
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
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			type: spec.type || 'ClusterIP',
			clusterIP: spec.clusterIP || 'None',
			externalIPs,
			ports,
			selector: spec.selector || {},
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			sessionAffinity: spec.sessionAffinity || 'None',
			loadBalancerIP: spec.loadBalancerIP,
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, services };
}

export async function deleteService(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/services/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete service ${name}`
		};
	}

	return { success: true };
}

// ── Ingresses ───────────────────────────────────────────────────────────────

export async function listIngresses(
	clusterId: number,
	namespace?: string
): Promise<ListIngressResult> {
	const path = namespace
		? `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses`
		: '/apis/networking.k8s.io/v1/ingresses';

	const result = await makeClusterRequest<K8sIngressList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch ingresses',
			ingresses: []
		};
	}

	const ingresses: IngressInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		// Extract hosts from rules
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
							backend: {
								service: serviceName,
								port: servicePort
							}
						});
					}
				}
			}
		}

		// Extract load balancer IPs
		const loadBalancerIPs: string[] = [];
		if (status.loadBalancer?.ingress) {
			for (const ingress of status.loadBalancer.ingress) {
				if (ingress.ip) loadBalancerIPs.push(ingress.ip);
				if (ingress.hostname) loadBalancerIPs.push(ingress.hostname);
			}
		}

		return {
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			hosts,
			paths,
			tls: (spec.tls || []).map((t) => ({ hosts: t.hosts || [], secretName: t.secretName })),
			ingressClass: spec.ingressClassName || 'default',
			addresses: loadBalancerIPs,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, ingresses };
}

export async function deleteIngress(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/networking.k8s.io/v1/namespaces/${namespace}/ingresses/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete ingress ${name}`
		};
	}

	return { success: true };
}

// ── IngressClasses ──────────────────────────────────────────────────────────

export async function listIngressClasses(clusterId: number): Promise<ListIngressClassesResult> {
	const path = '/apis/networking.k8s.io/v1/ingressclasses';

	const result = await makeClusterRequest<K8sIngressClassList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch ingress classes',
			ingressClasses: []
		};
	}

	const ingressClasses: IngressClassInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};

		return {
			name: item.metadata.name,
			controller: spec.controller || 'Unknown',
			parameters: spec.parameters,
			isDefault:
				item.metadata.annotations?.['ingressclass.kubernetes.io/is-default-class'] === 'true',
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, ingressClasses };
}

export async function deleteIngressClass(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/networking.k8s.io/v1/ingressclasses/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete ingress class ${name}`
		};
	}

	return { success: true };
}

// ── Endpoints ───────────────────────────────────────────────────────────────

export async function listEndpoints(
	clusterId: number,
	namespace?: string
): Promise<ListEndpointsResult> {
	const path = namespace ? `/api/v1/namespaces/${namespace}/endpoints` : '/api/v1/endpoints';

	const result = await makeClusterRequest<K8sEndpointList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch endpoints',
			endpoints: []
		};
	}

	const endpoints: EndpointInfo[] = result.data.items.map((item) => {
		const subsets = item.subsets || [];

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			subsets,
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, endpoints };
}

export async function deleteEndpoint(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/endpoints/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete endpoint ${name}`
		};
	}

	return { success: true };
}

// ── EndpointSlices ──────────────────────────────────────────────────────────

export async function listEndpointSlices(
	clusterId: number,
	namespace?: string
): Promise<ListEndpointSlicesResult> {
	const path = namespace
		? `/apis/discovery.k8s.io/v1/namespaces/${namespace}/endpointslices`
		: '/apis/discovery.k8s.io/v1/endpointslices';

	const result = await makeClusterRequest<K8sEndpointSliceList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch endpoint slices',
			endpointSlices: []
		};
	}

	const endpointSlices: EndpointSliceInfo[] = result.data.items.map((item) => {
		const addressType = item.addressType || 'IPv4';
		const endpoints = item.endpoints || [];
		const ports = item.ports || [];

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			addressType,
			endpoints,
			ports,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, endpointSlices };
}

export async function deleteEndpointSlice(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/discovery.k8s.io/v1/namespaces/${namespace}/endpointslices/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete endpoint slice ${name}`
		};
	}

	return { success: true };
}
