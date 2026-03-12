/**
 * Kubernetes Storage & Configuration Resources
 * ConfigMaps, Secrets, PVs, PVCs, StorageClasses, ResourceQuotas, LimitRanges
 */

import type {
	ConfigMapInfo,
	SecretInfo,
	PersistentVolumeInfo,
	PersistentVolumeClaimInfo,
	StorageClassInfo,
	ResourceQuotaInfo,
	LimitRangeInfo,
	ListConfigMapsResult,
	ListSecretsResult,
	ListPersistentVolumesResult,
	ListPersistentVolumeClaimsResult,
	ListStorageClassesResult,
	ListResourceQuotasResult,
	ListLimitRangesResult
} from './types';
import { makeClusterRequest } from './utils';

// ── Type Definitions ────────────────────────────────────────────────────────

type K8sConfigMapList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		data?: Record<string, string>;
		binaryData?: Record<string, string>;
	}>;
};

type K8sSecretList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		type?: string;
		data?: Record<string, string>;
	}>;
};

type K8sPersistentVolumeList = {
	items: Array<{
		metadata: {
			name: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			capacity?: { storage?: string };
			accessModes?: string[];
			persistentVolumeReclaimPolicy?: string;
			storageClassName?: string;
			volumeMode?: string;
			claimRef?: {
				namespace?: string;
				name?: string;
			};
		};
		status?: {
			phase?: string;
		};
	}>;
};

type K8sPersistentVolumeClaimList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			volumeName?: string;
			accessModes?: string[];
			storageClassName?: string;
			volumeMode?: string;
			resources?: {
				requests?: {
					storage?: string;
				};
			};
		};
		status?: {
			phase?: string;
			capacity?: {
				storage?: string;
			};
		};
	}>;
};

type K8sStorageClassList = {
	items: Array<{
		metadata: {
			name: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		provisioner?: string;
		reclaimPolicy?: string;
		volumeBindingMode?: string;
		allowVolumeExpansion?: boolean;
		parameters?: Record<string, string>;
	}>;
};

type K8sResourceQuotaList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			hard?: Record<string, string>;
		};
		status?: {
			used?: Record<string, string>;
		};
	}>;
};

type K8sLimitRangeList = {
	items: Array<{
		metadata: {
			name: string;
			namespace?: string;
			creationTimestamp?: string;
			labels?: Record<string, string>;
			annotations?: Record<string, string>;
		};
		spec?: {
			limits?: Array<{
				type?: string;
				max?: Record<string, string>;
				min?: Record<string, string>;
				default?: Record<string, string>;
				defaultRequest?: Record<string, string>;
			}>;
		};
	}>;
};

// ── ConfigMaps ──────────────────────────────────────────────────────────────

export async function listConfigMaps(
	clusterId: number,
	namespace?: string
): Promise<ListConfigMapsResult> {
	const path = namespace ? `/api/v1/namespaces/${namespace}/configmaps` : '/api/v1/configmaps';

	const result = await makeClusterRequest<K8sConfigMapList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch config maps',
			configMaps: []
		};
	}

	const configMaps: ConfigMapInfo[] = result.data.items.map((item) => {
		const data = item.data || {};
		const binaryData = item.binaryData || {};

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			dataCount: Object.keys(data).length,
			data,
			binaryData,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, configMaps };
}

export async function deleteConfigMap(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/configmaps/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete config map ${name}`
		};
	}

	return { success: true };
}

// ── Secrets ─────────────────────────────────────────────────────────────────

export async function listSecrets(
	clusterId: number,
	namespace?: string
): Promise<ListSecretsResult> {
	const path = namespace ? `/api/v1/namespaces/${namespace}/secrets` : '/api/v1/secrets';

	const result = await makeClusterRequest<K8sSecretList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch secrets',
			secrets: []
		};
	}

	const secrets: SecretInfo[] = result.data.items.map((item) => {
		const data = item.data || {};
		const secretType = item.type || 'Opaque';

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			type: secretType,
			dataCount: Object.keys(data).length,
			data,
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, secrets };
}

export async function deleteSecret(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/secrets/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete secret ${name}`
		};
	}

	return { success: true };
}

// ── Persistent Volumes ──────────────────────────────────────────────────────

export async function listPersistentVolumes(
	clusterId: number
): Promise<ListPersistentVolumesResult> {
	const path = '/api/v1/persistentvolumes';

	const result = await makeClusterRequest<K8sPersistentVolumeList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch persistent volumes',
			persistentVolumes: []
		};
	}

	const persistentVolumes: PersistentVolumeInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		return {
			id: item.metadata.name,
			name: item.metadata.name,
			capacity: spec.capacity?.storage || 'Unknown',
			accessModes: spec.accessModes || [],
			reclaimPolicy: spec.persistentVolumeReclaimPolicy || 'Retain',
			status: status.phase || 'Unknown',
			claim: spec.claimRef ? `${spec.claimRef.namespace}/${spec.claimRef.name}` : '',
			storageClass: spec.storageClassName || '',
			volumeMode: spec.volumeMode || 'Filesystem',
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, persistentVolumes };
}

export async function deletePersistentVolume(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/persistentvolumes/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete persistent volume ${name}`
		};
	}

	return { success: true };
}

// ── Persistent Volume Claims ────────────────────────────────────────────────

export async function listPersistentVolumeClaims(
	clusterId: number,
	namespace?: string
): Promise<ListPersistentVolumeClaimsResult> {
	const path = namespace
		? `/api/v1/namespaces/${namespace}/persistentvolumeclaims`
		: '/api/v1/persistentvolumeclaims';

	const result = await makeClusterRequest<K8sPersistentVolumeClaimList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch persistent volume claims',
			persistentVolumeClaims: []
		};
	}

	const persistentVolumeClaims: PersistentVolumeClaimInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			status: status.phase || 'Unknown',
			volume: spec.volumeName || '',
			capacity: status.capacity?.storage || spec.resources?.requests?.storage || 'Unknown',
			accessModes: spec.accessModes || [],
			storageClass: spec.storageClassName || '',
			volumeMode: spec.volumeMode || 'Filesystem',
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, persistentVolumeClaims };
}

export async function deletePVC(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete persistent volume claim ${name}`
		};
	}

	return { success: true };
}

// ── Storage Classes ─────────────────────────────────────────────────────────

export async function listStorageClasses(clusterId: number): Promise<ListStorageClassesResult> {
	const path = '/apis/storage.k8s.io/v1/storageclasses';

	const result = await makeClusterRequest<K8sStorageClassList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch storage classes',
			storageClasses: []
		};
	}

	const storageClasses: StorageClassInfo[] = result.data.items.map((item) => {
		const provisioner = item.provisioner || 'Unknown';
		const reclaimPolicy = item.reclaimPolicy || 'Delete';
		const volumeBindingMode = item.volumeBindingMode || 'Immediate';
		const allowVolumeExpansion = item.allowVolumeExpansion || false;
		const isDefault =
			item.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true';

		return {
			id: item.metadata.name,
			name: item.metadata.name,
			provisioner,
			reclaimPolicy,
			volumeBindingMode,
			allowVolumeExpansion,
			isDefault,
			parameters: item.parameters || {},
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, storageClasses };
}

export async function deleteStorageClass(
	clusterId: number,
	name: string
): Promise<{ success: boolean; error?: string }> {
	const path = `/apis/storage.k8s.io/v1/storageclasses/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete storage class ${name}`
		};
	}

	return { success: true };
}

// ── Resource Quotas ─────────────────────────────────────────────────────────

export async function listResourceQuotas(
	clusterId: number,
	namespace?: string
): Promise<ListResourceQuotasResult> {
	const path = namespace
		? `/api/v1/namespaces/${namespace}/resourcequotas`
		: '/api/v1/resourcequotas';

	const result = await makeClusterRequest<K8sResourceQuotaList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch resource quotas',
			resourceQuotas: []
		};
	}

	const resourceQuotas: ResourceQuotaInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};
		const status = item.status || {};

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			hard: spec.hard || {},
			used: status.used || {},
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, resourceQuotas };
}

export async function deleteResourceQuota(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/resourcequotas/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete resource quota ${name}`
		};
	}

	return { success: true };
}

// ── Limit Ranges ────────────────────────────────────────────────────────────

export async function listLimitRanges(
	clusterId: number,
	namespace?: string
): Promise<ListLimitRangesResult> {
	const path = namespace ? `/api/v1/namespaces/${namespace}/limitranges` : '/api/v1/limitranges';

	const result = await makeClusterRequest<K8sLimitRangeList>(clusterId, path, 30000);

	if (!result.success || !result.data) {
		return {
			success: false,
			error: result.error ?? 'Failed to fetch limit ranges',
			limitRanges: []
		};
	}

	const limitRanges: LimitRangeInfo[] = result.data.items.map((item) => {
		const spec = item.spec || {};

		return {
			id: `${item.metadata.namespace || 'default'}/${item.metadata.name}`,
			name: item.metadata.name,
			namespace: item.metadata.namespace || 'default',
			limits: spec.limits || [],
			labels: item.metadata.labels || {},
			annotations: item.metadata.annotations || {},
			createdAt: item.metadata.creationTimestamp || new Date().toISOString()
		};
	});

	return { success: true, limitRanges };
}

export async function deleteLimitRange(
	clusterId: number,
	name: string,
	namespace = 'default'
): Promise<{ success: boolean; error?: string }> {
	const path = `/api/v1/namespaces/${namespace}/limitranges/${name}`;
	const result = await makeClusterRequest(clusterId, path, 30000, { method: 'DELETE' });

	if (!result.success) {
		return {
			success: false,
			error: result.error ?? `Failed to delete limit range ${name}`
		};
	}

	return { success: true };
}
