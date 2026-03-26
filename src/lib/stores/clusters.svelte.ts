export interface ClusterPublic {
	id: number;
	name: string;
	icon?: string | null;
	labels?: string[] | null;
	authType?: string | null;
	apiServer?: string | null;
	context?: string | null;
	namespace?: string | null;
	tlsSkipVerify?: boolean | null;
	isProvisioned?: boolean | null;
	hasKubeconfig?: boolean;
	hasBearerToken?: boolean;
	createdAt?: string | null;
	updatedAt?: string | null;
	metricsEnabled?: boolean | null;
	// Metric thresholds
	cpuWarnThreshold?: number | null;
	cpuCritThreshold?: number | null;
	memWarnThreshold?: number | null;
	memCritThreshold?: number | null;
	scanEnabled?: boolean | null;
	scannerPreference?: string | null;
}

let clusters = $state<ClusterPublic[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

export const clustersStore = {
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
			const res = await fetch('/api/clusters');
			if (!res.ok) throw new Error('Failed to fetch clusters');
			const data = await res.json();
			clusters = data.clusters ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	},

	async delete(id: number) {
		const res = await fetch(`/api/clusters/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to delete cluster');
		}
		clusters = clusters.filter((c) => c.id !== id);
	}
};
