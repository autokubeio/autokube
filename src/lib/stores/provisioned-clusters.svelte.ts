// Svelte 5 rune-based store for provisioned clusters

export interface ProvisionedClusterPublic {
	id: number;
	clusterName: string;
	provider: string;
	k3sVersion: string;
	protectAgainstDeletion: boolean | null;
	createLoadBalancer: boolean | null;
	apiServerHostname: string | null;
	hasProviderToken: boolean;
	hasKubeconfig: boolean;
	networkingConfig: string | null;
	mastersPoolConfig: string | null;
	workerPoolsConfig: string | null;
	addonsConfig: string | null;
	datastoreConfig: string | null;
	status: string | null;
	statusMessage: string | null;
	lastProvisioned: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface ProvisioningLog {
	id: number;
	provisionedClusterId: number;
	message: string;
	level: string;
	createdAt: string | null;
}

let clusters = $state<ProvisionedClusterPublic[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

export const provisionedClustersStore = {
	get clusters() {
		return clusters;
	},
	get loading() {
		return loading;
	},
	get error() {
		return error;
	},

	async fetch() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/provisioning');
			if (!res.ok) throw new Error('Failed to fetch provisioned clusters');
			const data = await res.json();
			clusters = data.clusters ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	},

	async create(input: {
		clusterName: string;
		provider: string;
		k3sVersion?: string;
		providerToken?: string;
		protectAgainstDeletion?: boolean;
		createLoadBalancer?: boolean;
		networkingConfig?: unknown;
		mastersPoolConfig?: unknown;
		workerPoolsConfig?: unknown;
	}): Promise<ProvisionedClusterPublic> {
		const res = await fetch('/api/provisioning', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input)
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? 'Failed to create');
		await provisionedClustersStore.fetch();
		return data.cluster;
	},

	async update(id: number, patch: Partial<ProvisionedClusterPublic>) {
		const res = await fetch(`/api/provisioning/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? 'Failed to update');
		clusters = clusters.map((c) => (c.id === id ? { ...c, ...patch } : c));
		return data.cluster as ProvisionedClusterPublic;
	},

	async delete(id: number) {
		const res = await fetch(`/api/provisioning/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to delete');
		}
		clusters = clusters.filter((c) => c.id !== id);
	},

	async fetchLogs(id: number): Promise<ProvisioningLog[]> {
		const res = await fetch(`/api/provisioning/${id}/logs`);
		if (!res.ok) throw new Error('Failed to fetch logs');
		const data = await res.json();
		return data.logs ?? [];
	},

	async clearLogs(id: number): Promise<void> {
		const res = await fetch(`/api/provisioning/${id}/logs`, { method: 'DELETE' });
		if (!res.ok) throw new Error('Failed to clear logs');
	}
};
