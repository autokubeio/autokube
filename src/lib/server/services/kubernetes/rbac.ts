/**
 * Kubernetes RBAC Resources
 * Roles, RoleBindings, ClusterRoles, ClusterRoleBindings, ServiceAccounts
 */

import type {
	RoleInfo,
	RoleBindingInfo,
	ClusterRoleInfo,
	ClusterRoleBindingInfo,
	ServiceAccountInfo,
	ListRolesResult,
	ListRoleBindingsResult,
	ListClusterRolesResult,
	ListClusterRoleBindingsResult,
	ListServiceAccountsResult
} from './types';
import { makeClusterRequest } from './utils';

// ── Type Definitions ────────────────────────────────────────────────────────

type K8sRoleList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		rules?: Array<{
			apiGroups?: string[];
			resources?: string[];
			verbs: string[];
		}>;
	}>;
};

type K8sRoleBindingList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		roleRef?: {
			apiGroup?: string;
			kind?: string;
			name?: string;
		};
		subjects?: Array<{
			kind?: string;
			name?: string;
			namespace?: string;
		}>;
	}>;
};

type K8sClusterRoleList = {
	items: Array<{
		metadata: {
			name: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
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
	}>;
};

type K8sClusterRoleBindingList = {
	items: Array<{
		metadata: {
			name: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		roleRef?: {
			apiGroup?: string;
			kind?: string;
			name?: string;
		};
		subjects?: Array<{
			kind?: string;
			name?: string;
			namespace?: string;
		}>;
	}>;
};

type K8sServiceAccountList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		secrets?: Array<{ name?: string }>;
		imagePullSecrets?: Array<{ name?: string }>;
	}>;
};

// ── Roles ───────────────────────────────────────────────────────────────────

export async function listRoles(clusterId: number, namespace?: string): Promise<ListRolesResult> {
	const path = namespace
		? `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/roles`
		: '/apis/rbac.authorization.k8s.io/v1/roles';

	const result = await makeClusterRequest<K8sRoleList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch roles',
			roles: []
		};
	}

	const roles: RoleInfo[] = result.data.items.map((item) => ({
		id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
		name: item.metadata.name,
		namespace: item.metadata.namespace || 'default',
		rules: item.rules || [],
		labels: item.metadata.labels || {},
		annotations: item.metadata.annotations || {},
		createdAt: item.metadata.creationTimestamp || new Date().toISOString()
	}));

	return { success: true, roles };
}

export async function deleteRole(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/roles/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete role ${name}`
		};
	}

	return { success: true };
}

// ── RoleBindings ────────────────────────────────────────────────────────────

export async function listRoleBindings(
	clusterId: number,
	namespace?: string
): Promise<ListRoleBindingsResult> {
	const path = namespace
		? `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings`
		: '/apis/rbac.authorization.k8s.io/v1/rolebindings';

	const result = await makeClusterRequest<K8sRoleBindingList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch role bindings',
			roleBindings: []
		};
	}

	const roleBindings: RoleBindingInfo[] = result.data.items.map((item) => ({
		id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
		name: item.metadata.name,
		namespace: item.metadata.namespace || 'default',
		roleRef: item.roleRef || {},
		subjects: item.subjects || [],
		labels: item.metadata.labels || {},
		annotations: item.metadata.annotations || {},
		createdAt: item.metadata.creationTimestamp || new Date().toISOString()
	}));

	return { success: true, roleBindings };
}

export async function deleteRoleBinding(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete role binding ${name}`
		};
	}

	return { success: true };
}

// ── ClusterRoles ────────────────────────────────────────────────────────────

export async function listClusterRoles(clusterId: number): Promise<ListClusterRolesResult> {
	const path = '/apis/rbac.authorization.k8s.io/v1/clusterroles';

	const result = await makeClusterRequest<K8sClusterRoleList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch cluster roles',
			clusterRoles: []
		};
	}

	const clusterRoles: ClusterRoleInfo[] = result.data.items.map((item) => ({
		id: item.metadata.name,
		name: item.metadata.name,
		rules: item.rules || [],
		aggregationRule: item.aggregationRule,
		labels: item.metadata.labels || {},
		annotations: item.metadata.annotations || {},
		createdAt: item.metadata.creationTimestamp || new Date().toISOString()
	}));

	return { success: true, clusterRoles };
}

export async function deleteClusterRole(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/rbac.authorization.k8s.io/v1/clusterroles/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete cluster role ${name}`
		};
	}

	return { success: true };
}

// ── ClusterRoleBindings ─────────────────────────────────────────────────────

export async function listClusterRoleBindings(
	clusterId: number
): Promise<ListClusterRoleBindingsResult> {
	const path = '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings';

	const result = await makeClusterRequest<K8sClusterRoleBindingList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch cluster role bindings',
			clusterRoleBindings: []
		};
	}

	const clusterRoleBindings: ClusterRoleBindingInfo[] = result.data.items.map((item) => ({
		id: item.metadata.name,
		name: item.metadata.name,
		roleRef: item.roleRef || {},
		subjects: item.subjects || [],
		labels: item.metadata.labels || {},
		annotations: item.metadata.annotations || {},
		createdAt: item.metadata.creationTimestamp || new Date().toISOString()
	}));

	return { success: true, clusterRoleBindings };
}

export async function deleteClusterRoleBinding(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete cluster role binding ${name}`
		};
	}

	return { success: true };
}

// ── ServiceAccounts ─────────────────────────────────────────────────────────

export async function listServiceAccounts(
	clusterId: number,
	namespace?: string
): Promise<ListServiceAccountsResult> {
	const path = namespace
		? `/api/v1/namespaces/${namespace}/serviceaccounts`
		: '/api/v1/serviceaccounts';

	const result = await makeClusterRequest<K8sServiceAccountList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch service accounts',
			serviceAccounts: []
		};
	}

	const serviceAccounts: ServiceAccountInfo[] = result.data.items.map((item) => ({
		id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
		name: item.metadata.name,
		namespace: item.metadata.namespace || 'default',
		secrets: (item.secrets || []).length,
		imagePullSecrets: (item.imagePullSecrets || []).length,
		secretNames: (item.secrets || []).map((s) => s.name || ''),
		labels: item.metadata.labels || {},
		annotations: item.metadata.annotations || {},
		createdAt: item.metadata.creationTimestamp || new Date().toISOString()
	}));

	return { success: true, serviceAccounts };
}

export async function deleteServiceAccount(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/serviceaccounts/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete service account ${name}`
		};
	}

	return { success: true };
}
