<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import { parseCpu, parseMemory } from '$lib/utils/formatters';
	import {
		RefreshCw,
		AlertCircle,
		HardDrive,
		Box,
		Search,
		ShieldAlert,
		Scale,
		ArrowDownUp,
		TrendingDown,
		Loader2,
		ChevronDown,
		ChevronRight,
		ChevronsUpDown,
		Server,

		ChevronsDownUp

	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { clustersStore } from '$lib/stores/clusters.svelte';
	import MetricsCell from '$lib/components/metrics-cell.svelte';
	import NamespaceSelect from '$lib/components/namespace-select.svelte';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { formatCapacity } from '../nodes/columns';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';

	// ── Types ───────────────────────────────────────────────────────────────

	interface PodEntry {
		name: string;
		namespace: string;
		phase: string;
		ready: string;
		restarts: number;
		ownerKind: string;
		ownerName: string;
		cpuRequest: string;
		memoryRequest: string;
		createdAt?: string;
	}

	// Internal flat pod with its assigned node name
	interface FlatPod extends PodEntry {
		nodeName: string;
	}

	// Node metadata (no pods — pods are derived separately)
	type NodeMeta = Omit<NodeDistribution, 'pods' | 'podCount'>;

	interface NodeDistribution {
		name: string;
		status: string;
		roles: string[];
		version: string;
		internalIP: string;
		cpuCapacity: string;
		memoryCapacity: string;
		podsCapacity: string;
		cpuAllocatable: string;
		memoryAllocatable: string;
		podsAllocatable: string;
		unschedulable: boolean;
		taints: Array<{ key: string; value?: string; effect: string }>;
		cpuUsage: string;
		memoryUsage: string;
		pods: PodEntry[];
		podCount: number;
	}

	// Minimal types for watch stream events
	interface WatchPod {
		name: string;
		namespace: string;
		phase: string;
		ready: string;
		restarts: number;
		node: string;
		createdAt?: string;
	}

	interface WatchNode {
		name: string;
		status: string;
		roles: string[];
		version: string;
		internalIP: string;
		cpuCapacity: string;
		memoryCapacity: string;
		podsCapacity: string;
		cpuAllocatable: string;
		memoryAllocatable: string;
		podsAllocatable: string;
		unschedulable: boolean;
		taints: Array<{ key: string; value?: string; effect: string }>;
	}

	// ── State ───────────────────────────────────────────────────────────────

	const activeCluster = $derived(clusterStore.active);
	const metricsEnabled = $derived(
		clustersStore.clusters.find((c) => c.id === activeCluster?.id)?.metricsEnabled !== false
	);

	// Separate node metadata and flat pod list — nodes is derived from both
	let allNodes = $state<NodeMeta[]>([]);
	let allPods = $state<FlatPod[]>([]);

	let loading = $state(false);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let sortBy = $state<'pods' | 'cpu' | 'memory' | 'name'>('pods');
	let expandedNodes = $state<Set<string>>(new Set());
	let selectedNamespace = $state('all');

	// ── Derived: merge nodes + pods ──────────────────────────────────────────

	const nodes = $derived.by<NodeDistribution[]>(() => {
		const podsByNode = new Map<string, FlatPod[]>();
		for (const pod of allPods) {
			const key = pod.nodeName;
			if (!podsByNode.has(key)) podsByNode.set(key, []);
			podsByNode.get(key)!.push(pod);
		}
		return allNodes.map((node) => ({
			...node,
			pods: podsByNode.get(node.name) || [],
			podCount: podsByNode.get(node.name)?.length || 0
		}));
	});

	const allNamespaces = $derived([...new Set(allPods.map((p) => p.namespace))].sort());
	const timeTicker = createTimeTicker(10000);

	// ── Computed ─────────────────────────────────────────────────────────────

	const totalPods = $derived(nodes.reduce((sum, n) => sum + n.podCount, 0));
	const totalNodes = $derived(nodes.length);
	const readyNodes = $derived(nodes.filter((n) => n.status === 'Ready').length);

	const avgPodsPerNode = $derived(totalNodes > 0 ? Math.round(totalPods / totalNodes) : 0);

	// Balance score: 0-100 where 100 = perfectly balanced
	const balanceScore = $derived.by(() => {
		if (totalNodes <= 1 || totalPods === 0) return 100;
		const avg = totalPods / totalNodes;
		const variance = nodes.reduce((sum, n) => sum + Math.pow(n.podCount - avg, 2), 0) / totalNodes;
		const stdDev = Math.sqrt(variance);
		const cv = avg > 0 ? stdDev / avg : 0; // coefficient of variation
		return Math.max(0, Math.round((1 - Math.min(cv, 1)) * 100));
	});

	const balanceLabel = $derived(
		balanceScore >= 80 ? 'Well Balanced' : balanceScore >= 50 ? 'Moderate Imbalance' : 'Imbalanced'
	);
	const balanceColor = $derived(
		balanceScore >= 80
			? 'text-emerald-500'
			: balanceScore >= 50
				? 'text-amber-500'
				: 'text-red-500'
	);
	const balanceBg = $derived(
		balanceScore >= 80
			? 'bg-emerald-500/10 border-emerald-500/20'
			: balanceScore >= 50
				? 'bg-amber-500/10 border-amber-500/20'
				: 'bg-red-500/10 border-red-500/20'
	);

	// maxPods is global (used in summary cards)
	const maxPods = $derived(Math.max(...nodes.map((n) => n.podCount), 1));

	// Nodes eligible for scale-down (0 pods or very few pods and no taints)
	const scaleDownCandidates = $derived(
		nodes.filter(
			(n) =>
				n.status === 'Ready' &&
				!n.unschedulable &&
				n.podCount <= 2 &&
				!n.roles.includes('control-plane') &&
				n.taints.length === 0
		)
	);

	const issueCount = $derived.by(() => {
		const unschedulable = nodes.filter((n) => n.unschedulable).length;
		const notReady = nodes.filter((n) => n.status !== 'Ready').length;
		const pendingPods = nodes.reduce((s, n) => s + n.pods.filter((p) => p.phase === 'Pending').length, 0);
		return { unschedulable, notReady, pendingPods, total: unschedulable + notReady + pendingPods };
	});

	// Filtered & sorted nodes
	const filteredNodes = $derived.by(() => {
		let result = nodes;

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(n) =>
					n.name.toLowerCase().includes(q) ||
					n.internalIP.includes(q) ||
					n.pods.some(
						(p) =>
							p.name.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q)
					)
			);
		}

		if (selectedNamespace !== 'all') {
			result = result.filter((n) => n.pods.some((p) => p.namespace === selectedNamespace));
		}

		return [...result].sort((a, b) => {
			switch (sortBy) {
				case 'pods':
					// When namespace is filtered, sort by pods in that namespace, not total
					if (selectedNamespace !== 'all') {
						const bNsPods = b.pods.filter((p) => p.namespace === selectedNamespace).length;
						const aNsPods = a.pods.filter((p) => p.namespace === selectedNamespace).length;
						return bNsPods - aNsPods;
					}
					return b.podCount - a.podCount;
				case 'cpu':
					// Sort by utilisation % so nodes under pressure rank higher regardless of core count
					return (
						usagePercent(b.cpuUsage, b.cpuAllocatable) -
						usagePercent(a.cpuUsage, a.cpuAllocatable)
					);
				case 'memory':
					return (
						usagePercent(b.memoryUsage, b.memoryAllocatable) -
						usagePercent(a.memoryUsage, a.memoryAllocatable)
					);
				case 'name':
					return a.name.localeCompare(b.name);
				default:
					return 0;
			}
		});
	});

	// filteredMaxPods/filteredAvgPods track the visible set for correct bar scaling and avg line
	const filteredMaxPods = $derived(Math.max(...filteredNodes.map((n) => n.podCount), 1));
	const filteredAvgPods = $derived(
		filteredNodes.length > 0
			? Math.round(filteredNodes.reduce((s, n) => s + n.podCount, 0) / filteredNodes.length)
			: 0
	);

	// ── Helpers ──────────────────────────────────────────────────────────────

	function podPhaseColor(phase: string): string {
		switch (phase) {
			case 'Running':
				return 'bg-emerald-500';
			case 'Succeeded':
				return 'bg-blue-500';
			case 'Pending':
				return 'bg-amber-500';
			case 'Failed':
				return 'bg-red-500';
			default:
				return 'bg-zinc-500';
		}
	}

	function podPhaseBadge(phase: string): string {
		switch (phase) {
			case 'Running':
				return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
			case 'Succeeded':
				return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400';
			case 'Pending':
				return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
			case 'Failed':
				return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';
			default:
				return 'border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400';
		}
	}

	function usagePercent(usage: string, capacity: string): number {
		// Memory values end in 'i' (Ki, Mi, Gi); CPU values end in 'm', 'n', or bare digits.
		// parseCpu uses parseFloat which would incorrectly parse "7324Mi" as 7324 cores,
		// so we must choose the right parser based on the unit suffix.
		const isMemory = usage.endsWith('i') || capacity.endsWith('i');
		const parse = isMemory ? parseMemory : parseCpu;
		const u = parse(usage);
		const c = parse(capacity);
		if (!c) return 0;
		return Math.min(Math.round((u / c) * 100), 100);
	}

	function usageBarColor(pct: number): string {
		if (pct >= 90) return 'bg-red-500';
		if (pct >= 70) return 'bg-amber-500';
		return 'bg-emerald-500';
	}

	function podDistSummary(pods: PodEntry[]) {
		const running = pods.filter((p) => p.phase === 'Running').length;
		const pending = pods.filter((p) => p.phase === 'Pending').length;
		const failed = pods.filter((p) => p.phase === 'Failed').length;
		const other = pods.length - running - pending - failed;
		return { running, pending, failed, other };
	}

	function toggleNode(name: string) {
		const next = new Set(expandedNodes);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		expandedNodes = next;
	}

	function expandAll() {
		expandedNodes = new Set(filteredNodes.map((n) => n.name));
	}

	function collapseAll() {
		expandedNodes = new Set();
	}

	// ── Watch helpers ─────────────────────────────────────────────────────

	function watchPodToFlat(pod: WatchPod): FlatPod {
		return {
			name: pod.name,
			namespace: pod.namespace,
			phase: pod.phase,
			ready: pod.ready,
			restarts: pod.restarts,
			ownerKind: '',
			ownerName: '',
			cpuRequest: '0m',
			memoryRequest: '0Mi',
			createdAt: pod.createdAt,
			nodeName: pod.node || ''
		};
	}

	function watchNodeToMeta(node: WatchNode, existing?: NodeMeta): NodeMeta {
		return {
			name: node.name,
			status: node.status,
			roles: node.roles || [],
			version: node.version || '',
			internalIP: node.internalIP || '',
			cpuCapacity: node.cpuCapacity || '0',
			memoryCapacity: node.memoryCapacity || '0',
			podsCapacity: node.podsCapacity || '0',
			cpuAllocatable: node.cpuAllocatable || '0',
			memoryAllocatable: node.memoryAllocatable || '0',
			podsAllocatable: node.podsAllocatable || '0',
			unschedulable: node.unschedulable ?? false,
			taints: node.taints || [],
			// preserve metrics from initial fetch — not emitted by watch stream
			cpuUsage: existing?.cpuUsage ?? '',
			memoryUsage: existing?.memoryUsage ?? ''
		};
	}

	// ── SSE batch buffer ─────────────────────────────────────────────────────
	// K8s watch sends an initial burst of ADDED events for every existing pod.
	// Without batching, n pods = n sequential state writes → O(n²) re-renders.
	// We accumulate in a plain buffer and flush in a single state write via setTimeout.
	let _pendingAdds: FlatPod[] = [];
	let _addBatchTimer: ReturnType<typeof setTimeout> | null = null;

	function flushPendingAdds() {
		_addBatchTimer = null;
		if (_pendingAdds.length === 0) return;
		const batch = _pendingAdds.splice(0);
		const existingKeys = new Set(allPods.map((p) => `${p.namespace}/${p.name}`));
		const fresh = batch.filter((p) => !existingKeys.has(`${p.namespace}/${p.name}`));
		if (fresh.length > 0) allPods = [...allPods, ...fresh];
	}

	function queueAdd(pod: WatchPod) {
		_pendingAdds.push(watchPodToFlat(pod));
		if (!_addBatchTimer) _addBatchTimer = setTimeout(flushPendingAdds, 50);
	}

	function cancelPendingAdds() {
		if (_addBatchTimer) {
			clearTimeout(_addBatchTimer);
			_addBatchTimer = null;
		}
		_pendingAdds = [];
	}

	// Plain lets — NOT $state. Writing inside a $effect would re-trigger it.
	let podWatch: ReturnType<typeof useResourceWatch<WatchPod>> | null = null;
	let nodeWatch: ReturnType<typeof useResourceWatch<WatchNode>> | null = null;

	// ── Data Fetching ───────────────────────────────────────────────────────

	async function fetchData() {
		if (!activeCluster) return;
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/clusters/${activeCluster.id}/pod-distribution`);
			const data = await res.json();
			if (!data.success) {
				error = data.error || 'Failed to load pod distribution';
				return;
			}
			// Separate node metadata from pods
			allNodes = data.nodes.map(({ pods: _, podCount: __, ...meta }: NodeDistribution) => meta);
			// Flatten all pods keyed by their node
			allPods = data.nodes.flatMap((node: NodeDistribution) =>
				node.pods.map((pod: PodEntry) => ({ ...pod, nodeName: node.name }))
			);
		} catch (err) {
			console.error('[PodDistribution] Failed to fetch:', err);
			error = 'Failed to connect to cluster';
		} finally {
			loading = false;
		}
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	$effect(() => {
		if (activeCluster) {
			fetchData();

			if (podWatch) podWatch.unsubscribe();
			if (nodeWatch) nodeWatch.unsubscribe();
			cancelPendingAdds();

			podWatch = useResourceWatch<WatchPod>({
				clusterId: activeCluster.id,
				resourceType: 'pods',
				onAdded: queueAdd,
				onModified: (pod) => {
					const key = `${pod.namespace}/${pod.name}`;
					const idx = allPods.findIndex((p) => `${p.namespace}/${p.name}` === key);
					if (idx >= 0) {
						// Update status fields, preserve cpuRequest/memoryRequest from initial load
						const updated = allPods.slice();
						updated[idx] = {
							...updated[idx],
							phase: pod.phase,
							ready: pod.ready,
							restarts: pod.restarts,
							nodeName: pod.node || updated[idx].nodeName
						};
						allPods = updated;
					} else {
						queueAdd(pod);
					}
				},
				onDeleted: (pod) => {
					const key = `${pod.namespace}/${pod.name}`;
					allPods = allPods.filter((p) => `${p.namespace}/${p.name}` !== key);
				}
			});

			nodeWatch = useResourceWatch<WatchNode>({
				clusterId: activeCluster.id,
				resourceType: 'nodes',
				onAdded: (node) => {
					if (!allNodes.some((n) => n.name === node.name)) {
						allNodes = [...allNodes, watchNodeToMeta(node)];
					}
				},
				onModified: (node) => {
					const idx = allNodes.findIndex((n) => n.name === node.name);
					if (idx >= 0) {
						const updated = allNodes.slice();
						updated[idx] = watchNodeToMeta(node, allNodes[idx]);
						allNodes = updated;
					}
				},
				onDeleted: (node) => {
					allNodes = allNodes.filter((n) => n.name !== node.name);
					allPods = allPods.filter((p) => p.nodeName !== node.name);
				}
			});

			podWatch.subscribe();
			nodeWatch.subscribe();
		} else {
			cancelPendingAdds();
			allNodes = [];
			allPods = [];
			if (podWatch) {
				podWatch.unsubscribe();
				podWatch = null;
			}
			if (nodeWatch) {
				nodeWatch.unsubscribe();
				nodeWatch = null;
			}
		}
	});

	onDestroy(() => {
		cancelPendingAdds();
		podWatch?.unsubscribe();
		nodeWatch?.unsubscribe();
		timeTicker.stop();
	});
</script>

<svelte:head>
	<title>Pod Distribution - AutoKube</title>
</svelte:head>

<div class="space-y-6">
	<!-- ━━━ Header ━━━ -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<h1 class="text-lg font-semibold tracking-tight">Pod Distribution</h1>
			{#if nodes.length > 0}
				<div class="hidden items-center gap-2 sm:flex">
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						<span class="size-1.5 rounded-full bg-emerald-500"></span>
						{readyNodes}/{totalNodes} nodes
					</Badge>
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						{totalPods} pods
					</Badge>
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						~{avgPodsPerNode} pods/node
					</Badge>
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			<div class="relative hidden sm:block">
				<Search
					class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<input
					class="h-8 w-48 rounded-md border bg-transparent pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
					placeholder="Search nodes or pods..."
					bind:value={searchQuery}
				/>
			</div>

			{#if allNamespaces.length > 0}
				<NamespaceSelect
					namespaces={allNamespaces}
					value={selectedNamespace}
					onChange={(ns) => (selectedNamespace = ns)}
				/>
			{/if}

			<!-- Sort select -->
			<div class="flex items-center rounded-md border bg-muted/40 p-0.5">
				<button
					class={cn(
						'inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors',
						sortBy === 'pods'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => (sortBy = 'pods')}
				>
					<Box class="size-3" />
					Pods
				</button>
				{#if metricsEnabled}
					<button
						class={cn(
							'inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors',
							sortBy === 'cpu'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'
						)}
						onclick={() => (sortBy = 'cpu')}
					>
						CPU
					</button>
					<button
						class={cn(
							'inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors',
							sortBy === 'memory'
								? 'bg-background text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground'
						)}
						onclick={() => (sortBy = 'memory')}
					>
						Mem
					</button>
				{/if}
				<button
					class={cn(
						'inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors',
						sortBy === 'name'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => (sortBy = 'name')}
				>
					Name
				</button>
			</div>

			<Button
				variant="outline"
				size="sm"
				class="h-8 gap-1.5"
				disabled={loading}
				onclick={fetchData}
			>
				<RefreshCw class={cn('size-3.5', loading && 'animate-spin')} />
				<span class="hidden sm:inline">Refresh</span>
			</Button>
		</div>
	</div>

	<!-- ━━━ Loading state ━━━ -->
	{#if loading && nodes.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
			<Loader2 class="size-8 animate-spin mb-3" />
			<p class="text-sm">Loading pod distribution...</p>
		</div>

		<!-- ━━━ Error state ━━━ -->
	{:else if error}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
			<div class="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
				<AlertCircle class="size-4 shrink-0" />
				{error}
			</div>
		</div>

		<!-- ━━━ No cluster ━━━ -->
	{:else if !activeCluster}
		<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
			<Server class="size-10 mb-3 opacity-40" />
			<p class="text-sm">Select a cluster to view pod distribution</p>
		</div>

		<!-- ━━━ Main content ━━━ -->
	{:else if nodes.length > 0}
		<!-- Summary cards -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<!-- Balance Score -->
			<div class={cn('rounded-lg border p-4', balanceBg)}>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
						<Scale class="size-3.5" />
						Balance Score
					</div>
					<span class={cn('text-2xl font-bold tabular-nums', balanceColor)}>
						{balanceScore}
					</span>
				</div>
				<p class={cn('mt-1 text-xs font-medium', balanceColor)}>{balanceLabel}</p>
			</div>

			<!-- Pod spread -->
			<div class="rounded-lg border bg-card p-4">
				<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
					<ArrowDownUp class="size-3.5" />
					Pod Spread
				</div>
				<div class="mt-2 flex items-baseline gap-1.5">
					<span class="text-2xl font-bold tabular-nums">
						{Math.min(...nodes.map((n) => n.podCount))}–{Math.max(...nodes.map((n) => n.podCount))}
					</span>
					<span class="text-xs text-muted-foreground">pods/node</span>
				</div>
			</div>

			<!-- Scheduling issues -->
			<div class="rounded-lg border bg-card p-4">
				<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
					<ShieldAlert class="size-3.5" />
					Issues
				</div>
				<div class="mt-2 flex items-baseline gap-1.5">
					<span class="text-2xl font-bold tabular-nums">{issueCount.total}</span>
					<span class="text-xs text-muted-foreground">
						{#if issueCount.unschedulable > 0}
							{issueCount.unschedulable} cordoned,
						{/if}
						{#if issueCount.notReady > 0}
							{issueCount.notReady} not ready,
						{/if}
						{issueCount.pendingPods} pending
					</span>
				</div>
			</div>

			<!-- Scale-down candidates -->
			<div class="rounded-lg border bg-card p-4">
				<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
					<TrendingDown class="size-3.5" />
					Scale-Down Candidates
				</div>
				<div class="mt-2 flex items-baseline gap-1.5">
					<span class="text-2xl font-bold tabular-nums">{scaleDownCandidates.length}</span>
					<span class="text-xs text-muted-foreground">
						{scaleDownCandidates.length === 1 ? 'node' : 'nodes'} with ≤2 pods
					</span>
				</div>
			</div>
		</div>

		<!-- ━━━ Distribution bar chart ━━━ -->
		<div class="rounded-lg border bg-card">
			<div class="border-b px-4 py-3 flex items-center justify-between">
				<h2 class="text-sm font-medium">Pod Distribution by Node</h2>
				{#if filteredNodes.length > 0}
					<div class="flex items-center gap-1">
						<button
							class="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
							onclick={expandAll}
						>
							<ChevronsUpDown class="size-3" />
							Expand all
						</button>
						<button
							class="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
							onclick={collapseAll}
						>
                            <ChevronsDownUp class="size-3" />
							Collapse all
						</button>
					</div>
				{/if}
			</div>
			<div class="p-4 space-y-1.5">
				{#if filteredNodes.length === 0}
					<div class="flex flex-col items-center justify-center py-8 text-muted-foreground">
						<HardDrive class="size-7 mb-2 opacity-30" />
						<p class="text-sm">
							{#if searchQuery.trim()}
								No nodes match "{searchQuery}"
							{:else if selectedNamespace !== 'all'}
								No nodes have pods in "{selectedNamespace}"
							{:else}
								No nodes to display
							{/if}
						</p>
						{#if searchQuery.trim() || selectedNamespace !== 'all'}
							<button
								class="mt-1.5 text-xs text-primary hover:underline"
								onclick={() => { searchQuery = ''; selectedNamespace = 'all'; }}
							>
								Clear filters
							</button>
						{/if}
					</div>
				{:else}
				{#each filteredNodes as node (node.name)}
					{@const podDist = podDistSummary(node.pods)}
					{@const barWidth = filteredMaxPods > 0 ? (node.podCount / filteredMaxPods) * 100 : 0}
					{@const podsAlloc = parseInt(node.podsAllocatable) || 110}
					{@const podCapPct = Math.min(Math.round((node.podCount / podsAlloc) * 100), 100)}
					{@const total = node.podCount || 1}

					<div class="group">
						<!-- Bar row -->
						<button
							class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
							onclick={() => toggleNode(node.name)}
						>
							<!-- Expand icon -->
							<div class="shrink-0 text-muted-foreground">
								{#if expandedNodes.has(node.name)}
									<ChevronDown class="size-3.5" />
								{:else}
									<ChevronRight class="size-3.5" />
								{/if}
							</div>

							<!-- Node name & info -->
							<div class="w-50 shrink-0 min-w-0">
								<div class="flex items-center gap-1.5">
									<span
										class={cn(
											'size-2 shrink-0 rounded-full',
											node.status === 'Ready' ? 'bg-emerald-500' : 'bg-red-500'
										)}
									></span>
									<span class="truncate text-xs font-medium">{node.name}</span>
								</div>
								<div class="ml-3.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
									<span>{node.internalIP}</span>
									{#if node.roles.length}
										<span class="opacity-50">·</span>
										<span>{node.roles.join(', ')}</span>
									{/if}
									{#if node.unschedulable}
										<Badge variant="outline" class="h-4 px-1 text-[9px] border-amber-500/30 text-amber-600 dark:text-amber-400">
											cordoned
										</Badge>
									{/if}
								</div>
							</div>

							<!-- Distribution bar -->
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<div class="flex-1 h-6 rounded bg-muted/60 overflow-hidden relative">
										<!-- Stacked pod phase bar -->
										<div class="absolute inset-y-0 left-0 flex" style="width: {barWidth}%">
											{#if podDist.running > 0}
												<div
													class="h-full bg-emerald-500 transition-all"
													style="width: {(podDist.running / total) * 100}%"
												></div>
											{/if}
											{#if podDist.pending > 0}
												<div
													class="h-full bg-amber-500 transition-all"
													style="width: {(podDist.pending / total) * 100}%"
												></div>
											{/if}
											{#if podDist.failed > 0}
												<div
													class="h-full bg-red-500 transition-all"
													style="width: {(podDist.failed / total) * 100}%"
												></div>
											{/if}
											{#if podDist.other > 0}
												<div
													class="h-full bg-zinc-400 transition-all"
													style="width: {(podDist.other / total) * 100}%"
												></div>
											{/if}
										</div>
										<!-- Average line (relative to visible nodes) -->
										{#if filteredNodes.length > 1}
											<div
												class="absolute inset-y-0 w-px bg-foreground/30"
												style="left: {filteredMaxPods > 0 ? (filteredAvgPods / filteredMaxPods) * 100 : 0}%"
											></div>
										{/if}
									</div>
									<span
										class="w-10 shrink-0 text-right text-xs font-semibold tabular-nums"
									>
										{node.podCount}
									</span>
								</div>
							</div>

							<!-- Capacity % -->
							<div class="w-14 shrink-0 text-right">
								<span
									class={cn(
										'text-xs tabular-nums font-medium',
										podCapPct >= 90
											? 'text-red-500'
											: podCapPct >= 70
												? 'text-amber-500'
												: 'text-muted-foreground'
									)}
								>
									{podCapPct}%
								</span>
								<div class="text-[10px] text-muted-foreground">capacity</div>
							</div>

							<!-- Resource usage -->
							{#if metricsEnabled && node.cpuUsage}
								{@const cpuPct = usagePercent(node.cpuUsage, node.cpuAllocatable)}
								{@const memPct = usagePercent(node.memoryUsage, node.memoryAllocatable)}
								<div class="hidden w-28 shrink-0 md:block">
									<div class="flex items-center gap-1.5">
										<span class="text-[10px] text-muted-foreground w-7">CPU</span>
										<div class="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
											<div
												class={cn('h-full rounded-full transition-all', usageBarColor(cpuPct))}
												style="width: {cpuPct}%"
											></div>
										</div>
										<span class="text-[10px] tabular-nums text-muted-foreground w-7 text-right">{cpuPct}%</span>
									</div>
									<div class="flex items-center gap-1.5 mt-0.5">
										<span class="text-[10px] text-muted-foreground w-7">Mem</span>
										<div class="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
											<div
												class={cn('h-full rounded-full transition-all', usageBarColor(memPct))}
												style="width: {memPct}%"
											></div>
										</div>
										<span class="text-[10px] tabular-nums text-muted-foreground w-7 text-right">{memPct}%</span>
									</div>
								</div>
							{/if}
						</button>

						<!-- Expanded pod list -->
						{#if expandedNodes.has(node.name)}
							<div class="ml-9 mr-2 mb-2 mt-0.5 rounded-md border bg-muted/20">
								{#if node.pods.length === 0}
									<div class="px-3 py-2 text-xs text-muted-foreground italic">
										No pods on this node
									</div>
								{:else}
									<div class="overflow-x-auto">
										<table class="w-full text-xs">
											<thead>
												<tr class="border-b text-muted-foreground">
													<th class="px-3 py-1.5 text-left font-medium">Pod</th>
													<th class="px-3 py-1.5 text-left font-medium">Namespace</th>
													<th class="px-3 py-1.5 text-left font-medium">Status</th>
													<th class="px-3 py-1.5 text-left font-medium">Owner</th>
													<th class="px-3 py-1.5 text-right font-medium">Restarts</th>
													<th class="px-3 py-1.5 text-right font-medium w-28">CPU Req</th>
													<th class="px-3 py-1.5 text-right font-medium w-28">Mem Req</th>
												</tr>
											</thead>
											<tbody>
												{#each node.pods.filter((p) => selectedNamespace === 'all' || p.namespace === selectedNamespace) as pod (`${pod.namespace}/${pod.name}`)}
													<tr class="border-b last:border-0 hover:bg-muted/30">
														<td class="max-w-50 truncate px-3 py-1.5 font-mono text-[11px]">
															{pod.name}
														</td>
														<td class="px-3 py-1.5">
												<NamespaceBadge namespace={pod.namespace} />
											</td>
														<td class="px-3 py-1.5">
															<span
																class={cn(
																	'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
																	podPhaseBadge(pod.phase)
																)}
															>
																<span class={cn('size-1.5 rounded-full', podPhaseColor(pod.phase))}></span>
																{pod.phase}
															</span>
														</td>
														<td class="px-3 py-1.5 text-muted-foreground">
															{#if pod.ownerKind}
																<span class="text-[10px] opacity-60">{pod.ownerKind}/</span>{pod.ownerName}
															{:else}
																<span class="italic opacity-40">standalone</span>
															{/if}
														</td>
														<td class="px-3 py-1.5 text-right tabular-nums">
															{#if pod.restarts > 0}
																<span class={pod.restarts >= 10 ? 'text-red-500' : pod.restarts >= 3 ? 'text-amber-500' : ''}>
																	{pod.restarts}
																</span>
															{:else}
																<span class="text-muted-foreground">0</span>
															{/if}
														</td>
														<td class="px-1.5 py-1 w-28">
															<MetricsCell
																value={pod.cpuRequest}
																type="cpu"
																capacity={node.cpuAllocatable}
															/>
														</td>
														<td class="px-1.5 py-1 w-28">
															<MetricsCell
																value={pod.memoryRequest}
																type="memory"
																capacity={node.memoryAllocatable}
															/>
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
				{/if}
			</div>

			<!-- Legend -->
			<div class="border-t px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-full bg-emerald-500"></span> Running
				</div>
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-full bg-amber-500"></span> Pending
				</div>
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-full bg-red-500"></span> Failed
				</div>
				<div class="flex items-center gap-1.5">
					<span class="size-2 rounded-full bg-zinc-400"></span> Other
				</div>
				{#if filteredNodes.length > 1}
					<div class="flex items-center gap-1.5">
						<span class="w-3 h-px bg-foreground/30"></span> Average ({filteredAvgPods})
					</div>
				{/if}
			</div>
		</div>

		<!-- ━━━ Node cards grid ━━━ -->
		<div>
			<h2 class="text-sm font-medium mb-3">Node Details</h2>
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each filteredNodes as node (node.name)}
					{@const podDist = podDistSummary(node.pods)}
					{@const podsAlloc = parseInt(node.podsAllocatable) || 110}
					{@const podCapPct = Math.min(Math.round((node.podCount / podsAlloc) * 100), 100)}

					<div
						class={cn(
							'rounded-lg border bg-card p-4 transition-colors',
							node.status !== 'Ready' && 'border-red-500/30',
							node.unschedulable && 'border-amber-500/30 opacity-75'
						)}
					>
						<!-- Node header -->
						<div class="flex items-center justify-between mb-3">
							<div class="flex items-center gap-2 min-w-0">
								<HardDrive class="size-4 shrink-0 text-muted-foreground" />
								<span class="truncate text-sm font-medium">{node.name}</span>
							</div>
							<span
								class={cn(
									'size-2 shrink-0 rounded-full',
									node.status === 'Ready' ? 'bg-emerald-500' : 'bg-red-500'
								)}
							></span>
						</div>

						<!-- Pod count donut-like visual -->
						<div class="flex items-center gap-4 mb-3">
							<div class="relative size-16 shrink-0">
								<!-- SVG ring showing pod capacity -->
								<svg viewBox="0 0 36 36" class="size-16 -rotate-90">
									<circle
										cx="18"
										cy="18"
										r="15.5"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										class="text-muted/40"
									/>
									<circle
										cx="18"
										cy="18"
										r="15.5"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										stroke-dasharray="{podCapPct} {100 - podCapPct}"
										stroke-linecap="round"
										class={cn(
											podCapPct >= 90
												? 'text-red-500'
												: podCapPct >= 70
													? 'text-amber-500'
													: 'text-emerald-500'
										)}
									/>
								</svg>
								<div class="absolute inset-0 flex flex-col items-center justify-center">
									<span class="text-sm font-bold tabular-nums leading-none">{node.podCount}</span>
									<span class="text-[9px] text-muted-foreground">/{podsAlloc}</span>
								</div>
							</div>

							<!-- Phase breakdown -->
							<div class="flex-1 space-y-1">
								<div class="flex items-center justify-between text-xs">
									<span class="flex items-center gap-1.5">
										<span class="size-1.5 rounded-full bg-emerald-500"></span>
										Running
									</span>
									<span class="tabular-nums font-medium">{podDist.running}</span>
								</div>
								{#if podDist.pending > 0}
									<div class="flex items-center justify-between text-xs">
										<span class="flex items-center gap-1.5">
											<span class="size-1.5 rounded-full bg-amber-500"></span>
											Pending
										</span>
										<span class="tabular-nums font-medium text-amber-600 dark:text-amber-400">{podDist.pending}</span>
									</div>
								{/if}
								{#if podDist.failed > 0}
									<div class="flex items-center justify-between text-xs">
										<span class="flex items-center gap-1.5">
											<span class="size-1.5 rounded-full bg-red-500"></span>
											Failed
										</span>
										<span class="tabular-nums font-medium text-red-600 dark:text-red-400">{podDist.failed}</span>
									</div>
								{/if}
								{#if podDist.other > 0}
									<div class="flex items-center justify-between text-xs">
										<span class="flex items-center gap-1.5">
											<span class="size-1.5 rounded-full bg-zinc-400"></span>
											Other
										</span>
										<span class="tabular-nums font-medium">{podDist.other}</span>
									</div>
								{/if}
							</div>
						</div>

						<!-- Resource usage bars -->
						{#if metricsEnabled && node.cpuUsage}
							{@const cpuPct = usagePercent(node.cpuUsage, node.cpuAllocatable)}
							{@const memPct = usagePercent(node.memoryUsage, node.memoryAllocatable)}
							<div class="space-y-1.5">
								<div class="flex items-center gap-2 text-xs">
									<span class="w-8 text-muted-foreground">CPU</span>
									<div class="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
										<div
											class={cn('h-full rounded-full transition-all', usageBarColor(cpuPct))}
											style="width: {cpuPct}%"
										></div>
									</div>
									<span class="w-8 text-right tabular-nums text-muted-foreground">{cpuPct}%</span>
								</div>
								<div class="flex items-center gap-2 text-xs">
									<span class="w-8 text-muted-foreground">Mem</span>
									<div class="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
										<div
											class={cn('h-full rounded-full transition-all', usageBarColor(memPct))}
											style="width: {memPct}%"
										></div>
									</div>
									<span class="w-8 text-right tabular-nums text-muted-foreground">{memPct}%</span>
								</div>
								<div class="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
									<span>{formatCapacity(node.cpuAllocatable, 'cpu')} cores</span>
									<span>{formatCapacity(node.memoryAllocatable, 'memory')}</span>
								</div>
							</div>
						{/if}

						<!-- Meta info -->
						<div class="mt-3 flex flex-wrap gap-1.5">
							{#each node.roles as role}
								<Badge variant="outline" class="text-[10px] h-5 px-1.5">{role}</Badge>
							{/each}
							{#if node.unschedulable}
								<Badge variant="outline" class="text-[10px] h-5 px-1.5 border-amber-500/30 text-amber-600 dark:text-amber-400">
									cordoned
								</Badge>
							{/if}
							{#each node.taints as taint}
								<Badge variant="outline" class="text-[10px] h-5 px-1.5 border-zinc-500/30 text-zinc-500">
									{taint.key}:{taint.effect}
								</Badge>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- ━━━ Scale-down candidates callout ━━━ -->
		{#if scaleDownCandidates.length > 0}
			<div class="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/30 dark:bg-blue-950/20">
				<div class="flex items-start gap-2">
					<TrendingDown class="size-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
					<div>
						<p class="text-sm font-medium text-blue-700 dark:text-blue-300">Scale-Down Candidates</p>
						<p class="mt-0.5 text-xs text-blue-600/80 dark:text-blue-400/70">
							These worker nodes have ≤2 pods and could potentially be removed to reduce costs:
						</p>
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each scaleDownCandidates as node}
								<Badge variant="outline" class="text-xs border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300">
									{node.name}
									<span class="ml-1 opacity-60">({node.podCount} pods)</span>
								</Badge>
							{/each}
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- ━━━ Empty filtered state ━━━ -->
	{:else if !loading}
		<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
			<HardDrive class="size-10 mb-3 opacity-40" />
			<p class="text-sm">No nodes found</p>
		</div>
	{/if}
</div>
