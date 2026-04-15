<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import NamespaceSelect from '$lib/components/namespace-select.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import MetricsCell from '$lib/components/metrics-cell.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson, parseCpu, parseMemory } from '$lib/utils/formatters';
	import { arrayModify, arrayDelete, arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Container,
		Info,
		Trash2,
		Loader2,
		FileCode,
		FileText,
		Terminal,
		FolderOpen
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { useMetricsWatch, type PodMetric } from '$lib/hooks/use-metrics-watch.svelte';
	import { onDestroy } from 'svelte';
	import { type Pod, type PodWithAge, getStatusIcon, getStatusColor } from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, podsColumns } from '$lib/table-columns';
	import { clustersStore } from '$lib/stores/clusters.svelte';
	import { toast } from 'svelte-sonner';
	import PodLogViewer from '$lib/components/pod-log-viewer.svelte';
	import PodTerminal from '$lib/components/pod-terminal.svelte';
	import PodFilesystemViewer from '$lib/components/pod-filesystem-viewer.svelte';
	import type { FilesystemPod } from '$lib/components/pod-filesystem-viewer.svelte';
	import ResourceDrawer from '$lib/components/resource-drawer.svelte';
	import type { ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	// Track only the cluster ID so the $effect below does NOT re-run on every
	// 30 s cluster-info poll (which replaces `active` with a new object reference
	// even though the id is unchanged — previously that reset allPods every 30 s).
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	const metricsEnabled = $derived(
		clustersStore.clusters.find((c) => c.id === activeCluster?.id)?.metricsEnabled !== false
	);
	const visibleColumns = $derived(
		metricsEnabled ? podsColumns : podsColumns.filter((c) => c.id !== 'cpu' && c.id !== 'memory')
	);
	let allPods = $state<Pod[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let metricsMap = $state(new Map<string, { cpu: string; memory: string }>());
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedPod = $state<PodWithAge | null>(null);
	let deleting = $state(false);

	// Log viewer
	let showLogViewer = $state(false);
	let logViewerPod = $state<PodWithAge | null>(null);

	// Terminal
	let showTerminal = $state(false);
	let terminalPod = $state<PodWithAge | null>(null);

	// Filesystem viewer
	let showFilesystem = $state(false);
	let filesystemPod = $state<FilesystemPod | null>(null);

	// Resource Drawer
	let showDrawer = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// ── Step 1: merge metrics into pods ─────────────────────────────────────
	// Only recalculates when allPods or metricsMap changes — NOT on ticker.
	// With metrics batching below this is at most 4×/second regardless of
	// how many metric events the SSE sends.
	const podsWithMetrics = $derived.by(() => {
		return allPods.map((pod) => {
			const metricKey = `${pod.namespace}/${pod.name}`;
			const metrics = metricsMap.get(metricKey);
			return {
				...pod,
				cpu: metrics?.cpu || pod.cpu || '0m',
				memory: metrics?.memory || pod.memory || '0Mi'
			};
		});
	});

	// ── Step 2: add age from ticker ──────────────────────────────────────────
	// Recalculates every 10s (ticker) OR when pod list/metrics change.
	// Keeping age separate means a ticker tick does not re-read metricsMap.
	const podsWithAge = $derived.by((): PodWithAge[] => {
		const currentTime = timeTicker.now;
		return podsWithMetrics.map((pod) => ({
			...pod,
			// Composite key — pods in different namespaces can share the same name.
			// The data-table uses this as the {#each} key to avoid duplicates.
			id: `${pod.namespace}/${pod.name}`,
			age: calculateAgeWithTicker(pod.createdAt, currentTime)
		}));
	});

	// Filtered pods
	const filteredPods = $derived.by(() => {
		let result = podsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((pod) => pod.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(pod) =>
					pod.name.toLowerCase().includes(query) ||
					pod.namespace.toLowerCase().includes(query) ||
					pod.status.toLowerCase().includes(query) ||
					pod.node.toLowerCase().includes(query) ||
					pod.ip.includes(query)
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof Pod, sortState.direction, {
				createdAt: (val: any) => new Date(val).getTime(),
				restarts: (val: any) => Number(val),
				cpu: (val: any) => parseCpu(val || '0'),
				memory: (val: any) => parseMemory(val || '0')
			});
		}

		return result;
	});

	// ── Unified SSE batch buffer ─────────────────────────────────────────────
	// All pod changes (ADDED / MODIFIED / DELETED) are accumulated here and
	// flushed in one allPods write every POD_FLUSH_DELAY ms.
	//
	// Key insight: if the same pod appears in both "adds" and "deletes" within
	// the same flush window (e.g. a crash-looping pod that is created then
	// removed within 200 ms), the two events CANCEL OUT — allPods never
	// changes and the virtual scroll never jumps.
	//
	// Previous design applied deletes immediately and adds after 50 ms, which
	// caused rapid 565 ↔ 566 oscillation and virtual-scroll disruption.
	const POD_FLUSH_DELAY = 200; // ms — enough to absorb rapid create/delete pairs

	let _pendingAdds: Map<string, Pod> = new Map();    // key → latest ADDED pod
	let _pendingModifies: Map<string, Pod> = new Map(); // key → latest MODIFIED pod
	let _pendingDeletes: Set<string> = new Set();       // keys to remove
	let _podBatchTimer: ReturnType<typeof setTimeout> | null = null;

	// Metrics updates are the hottest path: the SSE poll fires every 3 s and
	// can send one MODIFIED event per pod. We flush in a separate, independent
	// timer so that metrics updates never interfere with pod-list stability.
	let _metricsUpdateBuffer = new Map<string, { cpu: string; memory: string }>();
	let _metricsDeleteBuffer = new Set<string>();
	let _metricsFlushTimer: ReturnType<typeof setTimeout> | null = null;

	function flushPodChanges() {
		_podBatchTimer = null;

		const adds    = _pendingAdds;
		const modifies = _pendingModifies;
		const deletes  = _pendingDeletes;
		_pendingAdds    = new Map();
		_pendingModifies = new Map();
		_pendingDeletes  = new Set();

		if (adds.size === 0 && modifies.size === 0 && deletes.size === 0) return;

		// ── 1. Apply deletes ────────────────────────────────────────────────
		let arr = deletes.size > 0
			? allPods.filter((p) => !deletes.has(`${p.namespace}/${p.name}`))
			: allPods;

		// ── 2. Apply modifies (skip pods that were also deleted) ────────────
		for (const [key, pod] of modifies) {
			if (deletes.has(key)) continue; // deleted in same window — skip
			const idx = arr.findIndex((p) => `${p.namespace}/${p.name}` === key);
			if (idx >= 0) {
				arr = [...arr.slice(0, idx), pod, ...arr.slice(idx + 1)];
			} else if (!adds.has(key)) {
				// MODIFIED arrived before ADDED — upsert only if not coming via adds
				arr = [...arr, pod];
			}
		}

		// ── 3. Apply adds (skip pods deleted in the same window) ───────────
		const existingKeys = new Set(arr.map((p) => `${p.namespace}/${p.name}`));
		const fresh: Pod[] = [];
		for (const [key, pod] of adds) {
			if (deletes.has(key)) continue; // add+delete cancelled out
			if (!existingKeys.has(key)) {
				existingKeys.add(key);
				fresh.push(pod);
			}
		}
		if (fresh.length > 0) arr = [...arr, ...fresh];

		allPods = arr; // ONE state write for all pending changes
	}

	function flushMetrics() {
		_metricsFlushTimer = null;
		if (_metricsUpdateBuffer.size === 0 && _metricsDeleteBuffer.size === 0) return;
		const next = new Map(metricsMap);
		for (const [k, v] of _metricsUpdateBuffer) next.set(k, v);
		for (const k of _metricsDeleteBuffer) next.delete(k);
		_metricsUpdateBuffer.clear();
		_metricsDeleteBuffer.clear();
		metricsMap = next; // ONE state update regardless of how many events arrived
	}

	function schedulePodFlush() {
		if (!_podBatchTimer) _podBatchTimer = setTimeout(flushPodChanges, POD_FLUSH_DELAY);
	}

	function queueAdd(pod: Pod) {
		const key = `${pod.namespace}/${pod.name}`;
		_pendingAdds.set(key, pod);
		_pendingDeletes.delete(key); // add wins over a stale delete in same window
		schedulePodFlush();
	}

	function queueModify(pod: Pod) {
		const key = `${pod.namespace}/${pod.name}`;
		_pendingModifies.set(key, pod);
		schedulePodFlush();
	}

	function queueDelete(pod: Pod) {
		const key = `${pod.namespace}/${pod.name}`;
		_pendingDeletes.add(key);
		_pendingAdds.delete(key);    // add+delete in same window → cancel out
		_pendingModifies.delete(key);
		schedulePodFlush();
	}

	function queueMetricUpdate(metric: PodMetric) {
		const key = `${metric.namespace}/${metric.name}`;
		_metricsUpdateBuffer.set(key, { cpu: metric.cpu, memory: metric.memory });
		_metricsDeleteBuffer.delete(key);
		if (!_metricsFlushTimer) _metricsFlushTimer = setTimeout(flushMetrics, 250);
	}

	function queueMetricDelete(metric: PodMetric) {
		const key = `${metric.namespace}/${metric.name}`;
		_metricsDeleteBuffer.add(key);
		_metricsUpdateBuffer.delete(key);
		if (!_metricsFlushTimer) _metricsFlushTimer = setTimeout(flushMetrics, 250);
	}

	function cancelPendingAdds() {
		if (_podBatchTimer) { clearTimeout(_podBatchTimer); _podBatchTimer = null; }
		if (_metricsFlushTimer) { clearTimeout(_metricsFlushTimer); _metricsFlushTimer = null; }
		_pendingAdds.clear();
		_pendingModifies.clear();
		_pendingDeletes.clear();
		_metricsUpdateBuffer.clear();
		_metricsDeleteBuffer.clear();
	}

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let podsWatch: ReturnType<typeof useResourceWatch<Pod>> | null = null;
	let metricsWatch: ReturnType<typeof useMetricsWatch> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		// Read only the stable primitives — NOT the full activeCluster object.
		// Reading activeCluster here would make the effect re-run every 30 s when
		// the polling replaces `active` with a new object reference.
		const clusterId = activeClusterId;
		const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

		if (clusterId) {
			fetchNamespaces(clusterId);
			fetchPods(clusterId, selectedNamespace);

			if (podsWatch) podsWatch.unsubscribe();
			if (metricsWatch) metricsWatch.unsubscribe();
			cancelPendingAdds();

			podsWatch = useResourceWatch<Pod>({
				clusterId,
				resourceType: 'pods',
				namespace: ns,
				onAdded: queueAdd,
				onModified: queueModify,
				onDeleted: queueDelete
			});

			metricsWatch = useMetricsWatch({
				clusterId,
				namespace: ns,
				onUpdate: queueMetricUpdate,
				onDelete: queueMetricDelete
			});

			podsWatch.subscribe();
			metricsWatch.subscribe();
		} else {
			cancelPendingAdds();
			allPods = [];
			namespaces = [];
			metricsMap = new Map();
			if (podsWatch) {
				podsWatch.unsubscribe();
				podsWatch = null;
			}
			if (metricsWatch) {
				metricsWatch.unsubscribe();
				metricsWatch = null;
			}
		}
	});

	onDestroy(() => {
		cancelPendingAdds();
		podsWatch?.unsubscribe();
		metricsWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchNamespaces(clusterId: number) {
		try {
			const res = await fetch(`/api/namespaces?cluster=${clusterId}`);
			const data = await res.json();
			if (data.success && data.namespaces) {
				namespaces = data.namespaces.map((ns: { name: string }) => ns.name).sort();
			}
		} catch (err) {
			console.error('[Pods] Failed to fetch namespaces:', err);
		}
	}

	async function fetchPods(clusterId: number, nsParam: string) {

		loading = true;
		error = null;

		try {
			const ns = nsParam === 'all' ? 'all' : nsParam;
			const [podsRes, metricsRes] = await Promise.all([
				fetch(`/api/clusters/${clusterId}/pods?namespace=${ns}`),
				fetch(`/api/clusters/${clusterId}/pods/metrics?namespace=${ns}`)
			]);

			const podsData = await podsRes.json();
			const metricsData = await metricsRes.json();

			if (podsData.success && podsData.pods) {
				allPods = podsData.pods;
				if (metricsData.success && metricsData.metrics) {
					const m = new Map<string, { cpu: string; memory: string }>();
					metricsData.metrics.forEach((metric: PodMetric) => {
						m.set(`${metric.namespace}/${metric.name}`, {
							cpu: metric.cpu,
							memory: metric.memory
						});
					});
					metricsMap = m;
				}
			} else {
				error = podsData.error || 'Failed to fetch pods';
				allPods = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch pods';
			allPods = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(podName: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const params = new URLSearchParams({
				cluster: activeCluster.id.toString(),
				name: podName,
				namespace
			});
			const response = await fetch(`/api/pods/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete pod');
			}
			toast.success(`Pod "${podName}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete pod: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(pod: PodWithAge) {
		selectedPod = pod;
		showDetailDialog = true;
	}

	function openYamlEditor(pod: PodWithAge) {
		drawerResource = { resourceType: 'pod', name: pod.name, namespace: pod.namespace };
		showDrawer = true;
	}

	function closeYamlEditor() {
		showDrawer = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchPods(activeClusterId, selectedNamespace);
	}

	function openLogViewer(pod: PodWithAge) {
		logViewerPod = pod;
		showLogViewer = true;
	}

	function openTerminal(pod: PodWithAge) {
		terminalPod = pod;
		showTerminal = true;
	}

	function openFilesystemViewer(pod: PodWithAge) {
		filesystemPod = pod;
		showFilesystem = true;
	}
</script>

<svelte:head>
	<title>Pods - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Pods</h1>
			<span class="text-sm text-muted-foreground">
				{filteredPods.length} of {podsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchPods(activeClusterId, selectedNamespace); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns: string) => { selectedNamespace = ns; if (activeClusterId) fetchPods(activeClusterId, ns); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search pods..."
					class="h-8 w-full pl-8 text-xs sm:w-56"
					bind:value={searchQuery}
				/>
			</div>
		</div>
	</div>

	<!-- Error -->
	{#if error}
		<div
			class="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
		>
			<AlertCircle class="size-4 shrink-0" />
			<span class="text-sm">{error}</span>
		</div>
	{/if}

	<!-- Empty states -->
	{#if !loading && !error && !activeCluster}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No cluster selected</h3>
				<p class="text-sm text-muted-foreground">Select a cluster to view pods</p>
			</div>
		</div>
	{:else if !loading && !error && allPods.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No pods found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no pods'
						: `No pods in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredPods}
				keyField="id"
				name={TableName.pods}
				columns={visibleColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, pod: PodWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Container class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{pod.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={pod.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = pod.namespace;
								if (activeClusterId) fetchPods(activeClusterId, pod.namespace);
							}}
						/>
					{:else if column.id === 'status'}
						{@const StatusIcon = getStatusIcon(pod.status)}
						<div class="flex justify-center">
							<Badge
								class="{getStatusColor(pod.status)} px-2 py-0.5"
								title={pod.status}
							>
								<StatusIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{pod.status}</span>
							</Badge>
						</div>
					{:else if column.id === 'ready'}
						<span class="font-mono text-xs">{pod.ready}</span>
					{:else if column.id === 'restarts'}
						<div class="flex justify-center">
							{#if pod.restarts > 0}
								<Badge
									variant="outline"
									class="px-1.5 py-0 text-xs {pod.restarts > 10
										? 'text-destructive'
										: 'text-yellow-500'}"
								>
									{pod.restarts}
								</Badge>
							{:else}
								<span class="text-xs text-muted-foreground">{pod.restarts}</span>
							{/if}
						</div>
					{:else if column.id === 'cpu'}
						<MetricsCell value={pod.cpu} type="cpu"
							warnThreshold={activeCluster?.cpuWarnThreshold ?? 60}
							critThreshold={activeCluster?.cpuCritThreshold ?? 80} />
					{:else if column.id === 'memory'}
						<MetricsCell value={pod.memory} type="memory"
							warnThreshold={activeCluster?.memWarnThreshold ?? 60}
							critThreshold={activeCluster?.memCritThreshold ?? 80} />
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{pod.age}</span>
					{:else if column.id === 'node'}
						<span class="truncate font-mono text-xs text-muted-foreground">{pod.node}</span>
					{:else if column.id === 'ip'}
						<span class="font-mono text-xs text-muted-foreground">{pod.ip}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer hover:text-foreground"
								onclick={(e) => {
									e.stopPropagation();
									openLogViewer(pod);
								}}
								title="View logs"
							>
								<FileText class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer hover:text-foreground"
								onclick={(e) => {
									e.stopPropagation();
									openTerminal(pod);
								}}
								title="Open terminal"
							>
								<Terminal class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer hover:text-foreground"
								onclick={(e) => {
									e.stopPropagation();
									openFilesystemViewer(pod);
								}}
								title="Browse filesystem"
							>
								<FolderOpen class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(pod);
								}}
								title="Edit YAML"
							>
								<FileCode class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openDetail(pod);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={pod.name}
								loading={deleting}
								onConfirm={() => handleDelete(pod.name, pod.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete pod"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Container class="mb-3 h-10 w-10 opacity-40" />
						<p>No pods found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading pods...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-h-[90vh] max-w-4xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Pod Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedPod}
			{@const PodStatusIcon = getStatusIcon(selectedPod.status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedPod.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedPod.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(selectedPod.status)} px-2 py-0.5 text-xs"
									title={selectedPod.status}
								>
									<PodStatusIcon class="mr-1 size-3" />
									{selectedPod.status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Phase</p>
							<p class="mt-1 text-sm">{selectedPod.phase}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Ready</p>
							<p class="mt-1 font-mono text-sm">{selectedPod.ready}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Restarts</p>
							<p class="mt-1 text-sm">{selectedPod.restarts}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedPod.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">{formatCreatedAt(selectedPod.createdAt)}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Node</p>
							<p class="mt-1 font-mono text-sm">{selectedPod.node}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Pod IP</p>
							<p class="mt-1 font-mono text-sm">{selectedPod.ip}</p>
						</div>
					</div>
				</div>

				<!-- Containers -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Containers</h3>
					<div class="space-y-3">
						{#each selectedPod.containers as container}
							<div class="rounded-md border bg-muted/40 p-3">
								<div class="grid grid-cols-2 gap-3">
									<div>
										<p class="text-sm font-medium text-muted-foreground">Name</p>
										<p class="mt-1 font-mono text-sm">{container.name}</p>
									</div>
									<div>
										<p class="text-sm font-medium text-muted-foreground">State</p>
										<Badge variant="outline" class="mt-1 text-xs">{container.state}</Badge>
									</div>
									<div class="col-span-2">
										<p class="text-sm font-medium text-muted-foreground">Image</p>
										<p class="mt-1 break-all font-mono text-xs">{container.image}</p>
									</div>
									<div>
										<p class="text-sm font-medium text-muted-foreground">Ready</p>
										<p class="mt-1 text-sm">{container.ready ? 'Yes' : 'No'}</p>
									</div>
									<div>
										<p class="text-sm font-medium text-muted-foreground">Restart Count</p>
										<p class="mt-1 text-sm">{container.restartCount}</p>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Conditions -->
				{#if selectedPod.conditions?.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Conditions</h3>
						<div class="space-y-2">
							{#each selectedPod.conditions as condition}
								<div class="rounded-md border bg-muted/40 p-2">
									<div class="mb-1 flex items-center gap-2">
										<Badge variant="outline" class="text-xs">{condition.type}</Badge>
										<span
											class={cn(
												'text-xs',
												condition.status === 'True'
													? 'text-emerald-500'
													: condition.status === 'False'
														? 'text-muted-foreground'
														: 'text-yellow-500'
											)}>{condition.status}</span
										>
									</div>
									{#if condition.reason}
										<p class="text-xs text-muted-foreground">Reason: {condition.reason}</p>
									{/if}
									{#if condition.message}
										<p class="mt-1 text-xs text-muted-foreground">{condition.message}</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedPod.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedPod.labels) as [k, v]}
								<div class="flex items-start gap-2 text-xs">
									<span class="min-w-0 font-mono break-all text-muted-foreground">{k}:</span>
									<span class="font-mono">{v}</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No labels</p>
					{/if}
				</div>

				<!-- Annotations -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Annotations</h3>
					{#if Object.keys(selectedPod.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedPod.annotations) as [k, v]}
								{@const parsed = tryPrettyJson(v)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<p class="mb-1 font-mono text-[11px] break-all text-muted-foreground">{k}</p>
									{#if parsed.pretty}
										<pre
											class="overflow-x-auto font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">{parsed.text}</pre>
									{:else}
										<p class="font-mono text-xs break-all">{v}</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No annotations</p>
					{/if}
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>


{#if activeCluster}
	<PodLogViewer
		bind:open={showLogViewer}
		clusterId={activeCluster.id}
		pod={logViewerPod}
		onClose={() => {
			showLogViewer = false;
			logViewerPod = null;
		}}
	/>
{/if}

{#if activeCluster}
	<PodTerminal
		bind:open={showTerminal}
		clusterId={activeCluster.id}
		pod={terminalPod}
		onClose={() => {
			showTerminal = false;
			terminalPod = null;
		}}
	/>
{/if}

{#if activeCluster}
	<PodFilesystemViewer
		bind:open={showFilesystem}
		clusterId={activeCluster.id}
		pod={filesystemPod}
		onClose={() => {
			showFilesystem = false;
			filesystemPod = null;
		}}
	/>
{/if}

{#if activeCluster}
	<ResourceDrawer
		bind:open={showDrawer}
		clusterId={activeCluster.id}
		resource={drawerResource}
		onClose={() => {
			drawerResource = null;
		}}
	/>
{/if}
