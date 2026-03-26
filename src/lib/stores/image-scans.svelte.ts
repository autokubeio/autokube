import type { ImageScanListItem, ImageScanWithVulns, VulnerabilitySummary } from '$lib/server/queries/image-scans';

// ── Types ───────────────────────────────────────────────────────────────────

export type { ImageScanListItem, ImageScanWithVulns, VulnerabilitySummary };

export interface ScannerStatus {
	available: boolean;
	version: string | null;
}

export interface ScanStats {
	totalScans: number;
	completedScans: number;
	vulnerabilities: { critical: number; high: number; medium: number; low: number };
}

export interface ScanSchedule {
	id: number;
	clusterId: number | null;
	enabled: boolean | null;
	cronExpression: string;
	namespaces: string | null;
	lastRunAt: string | null;
	nextRunAt: string | null;
}

// ── State ───────────────────────────────────────────────────────────────────

let scans = $state<ImageScanListItem[]>([]);
let total = $state(0);
let loading = $state(false);
let error = $state<string | null>(null);
let scannerStatus = $state<ScannerStatus | null>(null);
let stats = $state<ScanStats | null>(null);
let scanning = $state(false);

// ── Store ───────────────────────────────────────────────────────────────────

export const imageScansStore = {
	get scans() { return scans; },
	get total() { return total; },
	get loading() { return loading; },
	get error() { return error; },
	get scannerStatus() { return scannerStatus; },
	get stats() { return stats; },
	get scanning() { return scanning; },

	async fetchScans(filters: {
		clusterId?: number;
		status?: string;
		severity?: string;
		image?: string;
		limit?: number;
		offset?: number;
		grouped?: boolean;
	} = {}) {
		loading = true;
		error = null;
		try {
			const params = new URLSearchParams();
			if (filters.clusterId) params.set('clusterId', String(filters.clusterId));
			if (filters.status) params.set('status', filters.status);
			if (filters.severity) params.set('severity', filters.severity);
			if (filters.image) params.set('image', filters.image);
			if (filters.limit) params.set('limit', String(filters.limit));
			if (filters.offset) params.set('offset', String(filters.offset));
			if (filters.grouped) params.set('grouped', 'true');

			const res = await fetch(`/api/image-scans?${params}`);
			if (!res.ok) throw new Error('Failed to fetch scans');
			const data = await res.json();
			scans = data.scans ?? [];
			total = data.total ?? 0;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			loading = false;
		}
	},

	async fetchScan(id: number): Promise<ImageScanWithVulns | null> {
		try {
			const res = await fetch(`/api/image-scans/${id}`);
			if (!res.ok) throw new Error('Failed to fetch scan');
			const data = await res.json();
			return data.scan ?? null;
		} catch {
			return null;
		}
	},

	async fetchStatus() {
		try {
			const res = await fetch('/api/image-scans?info=status');
			if (!res.ok) throw new Error('Failed to fetch scanner status');
			scannerStatus = await res.json();
		} catch {
			scannerStatus = { available: false, version: null };
		}
	},

	async fetchStats(clusterId?: number) {
		try {
			const params = new URLSearchParams({ info: 'stats' });
			if (clusterId) params.set('clusterId', String(clusterId));
			const res = await fetch(`/api/image-scans?${params}`);
			if (!res.ok) throw new Error('Failed to fetch stats');
			stats = await res.json();
		} catch {
			stats = null;
		}
	},

	async startScan(image: string, options: {
		tag?: string;
		clusterId?: number;
		resource?: string;
		resourceNamespace?: string;
	} = {}) {
		scanning = true;
		error = null;
		try {
			const res = await fetch('/api/image-scans', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image, ...options })
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? 'Failed to start scan');
			}
			const data = await res.json();
			return data.scan;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
			throw err;
		} finally {
			scanning = false;
		}
	},

	async scanAllClusterImages(clusterId: number, forceRescan: boolean = false) {
		scanning = true;
		error = null;
		try {
			const res = await fetch('/api/image-scans', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ scanAll: true, clusterId, forceRescan })
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? 'Failed to scan cluster images');
			}
			const data = await res.json();
			return data;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
			throw err;
		} finally {
			scanning = false;
		}
	},

	async cancelScan() {
		try {
			const res = await fetch('/api/image-scans', { method: 'PATCH' });
			if (!res.ok) throw new Error('Failed to cancel scan');
			scanning = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		}
	},

	async deleteScan(id: number) {
		const res = await fetch(`/api/image-scans/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to delete scan');
		}
		scans = scans.filter((s) => s.id !== id);
		total = Math.max(0, total - 1);
	},

	async resetScan(id: number) {
		const res = await fetch(`/api/image-scans/${id}`, { method: 'PATCH' });
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error ?? 'Failed to reset scan');
		}
		scans = scans.map((s) =>
			s.id === id ? { ...s, status: 'failed', errorMessage: 'Manually reset — scan job did not complete' } : s
		);
	},

	async fetchScanHistory(image: string, tag?: string, clusterId?: number): Promise<ImageScanListItem[]> {
		const params = new URLSearchParams({ info: 'history', image });
		if (tag) params.set('tag', tag);
		if (clusterId) params.set('clusterId', String(clusterId));
		const res = await fetch(`/api/image-scans?${params}`);
		if (!res.ok) throw new Error('Failed to fetch scan history');
		const data = await res.json();
		return data.history ?? [];
	},

	async cleanupOldScans(retentionDays: number = 30) {
		const res = await fetch(`/api/image-scans?retentionDays=${retentionDays}`, {
			method: 'DELETE'
		});
		if (!res.ok) throw new Error('Failed to cleanup old scans');
		const data = await res.json();
		await this.fetchScans();
		return data.deleted;
	}
};
