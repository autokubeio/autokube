<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import MetricsCell from '$lib/components/metrics-cell.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson, parseCpu, parseMemory } from '$lib/utils/formatters';
	import { arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		HardDrive,
		Info,
		Loader2,
		FileCode,
		Shield,
		ShieldOff,
		Trash2,
		MoreHorizontal
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type Node,
		type NodeWithAge,
		getStatusIcon,
		getStatusColor,
		formatRoles,
		formatCapacity
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, nodesColumns } from '$lib/table-columns';
	import { clustersStore } from '$lib/stores/clusters.svelte';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	const metricsEnabled = $derived(
		clustersStore.clusters.find((c) => c.id === activeCluster?.id)?.metricsEnabled !== false
	);
	const visibleColumns = $derived(
		metricsEnabled ? nodesColumns : nodesColumns.filter((c) => c.id !== 'cpu' && c.id !== 'memory')
	);
	let allNodes = $state<Node[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let metricsMap = $state(new Map<string, { cpu: string; memory: string }>());
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedNode = $state<NodeWithAge | null>(null);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Cordon / Drain
	let actioning = $state<string | null>(null);
	let drainTarget = $state<NodeWithAge | null>(null);
	let showDrainConfirm = $state(false);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Nodes with age and metrics (reactive to ticker)
	const nodesWithAge = $derived.by((): NodeWithAge[] => {
		const currentTime = timeTicker.now;
		return allNodes.map((node) => {
			const metrics = metricsMap.get(node.name);
			return {
				...node,
				cpuUsage: metrics?.cpu,
				memoryUsage: metrics?.memory,
				age: calculateAgeWithTicker(node.createdAt, currentTime)
			};
		});
	});

	// Filtered nodes
	const filteredNodes = $derived.by(() => {
		let result = nodesWithAge;

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(node) =>
					node.name?.toLowerCase().includes(query) ||
					node.status?.toLowerCase().includes(query) ||
					node.internalIP?.includes(query) ||
					node.version?.toLowerCase().includes(query) ||
					(node.roles ?? []).some((r) => r.toLowerCase().includes(query))
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof NodeWithAge, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				cpuUsage: (val: any) => parseCpu(val || '0'),
				memoryUsage: (val: any) => parseMemory(val || '0'),
				diskCapacity: (val: any) => parseMemory(val || '0'),
				podsCount: (val: any) => Number(val) || 0
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let nodesWatch: ReturnType<typeof useBatchWatch<Node>> | null = null;

	// Search debounce
	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSearch(value: string) {
		if (_searchTimer !== null) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => { searchQuery = value; }, 150);
	}

	// Watch for cluster changes
	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchNodes(clusterId);

			if (nodesWatch) nodesWatch.unsubscribe();

			nodesWatch = useBatchWatch<Node>({
				clusterId,
				resourceType: 'nodes',
				getItems: () => allNodes,
				setItems: (v) => { allNodes = v; },
				keyFn: (n) => n.name,
				// Preserve the real pod count from the last fetchNodes() — the SSE
				// watch only sends the node object which has no running pod count.
				onModifiedItem: (existing, incoming) => ({ ...incoming, podsCount: existing.podsCount ?? 0 })
			});

			nodesWatch.subscribe();
		} else {
			allNodes = [];
			metricsMap = new Map();
			if (nodesWatch) {
				nodesWatch.unsubscribe();
				nodesWatch = null;
			}
		}
	});

	onDestroy(() => {
		nodesWatch?.unsubscribe();
		timeTicker.stop();
		if (_searchTimer !== null) clearTimeout(_searchTimer);
	});

	async function fetchNodes(clusterId: number) {
		loading = true;
		error = null;

		try {
			const [nodesRes, metricsRes] = await Promise.all([
				fetch(`/api/clusters/${clusterId}/nodes`),
				fetch(`/api/clusters/${clusterId}/nodes/metrics`)
			]);

			const nodesData = await nodesRes.json();
			const metricsData = await metricsRes.json();

			if (nodesData.success && nodesData.nodes) {
				allNodes = nodesData.nodes;
				if (metricsData.success && metricsData.metrics) {
					const m = new Map<string, { cpu: string; memory: string }>();
					metricsData.metrics.forEach((metric: { name: string; cpu: string; memory: string }) => {
						m.set(metric.name, { cpu: metric.cpu, memory: metric.memory });
					});
					metricsMap = m;
				}
			} else {
				error = nodesData.error || 'Failed to fetch nodes';
				allNodes = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch nodes';
			allNodes = [];
		} finally {
			loading = false;
		}
	}

	function openDetail(node: NodeWithAge) {
		selectedNode = node;
		showDetailDialog = true;
	}

	function openYamlEditor(node: NodeWithAge) {
		drawerResource = { resourceType: 'node', name: node.name };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchNodes(activeClusterId);
	}

	async function handleCordon(node: NodeWithAge, unschedulable: boolean) {
		if (!activeCluster?.id) return;
		actioning = node.name;
		try {
			const res = await fetch(`/api/clusters/${activeCluster.id}/nodes/${node.name}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ unschedulable })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error ?? 'Failed');
			toast.success(`Node ${node.name} ${unschedulable ? 'cordoned' : 'uncordoned'} successfully`);
			if (activeClusterId) fetchNodes(activeClusterId);
		} catch (err) {
			console.error('[Nodes] Cordon failed:', err);
			toast.error(`Failed to ${unschedulable ? 'cordon' : 'uncordon'} node: ${err instanceof Error ? err.message : err}`);
		} finally {
			actioning = null;
		}
	}

	function handleDrain(node: NodeWithAge) {
		drainTarget = node;
		showDrainConfirm = true;
	}

	async function confirmDrain() {
		if (!activeCluster?.id || !drainTarget) return;
		actioning = drainTarget.name;
		showDrainConfirm = false;
		try {
			const res = await fetch(`/api/clusters/${activeCluster.id}/nodes/${drainTarget.name}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'drain' })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error ?? 'Failed');
			toast.success(`Node ${drainTarget.name} drained (${data.evicted} evicted, ${data.skipped} skipped)`);
			if (activeClusterId) fetchNodes(activeClusterId);
		} catch (err) {
			console.error('[Nodes] Drain failed:', err);
			toast.error(`Failed to drain node: ${err instanceof Error ? err.message : err}`);
		} finally {
			actioning = null;
			drainTarget = null;
		}
	}
</script>

<svelte:head>
	<title>Nodes - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Nodes</h1>
			<span class="text-sm text-muted-foreground">
				{filteredNodes.length} of {nodesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchNodes(activeClusterId); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<!-- No namespace selector — nodes are cluster-scoped -->
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search nodes..."
					class="h-8 w-full pl-8 text-xs sm:w-56"
					value={searchQuery}
					oninput={(e) => scheduleSearch(e.currentTarget.value)}
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
				<p class="text-sm text-muted-foreground">Select a cluster to view nodes</p>
			</div>
		</div>
	{:else if !loading && !error && allNodes.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No nodes found</h3>
				<p class="text-sm text-muted-foreground">This cluster has no nodes</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredNodes}
				keyField="name"
				name={TableName.nodes}
				columns={visibleColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, node: NodeWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<HardDrive class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{node.name}</span>
						</div>
					{:else if column.id === 'status'}
						{@const StatusIcon = getStatusIcon(node.status)}
					<div class="flex flex-wrap items-center gap-1">
						<Badge
							class="{getStatusColor(node.status)} px-2 py-0.5"
							title={node.status}
						>
							<StatusIcon class="mr-1 h-3 w-3" />
							<span class="text-xs">{node.status}</span>
						</Badge>
						{#if node.unschedulable}
							<Badge class="bg-orange-500/15 text-orange-400 border-transparent px-1.5 py-0.5 text-[10px]">
								<Shield class="mr-0.5 size-2.5" />Cordoned
							</Badge>
						{/if}
						</div>
					{:else if column.id === 'roles'}
						<span class="text-xs text-muted-foreground">{formatRoles(node.roles)}</span>
					{:else if column.id === 'internalIP'}
						<span class="font-mono text-xs text-muted-foreground">{node.internalIP}</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{node.age}</span>
					{:else if column.id === 'version'}
						<Badge variant="outline" class="px-1.5 py-0 text-xs">
							{node.version}
						</Badge>
					{:else if column.id === 'cpu'}
						<MetricsCell value={node.cpuUsage} type="cpu" capacity={node.cpuCapacity}
							warnThreshold={activeCluster?.cpuWarnThreshold ?? 60}
							critThreshold={activeCluster?.cpuCritThreshold ?? 80} />
					{:else if column.id === 'memory'}
						<MetricsCell value={node.memoryUsage} type="memory" capacity={node.memoryCapacity}
							warnThreshold={activeCluster?.memWarnThreshold ?? 60}
							critThreshold={activeCluster?.memCritThreshold ?? 80} />
					{:else if column.id === 'disk'}
						<span class="font-mono text-xs text-muted-foreground">
							{formatCapacity(node.diskCapacity, 'disk')}
						</span>
					{:else if column.id === 'pods'}
						<span class="font-mono text-xs text-muted-foreground">
							{node.podsCount}/{node.podsCapacity}
						</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(node);
								}}
								title="View YAML"
							>
								<FileCode class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openDetail(node);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger onclick={(e: MouseEvent) => e.stopPropagation()}>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="h-6 w-6 text-muted-foreground"
											disabled={actioning === node.name}
										>
											{#if actioning === node.name}
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{:else}
												<MoreHorizontal class="h-3.5 w-3.5" />
											{/if}
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="w-40">
									{#if node.unschedulable}
										<DropdownMenu.Item
											class="gap-2 text-xs"
											onclick={() => handleCordon(node, false)}
										>
											<ShieldOff class="size-3.5 text-emerald-400" />
											Uncordon
										</DropdownMenu.Item>
									{:else}
										<DropdownMenu.Item
											class="gap-2 text-xs"
											onclick={() => handleCordon(node, true)}
										>
											<Shield class="size-3.5 text-orange-400" />
											Cordon
										</DropdownMenu.Item>
									{/if}
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										class="gap-2 text-xs text-destructive focus:text-destructive"
										onclick={() => handleDrain(node)}
									>
										<Trash2 class="size-3.5" />
										Drain
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<HardDrive class="mb-3 h-10 w-10 opacity-40" />
						<p>No nodes found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading nodes...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- Drain Confirm Dialog -->
<AlertDialog.Root bind:open={showDrainConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Drain node?</AlertDialog.Title>
			<AlertDialog.Description>
				This will cordon <strong>{drainTarget?.name}</strong> and evict all non-daemonset pods.
				Running workloads will be rescheduled on other nodes. This action cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				onclick={confirmDrain}
			>
				Drain node
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-h-[90vh] max-w-4xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Node Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedNode}
			{@const NodeStatusIcon = getStatusIcon(selectedNode.status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedNode.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(selectedNode.status)} px-2 py-0.5 text-xs"
									title={selectedNode.status}
								>
									<NodeStatusIcon class="mr-1 size-3" />
									{selectedNode.status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Roles</p>
							<p class="mt-1 text-sm">{formatRoles(selectedNode.roles)}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Version</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedNode.version}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Internal IP</p>
							<p class="mt-1 font-mono text-sm">{selectedNode.internalIP}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedNode.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedNode.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- System Info -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">System Info</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">OS Image</p>
							<p class="mt-1 text-sm">{selectedNode.osImage}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Kernel Version</p>
							<p class="mt-1 font-mono text-sm">{selectedNode.kernelVersion}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Container Runtime</p>
							<p class="mt-1 text-sm">{selectedNode.containerRuntime}</p>
						</div>
					</div>
				</div>

				<!-- Capacity & Allocatable -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Capacity / Allocatable</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">CPU</p>
							<p class="mt-1 font-mono text-sm">
								{formatCapacity(selectedNode.cpuCapacity, 'cpu')} / {formatCapacity(selectedNode.cpuAllocatable, 'cpu')}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Memory</p>
							<p class="mt-1 font-mono text-sm">
								{formatCapacity(selectedNode.memoryCapacity, 'memory')} / {formatCapacity(selectedNode.memoryAllocatable, 'memory')}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Disk</p>
							<p class="mt-1 font-mono text-sm">
								{formatCapacity(selectedNode.diskCapacity, 'disk')} / {formatCapacity(selectedNode.diskAllocatable, 'disk')}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Pods</p>
							<p class="mt-1 font-mono text-sm">
								{selectedNode.podsCount} / {selectedNode.podsCapacity}
							</p>
						</div>
						{#if selectedNode.cpuUsage || selectedNode.memoryUsage}
							<div>
								<p class="text-sm font-medium text-muted-foreground">CPU Usage</p>
								<p class="mt-1 font-mono text-sm">{selectedNode.cpuUsage ?? '—'}</p>
							</div>
							<div>
								<p class="text-sm font-medium text-muted-foreground">Memory Usage</p>
								<p class="mt-1 font-mono text-sm">{selectedNode.memoryUsage ?? '—'}</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Addresses -->
				{#if selectedNode.addresses?.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Addresses</h3>
						<div class="space-y-2">
							{#each selectedNode.addresses as addr}
								<div class="flex items-center gap-2 text-sm">
									<Badge variant="outline" class="text-xs">{addr.type}</Badge>
									<span class="font-mono">{addr.address}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Conditions -->
				{#if selectedNode.conditions?.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Conditions</h3>
						<div class="space-y-2">
							{#each selectedNode.conditions as condition}
								<div class="rounded-md border bg-muted/40 p-2">
									<div class="mb-1 flex items-center gap-2">
										<Badge variant="outline" class="text-xs">{condition.type}</Badge>
										<span
											class={cn(
												'text-xs',
												condition.status === 'True'
													? condition.type === 'Ready'
														? 'text-emerald-500'
														: 'text-red-500'
													: condition.type === 'Ready'
														? 'text-red-500'
														: 'text-emerald-500'
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

				<!-- Taints -->
				{#if selectedNode.taints?.length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Taints</h3>
						<div class="space-y-2">
							{#each selectedNode.taints as taint}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<div class="flex items-center gap-2">
										<span class="font-mono text-xs">{taint.key}{taint.value ? `=${taint.value}` : ''}</span>
										<Badge variant="outline" class="text-xs">{taint.effect}</Badge>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedNode.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedNode.labels) as [k, v]}
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
					{#if Object.keys(selectedNode.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedNode.annotations) as [k, v]}
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

{#if activeCluster && showYamlDialog}
	<ResourceDrawer
		bind:open={showYamlDialog}
		clusterId={activeCluster.id}
		resource={drawerResource}
		onClose={closeYamlEditor}
		onSuccess={handleYamlSuccess}
	/>
{/if}
