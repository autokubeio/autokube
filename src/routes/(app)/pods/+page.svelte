<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
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

	// Pods with age and metrics (reactive to ticker)
	const podsWithAge = $derived.by((): PodWithAge[] => {
		const currentTime = timeTicker.now;
		return allPods.map((pod) => {
			const metricKey = `${pod.namespace}/${pod.name}`;
			const metrics = metricsMap.get(metricKey);
			return {
				...pod,
				cpu: metrics?.cpu || pod.cpu || '0m',
				memory: metrics?.memory || pod.memory || '0Mi',
				age: calculateAgeWithTicker(pod.createdAt, currentTime)
			};
		});
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

	// ── SSE batch buffer ────────────────────────────────────────────────────
	// The K8s watch protocol sends an initial burst of ADDED events for every
	// existing pod when it first connects. Without batching, 1000 pods = 1000
	// sequential state mutations, each triggering all derived computations →
	// O(n²) work that completely freezes the main thread.
	// We accumulate events in a plain (non-reactive) buffer and flush them in
	// a single state write on the next macrotask.
	let _pendingAdds: Pod[] = [];
	let _addBatchTimer: ReturnType<typeof setTimeout> | null = null;

	function flushPendingAdds() {
		_addBatchTimer = null;
		if (_pendingAdds.length === 0) return;
		const batch = _pendingAdds.splice(0); // drain buffer
		const existingKeys = new Set(allPods.map((p) => `${p.namespace}/${p.name}`));
		const fresh = batch.filter((p) => !existingKeys.has(`${p.namespace}/${p.name}`));
		if (fresh.length > 0) allPods = [...allPods, ...fresh]; // one state update
	}

	function queueAdd(pod: Pod) {
		_pendingAdds.push(pod);
		if (!_addBatchTimer) _addBatchTimer = setTimeout(flushPendingAdds, 50);
	}

	function cancelPendingAdds() {
		if (_addBatchTimer) { clearTimeout(_addBatchTimer); _addBatchTimer = null; }
		_pendingAdds = [];
	}

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let podsWatch: ReturnType<typeof useResourceWatch<Pod>> | null = null;
	let metricsWatch: ReturnType<typeof useMetricsWatch> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchPods();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (podsWatch) podsWatch.unsubscribe();
			if (metricsWatch) metricsWatch.unsubscribe();
			cancelPendingAdds();

			podsWatch = useResourceWatch<Pod>({
				clusterId: activeCluster.id,
				resourceType: 'pods',
				namespace: ns,
				onAdded: queueAdd,
				onModified: (pod) => {
					allPods = arrayModify(allPods, pod, (p) => `${p.namespace}/${p.name}`);
				},
				onDeleted: (pod) => {
					allPods = arrayDelete(allPods, pod, (p) => `${p.namespace}/${p.name}`);
				}
			});

			metricsWatch = useMetricsWatch({
				clusterId: activeCluster.id,
				namespace: ns,
				onUpdate: (metric: PodMetric) => {
					const key = `${metric.namespace}/${metric.name}`;
					const m = new Map(metricsMap);
					m.set(key, { cpu: metric.cpu, memory: metric.memory });
					metricsMap = m;
				},
				onDelete: (metric: PodMetric) => {
					const key = `${metric.namespace}/${metric.name}`;
					const m = new Map(metricsMap);
					m.delete(key);
					metricsMap = m;
				}
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

	async function fetchNamespaces() {
		if (!activeCluster?.id) return;
		try {
			const res = await fetch(`/api/namespaces?cluster=${activeCluster.id}`);
			const data = await res.json();
			if (data.success && data.namespaces) {
				namespaces = data.namespaces.map((ns: { name: string }) => ns.name).sort();
			}
		} catch (err) {
			console.error('[Pods] Failed to fetch namespaces:', err);
		}
	}

	async function fetchPods() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const [podsRes, metricsRes] = await Promise.all([
				fetch(`/api/clusters/${activeCluster.id}/pods?namespace=${ns}`),
				fetch(`/api/clusters/${activeCluster.id}/pods/metrics?namespace=${ns}`)
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
		fetchPods();
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
				onclick={fetchPods}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<Select.Root
				type="single"
				value={selectedNamespace}
				onValueChange={(v: string) => {
					if (v) {
						selectedNamespace = v;
						fetchPods();
					}
				}}
			>
				<Select.Trigger class="h-8 flex-1 text-xs sm:w-44">
					{selectedNamespace === 'all' ? 'All namespaces' : selectedNamespace}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All namespaces</Select.Item>
					{#each namespaces as ns}
						<Select.Item value={ns}>{ns}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
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
				keyField="name"
				name={TableName.pods}
				columns={visibleColumns}
				virtualScroll={true}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
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
								fetchPods();
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
