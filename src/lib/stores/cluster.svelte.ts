import type { LayoutDashboard } from 'lucide-svelte';
import { Server } from 'lucide-svelte';
import { clustersStore, type ClusterPublic } from './clusters.svelte';

function endpointLabel(c: ClusterPublic): string {
	if (c.authType === 'agent') return 'Agent';
	if (c.authType === 'kubeconfig') return c.context || 'kubeconfig';
	return c.apiServer || c.context || 'Unknown';
}

const ACTIVE_CLUSTER_KEY = 'autokube:activeClusterId';

export interface ClusterInfo {
	id: number;
	name: string;
	icon: typeof LayoutDashboard;
	status: 'connected' | 'disconnected' | 'warning' | 'unknown';
	region: string;
	health: 'Healthy' | 'Degraded' | 'Unhealthy' | 'Unknown';
	version: string;
	nodes: number;
	namespaces: number;
	pods: number;
	runningPods: number;
	user: string;
	/** CPU capacity in millicores */
	cpuCapacity: number;
	/** CPU usage in millicores */
	cpuUsage: number;
	/** Memory capacity in bytes */
	memoryCapacity: number;
	/** Memory usage in bytes */
	memoryUsage: number;
	/** Disk capacity in bytes (ephemeral-storage) */
	diskCapacity: number;
	/** Disk usage in bytes (capacity - allocatable) */
	diskUsage: number;
	/** Whether metrics-server is available */
	metricsAvailable: boolean;
	/** User-assigned labels (e.g. production, staging) */
	labels: string[];
	// Metric thresholds (from cluster config)
	cpuWarnThreshold: number;
	cpuCritThreshold: number;
	memWarnThreshold: number;
	memCritThreshold: number;
	/** Whether image scanning is enabled for this cluster */
	scanEnabled: boolean;
}

let active = $state<ClusterInfo | null>(null);
let all = $state<ClusterInfo[]>([]);
let loading = $state(false);
let statusPollingTimer: ReturnType<typeof setInterval> | null = null;
const STATUS_POLL_INTERVAL = 30_000; // 30 seconds

export const clusterStore = {
	get active() {
		return active;
	},
	get all() {
		return all;
	},
	get loading() {
		return loading;
	},

	async fetchClusters() {
		loading = true;
		try {
			await clustersStore.fetch();
			const clusters = clustersStore.clusters;

			// Transform to ClusterInfo format with default values
			all = clusters.map((c) => ({
				id: c.id,
				name: c.name,
				icon: Server,
				status: 'unknown' as const,
				region: endpointLabel(c),
				health: 'Unknown' as const,
				version: 'Loading...',
				nodes: 0,
				namespaces: 0,
				pods: 0,
				runningPods: 0,
				user: c.context || 'default',
				cpuCapacity: 0,
				cpuUsage: 0,
				memoryCapacity: 0,
				memoryUsage: 0,
				diskCapacity: 0,
				diskUsage: 0,
			metricsAvailable: false,
			labels: c.labels ?? [],
			cpuWarnThreshold: c.cpuWarnThreshold ?? 60,
			cpuCritThreshold: c.cpuCritThreshold ?? 80,
			memWarnThreshold: c.memWarnThreshold ?? 60,
			memCritThreshold: c.memCritThreshold ?? 80,
			scanEnabled: c.scanEnabled ?? false,
			}));

			// Validate active cluster still exists in the fresh list
			if (active && all.length > 0 && !all.find((c) => c.id === active!.id)) {
				console.info(`[ClusterStore] Active cluster #${active.id} no longer exists, resetting`);
				try { localStorage.removeItem(ACTIVE_CLUSTER_KEY); } catch {}
				active = null;
			}

			// Restore previously selected cluster from localStorage, fall back to first
			if (!active && all.length > 0) {
				let savedId: number | null = null;
				try {
					const raw = localStorage.getItem(ACTIVE_CLUSTER_KEY);
					if (raw) savedId = Number(raw);
				} catch { /* localStorage unavailable (SSR / private mode) */ }

				const preferred = savedId ? all.find((c) => c.id === savedId) : null;
				if (savedId && !preferred) {
					// Saved cluster was deleted — clear stale reference
					try { localStorage.removeItem(ACTIVE_CLUSTER_KEY); } catch {}
					console.info(`[ClusterStore] Saved cluster #${savedId} no longer exists, switching to first available`);
				}
				active = preferred ?? all[0];
				await this.fetchClusterInfo(active.id);
			}
		} catch (err) {
			console.error('[ClusterStore] Failed to fetch clusters:', err);
		} finally {
			loading = false;
		}
	},

	async fetchClusterInfo(clusterId: number) {
		try {
			const res = await fetch(`/api/clusters/${clusterId}/info`);
			if (!res.ok) return;

			const data = await res.json();

			// Update the cluster in the list
			const index = all.findIndex((c) => c.id === clusterId);
			if (index !== -1) {
				all[index] = {
					...all[index],
					status: data.status || 'unknown',
					health: data.health || 'Unknown',
					version: data.version || 'Unknown',
					pods: data.pods || 0,
					runningPods: data.runningPods || 0,
					nodes: data.nodes || 0,
					namespaces: data.namespaces || 0,
					cpuCapacity: data.cpuCapacity ?? 0,
					cpuUsage: data.cpuUsage ?? 0,
					memoryCapacity: data.memoryCapacity ?? 0,
					memoryUsage: data.memoryUsage ?? 0,
					diskCapacity: data.diskCapacity ?? 0,
					diskUsage: data.diskUsage ?? 0,
					metricsAvailable: data.metricsAvailable ?? false
				};

				// Update active cluster if it's the one we just fetched
				if (active?.id === clusterId) {
					active = all[index];
				}
			}
		} catch (err) {
			console.error(`[ClusterStore] Failed to fetch info for cluster ${clusterId}:`, err);
		}
	},

	setActive(cluster: ClusterInfo) {
		active = cluster;
		try {
			localStorage.setItem(ACTIVE_CLUSTER_KEY, String(cluster.id));
		} catch { /* localStorage unavailable */ }
		// Fetch fresh info when switching clusters
		this.fetchClusterInfo(cluster.id);
	},

	setClusters(clusters: ClusterInfo[]) {
		all = clusters;
		if (clusters.length > 0 && !active) {
			active = clusters[0];
		}
	},

	/**
	 * Fetch status/info for ALL clusters in parallel.
	 * Updates each cluster's status, health, version, nodes, namespaces.
	 */
	async fetchAllStatuses() {
		if (all.length === 0) return;

		const results = await Promise.allSettled(
			all.map(async (c) => {
				const res = await fetch(`/api/clusters/${c.id}/info`);
				if (!res.ok) return { id: c.id, status: 'disconnected' as const };
				const data = await res.json();
				return { id: c.id, ...data };
			})
		);

		for (const result of results) {
			if (result.status !== 'fulfilled') continue;
			const data = result.value;
			const index = all.findIndex((c) => c.id === data.id);
			if (index === -1) continue;

			all[index] = {
				...all[index],
				status: data.status || 'unknown',
				health: data.health || 'Unknown',
				version: data.version || 'Unknown',
				pods: data.pods ?? all[index].pods,
				runningPods: data.runningPods ?? all[index].runningPods,
				nodes: data.nodes ?? all[index].nodes,
				namespaces: data.namespaces ?? all[index].namespaces,
				cpuCapacity: data.cpuCapacity ?? all[index].cpuCapacity,
				cpuUsage: data.cpuUsage ?? all[index].cpuUsage,
				memoryCapacity: data.memoryCapacity ?? all[index].memoryCapacity,
				memoryUsage: data.memoryUsage ?? all[index].memoryUsage,
				diskCapacity: data.diskCapacity ?? all[index].diskCapacity,
				diskUsage: data.diskUsage ?? all[index].diskUsage,
				metricsAvailable: data.metricsAvailable ?? all[index].metricsAvailable
			};

			if (active?.id === data.id) {
				active = all[index];
			}
		}
	},

	/** Start background polling for all cluster statuses */
	startPolling() {
		this.stopPolling();
		// Immediate first fetch
		this.fetchAllStatuses();
		statusPollingTimer = setInterval(() => {
			this.fetchAllStatuses();
		}, STATUS_POLL_INTERVAL);
	},

	/** Stop background polling */
	stopPolling() {
		if (statusPollingTimer) {
			clearInterval(statusPollingTimer);
			statusPollingTimer = null;
		}
	},

	/**
	 * Add a new cluster or refresh an existing one in the store,
	 * then immediately fetch its connection info.
	 * Call this after a cluster is created or updated.
	 */
	async addOrRefresh(id: number) {
		const raw = clustersStore.clusters.find((c) => c.id === id);
		if (!raw) return;

		const existingIndex = all.findIndex((c) => c.id === id);
		if (existingIndex === -1) {
			// New cluster — add with unknown status
			all = [
				...all,
				{
					id: raw.id,
					name: raw.name,
					icon: Server,
					status: 'unknown' as const,
					region: endpointLabel(raw),
					health: 'Unknown' as const,
					version: 'Connecting...',
					nodes: 0,
					namespaces: 0,
					pods: 0,
					runningPods: 0,
					user: raw.context || 'default',
					cpuCapacity: 0,
					cpuUsage: 0,
					memoryCapacity: 0,
					memoryUsage: 0,
					diskCapacity: 0,
					diskUsage: 0,
					metricsAvailable: false
				}
			];
		} else {
			// Existing cluster — sync name/region in case they changed
			all[existingIndex] = {
				...all[existingIndex],
				name: raw.name,
				region: endpointLabel(raw)
			};
			if (active?.id === id) {
				active = all[existingIndex];
			}
		}

		// Immediately test connection
		await this.fetchClusterInfo(id);
	},

	/**
	 * Remove a cluster from the in-memory store.
	 * Call this after a cluster is deleted so the dashboard grid can react immediately.
	 */
	remove(id: number) {
		all = all.filter((c) => c.id !== id);
		if (active?.id === id) {
			active = all.length > 0 ? all[0] : null;
		}
	}
};
