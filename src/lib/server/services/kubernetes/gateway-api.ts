/**
 * Kubernetes Gateway API resources (beta).
 *
 * Covers the upstream `gateway.networking.k8s.io` group plus Envoy Gateway's
 * `gateway.envoyproxy.io` BackendTrafficPolicy. Each list function returns
 * `success: true` with an empty array when the cluster does not have the CRD
 * installed (404 from the API server) so the UI can render an empty state
 * instead of a hard error.
 */

import { makeClusterRequest } from './utils';

// ── Shared raw + info shapes ────────────────────────────────────────────────

interface BaseMeta {
	name?: string;
	namespace?: string;
	creationTimestamp?: string;
	labels?: Record<string, string>;
	annotations?: Record<string, string>;
}

interface BaseInfo {
	id: string;
	name: string;
	namespace: string;
	labels: Record<string, string>;
	annotations: Record<string, string>;
	createdAt: string;
}

interface ParentRef {
	group?: string;
	kind?: string;
	namespace?: string;
	name?: string;
	sectionName?: string;
	port?: number;
}

interface TargetRef {
	group?: string;
	kind?: string;
	name?: string;
	namespace?: string;
	sectionName?: string;
}

const NOT_FOUND_MARKERS = ['404', 'not found', 'the server could not find', 'no matches for kind'];

function isCrdMissing(err: string | undefined): boolean {
	if (!err) return false;
	const lower = err.toLowerCase();
	return NOT_FOUND_MARKERS.some((m) => lower.includes(m));
}

function baseInfo(metadata: BaseMeta, fallbackNs = 'default'): BaseInfo {
	const namespace = metadata.namespace || fallbackNs;
	const name = metadata.name || 'unknown';
	return {
		id: `${namespace}/${name}`,
		name,
		namespace,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

function clusterInfo(metadata: BaseMeta): Omit<BaseInfo, 'namespace'> {
	const name = metadata.name || 'unknown';
	return {
		id: name,
		name,
		labels: metadata.labels || {},
		annotations: metadata.annotations || {},
		createdAt: metadata.creationTimestamp || ''
	};
}

interface K8sList<T> {
	items: T[];
}

// ── API group constants ─────────────────────────────────────────────────────

const GW_V1 = '/apis/gateway.networking.k8s.io/v1';
const GW_V1BETA1 = '/apis/gateway.networking.k8s.io/v1beta1';
const GW_V1ALPHA3 = '/apis/gateway.networking.k8s.io/v1alpha3';
const ENVOY_V1ALPHA1 = '/apis/gateway.envoyproxy.io/v1alpha1';

// ── Gateway ─────────────────────────────────────────────────────────────────

interface RawGateway {
	metadata?: BaseMeta;
	spec?: {
		gatewayClassName?: string;
		listeners?: Array<{
			name?: string;
			hostname?: string;
			port?: number;
			protocol?: string;
		}>;
		addresses?: Array<{ type?: string; value?: string }>;
	};
	status?: {
		addresses?: Array<{ type?: string; value?: string }>;
		conditions?: Array<{ type?: string; status?: string }>;
	};
}

export interface GatewayInfo extends BaseInfo {
	gatewayClassName: string;
	listenerCount: number;
	listeners: Array<{ name: string; hostname?: string; port?: number; protocol?: string }>;
	addresses: string[];
	programmed: 'True' | 'False' | 'Unknown';
}

export function transformGateway(raw: unknown): GatewayInfo {
	const g = raw as RawGateway;
	const metadata = g.metadata ?? {};
	const spec = g.spec ?? {};
	const status = g.status ?? {};

	const listeners = (spec.listeners ?? []).map((l) => ({
		name: l.name || '',
		hostname: l.hostname,
		port: l.port,
		protocol: l.protocol
	}));

	const addresses: string[] = [];
	for (const a of status.addresses ?? []) if (a.value) addresses.push(a.value);
	for (const a of spec.addresses ?? [])
		if (a.value && !addresses.includes(a.value)) addresses.push(a.value);

	const programmedCondition = (status.conditions ?? []).find((c) => c.type === 'Programmed');
	const programmed = (programmedCondition?.status as 'True' | 'False' | 'Unknown') ?? 'Unknown';

	return {
		...baseInfo(metadata),
		gatewayClassName: spec.gatewayClassName || '',
		listenerCount: listeners.length,
		listeners,
		addresses,
		programmed
	};
}

export async function listGateways(
	clusterId: number,
	namespace?: string
): Promise<{ success: boolean; error?: string; gateways: GatewayInfo[]; crdMissing?: boolean }> {
	const path = namespace ? `${GW_V1}/namespaces/${namespace}/gateways` : `${GW_V1}/gateways`;
	const result = await makeClusterRequest<K8sList<RawGateway>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error)) return { success: true, gateways: [], crdMissing: true };
		return { success: false, error: result.error ?? 'Failed to fetch gateways', gateways: [] };
	}
	return { success: true, gateways: result.data.items.map(transformGateway) };
}

export async function deleteGateway(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `${GW_V1}/namespaces/${namespace}/gateways/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return { success: false, error: result.error ?? `Failed to delete gateway ${name}` };
	return { success: true };
}

// ── GatewayClass ────────────────────────────────────────────────────────────

interface RawGatewayClass {
	metadata?: BaseMeta;
	spec?: {
		controllerName?: string;
		description?: string;
	};
	status?: {
		conditions?: Array<{ type?: string; status?: string }>;
	};
}

export interface GatewayClassInfo extends Omit<BaseInfo, 'namespace'> {
	controllerName: string;
	description?: string;
	accepted: 'True' | 'False' | 'Unknown';
}

export function transformGatewayClass(raw: unknown): GatewayClassInfo {
	const gc = raw as RawGatewayClass;
	const metadata = gc.metadata ?? {};
	const spec = gc.spec ?? {};
	const status = gc.status ?? {};
	const acceptedCondition = (status.conditions ?? []).find((c) => c.type === 'Accepted');
	return {
		...clusterInfo(metadata),
		controllerName: spec.controllerName || '',
		description: spec.description,
		accepted: (acceptedCondition?.status as 'True' | 'False' | 'Unknown') ?? 'Unknown'
	};
}

export async function listGatewayClasses(
	clusterId: number
): Promise<{
	success: boolean;
	error?: string;
	gatewayClasses: GatewayClassInfo[];
	crdMissing?: boolean;
}> {
	const path = `${GW_V1}/gatewayclasses`;
	const result = await makeClusterRequest<K8sList<RawGatewayClass>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error)) return { success: true, gatewayClasses: [], crdMissing: true };
		return {
			success: false,
			error: result.error ?? 'Failed to fetch gateway classes',
			gatewayClasses: []
		};
	}
	return { success: true, gatewayClasses: result.data.items.map(transformGatewayClass) };
}

export async function deleteGatewayClass(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const path = `${GW_V1}/gatewayclasses/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return { success: false, error: result.error ?? `Failed to delete gateway class ${name}` };
	return { success: true };
}

// ── HTTPRoute ───────────────────────────────────────────────────────────────

interface RawHTTPRoute {
	metadata?: BaseMeta;
	spec?: {
		hostnames?: string[];
		parentRefs?: ParentRef[];
		rules?: Array<{
			matches?: unknown[];
			backendRefs?: unknown[];
		}>;
	};
}

export interface HTTPRouteInfo extends BaseInfo {
	hostnames: string[];
	parents: string[];
	ruleCount: number;
}

function formatParentRef(p: ParentRef): string {
	const kind = p.kind || 'Gateway';
	const ns = p.namespace ? `${p.namespace}/` : '';
	return `${kind}/${ns}${p.name || ''}`;
}

export function transformHTTPRoute(raw: unknown): HTTPRouteInfo {
	const r = raw as RawHTTPRoute;
	const metadata = r.metadata ?? {};
	const spec = r.spec ?? {};
	return {
		...baseInfo(metadata),
		hostnames: spec.hostnames ?? [],
		parents: (spec.parentRefs ?? []).map(formatParentRef),
		ruleCount: (spec.rules ?? []).length
	};
}

export async function listHTTPRoutes(
	clusterId: number,
	namespace?: string
): Promise<{
	success: boolean;
	error?: string;
	httpRoutes: HTTPRouteInfo[];
	crdMissing?: boolean;
}> {
	const path = namespace ? `${GW_V1}/namespaces/${namespace}/httproutes` : `${GW_V1}/httproutes`;
	const result = await makeClusterRequest<K8sList<RawHTTPRoute>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error)) return { success: true, httpRoutes: [], crdMissing: true };
		return { success: false, error: result.error ?? 'Failed to fetch HTTPRoutes', httpRoutes: [] };
	}
	return { success: true, httpRoutes: result.data.items.map(transformHTTPRoute) };
}

export async function deleteHTTPRoute(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `${GW_V1}/namespaces/${namespace}/httproutes/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return { success: false, error: result.error ?? `Failed to delete HTTPRoute ${name}` };
	return { success: true };
}

// ── GRPCRoute ───────────────────────────────────────────────────────────────

interface RawGRPCRoute {
	metadata?: BaseMeta;
	spec?: {
		hostnames?: string[];
		parentRefs?: ParentRef[];
		rules?: unknown[];
	};
}

export interface GRPCRouteInfo extends BaseInfo {
	hostnames: string[];
	parents: string[];
	ruleCount: number;
}

export function transformGRPCRoute(raw: unknown): GRPCRouteInfo {
	const r = raw as RawGRPCRoute;
	const metadata = r.metadata ?? {};
	const spec = r.spec ?? {};
	return {
		...baseInfo(metadata),
		hostnames: spec.hostnames ?? [],
		parents: (spec.parentRefs ?? []).map(formatParentRef),
		ruleCount: (spec.rules ?? []).length
	};
}

export async function listGRPCRoutes(
	clusterId: number,
	namespace?: string
): Promise<{
	success: boolean;
	error?: string;
	grpcRoutes: GRPCRouteInfo[];
	crdMissing?: boolean;
}> {
	const path = namespace ? `${GW_V1}/namespaces/${namespace}/grpcroutes` : `${GW_V1}/grpcroutes`;
	const result = await makeClusterRequest<K8sList<RawGRPCRoute>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error)) return { success: true, grpcRoutes: [], crdMissing: true };
		return { success: false, error: result.error ?? 'Failed to fetch GRPCRoutes', grpcRoutes: [] };
	}
	return { success: true, grpcRoutes: result.data.items.map(transformGRPCRoute) };
}

export async function deleteGRPCRoute(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `${GW_V1}/namespaces/${namespace}/grpcroutes/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return { success: false, error: result.error ?? `Failed to delete GRPCRoute ${name}` };
	return { success: true };
}

// ── ReferenceGrant ──────────────────────────────────────────────────────────

interface RawReferenceGrant {
	metadata?: BaseMeta;
	spec?: {
		from?: Array<{ group?: string; kind?: string; namespace?: string }>;
		to?: Array<{ group?: string; kind?: string; name?: string }>;
	};
}

export interface ReferenceGrantInfo extends BaseInfo {
	from: string[];
	to: string[];
}

export function transformReferenceGrant(raw: unknown): ReferenceGrantInfo {
	const r = raw as RawReferenceGrant;
	const metadata = r.metadata ?? {};
	const spec = r.spec ?? {};
	const from = (spec.from ?? []).map((f) => `${f.kind || ''}/${f.namespace || ''}`);
	const to = (spec.to ?? []).map((t) => `${t.kind || ''}${t.name ? '/' + t.name : ''}`);
	return { ...baseInfo(metadata), from, to };
}

export async function listReferenceGrants(
	clusterId: number,
	namespace?: string
): Promise<{
	success: boolean;
	error?: string;
	referenceGrants: ReferenceGrantInfo[];
	crdMissing?: boolean;
}> {
	const path = namespace
		? `${GW_V1BETA1}/namespaces/${namespace}/referencegrants`
		: `${GW_V1BETA1}/referencegrants`;
	const result = await makeClusterRequest<K8sList<RawReferenceGrant>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error)) return { success: true, referenceGrants: [], crdMissing: true };
		return {
			success: false,
			error: result.error ?? 'Failed to fetch ReferenceGrants',
			referenceGrants: []
		};
	}
	return { success: true, referenceGrants: result.data.items.map(transformReferenceGrant) };
}

export async function deleteReferenceGrant(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `${GW_V1BETA1}/namespaces/${namespace}/referencegrants/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return { success: false, error: result.error ?? `Failed to delete ReferenceGrant ${name}` };
	return { success: true };
}

// ── BackendTLSPolicy ────────────────────────────────────────────────────────

interface RawBackendTLSPolicy {
	metadata?: BaseMeta;
	spec?: {
		targetRefs?: TargetRef[];
		validation?: {
			hostname?: string;
		};
	};
}

export interface BackendTLSPolicyInfo extends BaseInfo {
	targetRefs: string[];
	hostname: string;
}

function formatTargetRef(t: TargetRef): string {
	const kind = t.kind || '';
	return `${kind}/${t.name || ''}`;
}

export function transformBackendTLSPolicy(raw: unknown): BackendTLSPolicyInfo {
	const p = raw as RawBackendTLSPolicy;
	const metadata = p.metadata ?? {};
	const spec = p.spec ?? {};
	return {
		...baseInfo(metadata),
		targetRefs: (spec.targetRefs ?? []).map(formatTargetRef),
		hostname: spec.validation?.hostname ?? ''
	};
}

export async function listBackendTLSPolicies(
	clusterId: number,
	namespace?: string
): Promise<{
	success: boolean;
	error?: string;
	backendTLSPolicies: BackendTLSPolicyInfo[];
	crdMissing?: boolean;
}> {
	const path = namespace
		? `${GW_V1ALPHA3}/namespaces/${namespace}/backendtlspolicies`
		: `${GW_V1ALPHA3}/backendtlspolicies`;
	const result = await makeClusterRequest<K8sList<RawBackendTLSPolicy>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error))
			return { success: true, backendTLSPolicies: [], crdMissing: true };
		return {
			success: false,
			error: result.error ?? 'Failed to fetch BackendTLSPolicies',
			backendTLSPolicies: []
		};
	}
	return { success: true, backendTLSPolicies: result.data.items.map(transformBackendTLSPolicy) };
}

export async function deleteBackendTLSPolicy(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `${GW_V1ALPHA3}/namespaces/${namespace}/backendtlspolicies/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return { success: false, error: result.error ?? `Failed to delete BackendTLSPolicy ${name}` };
	return { success: true };
}

// ── BackendTrafficPolicy (Envoy Gateway) ────────────────────────────────────

interface RawBackendTrafficPolicy {
	metadata?: BaseMeta;
	spec?: {
		targetRefs?: TargetRef[];
		targetRef?: TargetRef;
	};
}

export interface BackendTrafficPolicyInfo extends BaseInfo {
	targetRefs: string[];
}

export function transformBackendTrafficPolicy(raw: unknown): BackendTrafficPolicyInfo {
	const p = raw as RawBackendTrafficPolicy;
	const metadata = p.metadata ?? {};
	const spec = p.spec ?? {};
	const refs = spec.targetRefs ?? (spec.targetRef ? [spec.targetRef] : []);
	return {
		...baseInfo(metadata),
		targetRefs: refs.map(formatTargetRef)
	};
}

export async function listBackendTrafficPolicies(
	clusterId: number,
	namespace?: string
): Promise<{
	success: boolean;
	error?: string;
	backendTrafficPolicies: BackendTrafficPolicyInfo[];
	crdMissing?: boolean;
}> {
	const path = namespace
		? `${ENVOY_V1ALPHA1}/namespaces/${namespace}/backendtrafficpolicies`
		: `${ENVOY_V1ALPHA1}/backendtrafficpolicies`;
	const result = await makeClusterRequest<K8sList<RawBackendTrafficPolicy>>(clusterId, path, 30000);
	if (!result.success || !result.data) {
		if (isCrdMissing(result.error))
			return { success: true, backendTrafficPolicies: [], crdMissing: true };
		return {
			success: false,
			error: result.error ?? 'Failed to fetch BackendTrafficPolicies',
			backendTrafficPolicies: []
		};
	}
	return {
		success: true,
		backendTrafficPolicies: result.data.items.map(transformBackendTrafficPolicy)
	};
}

export async function deleteBackendTrafficPolicy(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `${ENVOY_V1ALPHA1}/namespaces/${namespace}/backendtrafficpolicies/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });
	if (!result.success)
		return {
			success: false,
			error: result.error ?? `Failed to delete BackendTrafficPolicy ${name}`
		};
	return { success: true };
}
