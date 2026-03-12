<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import { arrayAdd, arrayModify, arrayDelete, arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Server,
		Info,
		Trash2,
		Loader2,
		FileCode,
		RotateCw
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type DaemonSet,
		type DaemonSetWithAge,
		getDaemonSetStatus,
		getStatusIcon,
		getStatusColor,
		statusDotClass
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, daemonSetsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allDaemonSets = $state<DaemonSet[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedDaemonSet = $state<DaemonSetWithAge | null>(null);
	let deleting = $state(false);
	let restarting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// DaemonSets with age (reactive to ticker)
	const daemonSetsWithAge = $derived.by((): DaemonSetWithAge[] => {
		const currentTime = timeTicker.now;
		return allDaemonSets.map((ds) => ({
			...ds,
			age: calculateAgeWithTicker(ds.createdAt, currentTime)
		}));
	});

	// Filtered daemonsets
	const filteredDaemonSets = $derived.by(() => {
		let result = daemonSetsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((ds) => ds.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(ds) =>
					ds.name?.toLowerCase().includes(query) ||
					ds.namespace?.toLowerCase().includes(query) ||
					(ds.containers ?? []).some((c) => c.image?.toLowerCase().includes(query))
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof DaemonSet, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				desired: (val: number) => Number(val),
				current: (val: number) => Number(val),
				ready: (val: number) => Number(val),
				upToDate: (val: number) => Number(val),
				available: (val: number) => Number(val)
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let daemonSetsWatch: ReturnType<typeof useResourceWatch<DaemonSet>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchDaemonSets();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (daemonSetsWatch) daemonSetsWatch.unsubscribe();

			daemonSetsWatch = useResourceWatch<DaemonSet>({
				clusterId: activeCluster.id,
				resourceType: 'daemonsets',
				namespace: ns,
				onAdded: (ds) => {
					allDaemonSets = arrayAdd(allDaemonSets, ds, (d) => `${d.namespace}/${d.name}`);
				},
				onModified: (ds) => {
					allDaemonSets = arrayModify(allDaemonSets, ds, (d) => `${d.namespace}/${d.name}`);
				},
				onDeleted: (ds) => {
					allDaemonSets = arrayDelete(allDaemonSets, ds, (d) => `${d.namespace}/${d.name}`);
				}
			});

			daemonSetsWatch.subscribe();
		} else {
			allDaemonSets = [];
			namespaces = [];
			if (daemonSetsWatch) {
				daemonSetsWatch.unsubscribe();
				daemonSetsWatch = null;
			}
		}
	});

	onDestroy(() => {
		daemonSetsWatch?.unsubscribe();
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
			console.error('[DaemonSets] Failed to fetch namespaces:', err);
		}
	}

	async function fetchDaemonSets() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/daemonsets?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.daemonSets) {
				allDaemonSets = data.daemonSets;
			} else {
				error = data.error || 'Failed to fetch daemonsets';
				allDaemonSets = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch daemonsets';
			allDaemonSets = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const params = new URLSearchParams({
				cluster: activeCluster.id.toString(),
				name,
				namespace
			});
			const response = await fetch(`/api/daemonsets/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete daemonset');
			}
			toast.success(`DaemonSet "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete daemonset: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	async function handleRestart(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			restarting = true;
			const response = await fetch('/api/daemonsets/restart', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cluster: activeCluster.id,
					name,
					namespace
				})
			});
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to restart daemonset');
			}
			toast.success(`DaemonSet "${name}" restarted`);
		} catch (err: any) {
			toast.error(`Failed to restart daemonset: ${err.message}`);
		} finally {
			restarting = false;
		}
	}

	function openDetail(ds: DaemonSetWithAge) {
		selectedDaemonSet = ds;
		showDetailDialog = true;
	}

	function openYamlEditor(ds: DaemonSetWithAge) {
		drawerResource = { resourceType: 'daemonset', name: ds.name, namespace: ds.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchDaemonSets();
	}
</script>

<svelte:head>
	<title>DaemonSets - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">DaemonSets</h1>
			<span class="text-sm text-muted-foreground">
				{filteredDaemonSets.length} of {daemonSetsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchDaemonSets}
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
						fetchDaemonSets();
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
					placeholder="Search daemonsets..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view daemonsets</p>
			</div>
		</div>
	{:else if !loading && !error && allDaemonSets.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No daemonsets found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no daemonsets'
						: `No daemonsets in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredDaemonSets}
				keyField="name"
				name={TableName.daemonsets}
				columns={daemonSetsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, daemonset: DaemonSetWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Server class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{daemonset.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={daemonset.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = daemonset.namespace;
								fetchDaemonSets();
							}}
						/>
					{:else if column.id === 'desired'}
						<span class="font-mono text-xs">{daemonset.desired}</span>
					{:else if column.id === 'current'}
						<span class="font-mono text-xs">{daemonset.current}</span>
					{:else if column.id === 'ready'}
						{@const status = getDaemonSetStatus(daemonset)}
						{@const StatusIcon = getStatusIcon(status)}
						<div class="flex items-center gap-1.5">
							<Badge class="{getStatusColor(status)} px-2 py-0.5" title={status}>
								<StatusIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{daemonset.ready}</span>
							</Badge>
						</div>
					{:else if column.id === 'upToDate'}
						<span class="font-mono text-xs">{daemonset.upToDate}</span>
					{:else if column.id === 'available'}
						<span class="font-mono text-xs">{daemonset.available}</span>
					{:else if column.id === 'nodeSelector'}
						{@const entries = Object.entries(daemonset.nodeSelector ?? {})}
						{#if entries.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each entries.slice(0, 2) as [k, v]}
									<Badge variant="secondary" class="max-w-40 truncate px-1.5 py-0 text-xs">
										{k}={v}
									</Badge>
								{/each}
								{#if entries.length > 2}
									<Badge variant="secondary" class="px-1.5 py-0 text-xs">
										+{entries.length - 2}
									</Badge>
								{/if}
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">—</span>
						{/if}
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{daemonset.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								disabled={restarting}
								onclick={(e) => {
									e.stopPropagation();
									handleRestart(daemonset.name, daemonset.namespace);
								}}
								title="Restart"
							>
								<RotateCw class={cn('h-3.5 w-3.5', restarting && 'animate-spin')} />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(daemonset);
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
									openDetail(daemonset);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={daemonset.name}
								loading={deleting}
								onConfirm={() => handleDelete(daemonset.name, daemonset.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete daemonset"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Server class="mb-3 h-10 w-10 opacity-40" />
						<p>No daemonsets found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading daemonsets...
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
			<Dialog.Title>DaemonSet Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedDaemonSet}
			{@const status = getDaemonSetStatus(selectedDaemonSet)}
			{@const DsStatusIcon = getStatusIcon(status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedDaemonSet.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs"
								>{selectedDaemonSet.namespace}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(status)} px-2 py-0.5 text-xs"
									title={status}
								>
									<DsStatusIcon class="mr-1 size-3" />
									{status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Desired</p>
							<p class="mt-1 font-mono text-sm">{selectedDaemonSet.desired}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Current</p>
							<p class="mt-1 font-mono text-sm">{selectedDaemonSet.current}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Ready</p>
							<p class="mt-1 font-mono text-sm">{selectedDaemonSet.ready}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Up-to-Date</p>
							<p class="mt-1 font-mono text-sm">{selectedDaemonSet.upToDate}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Available</p>
							<p class="mt-1 font-mono text-sm">{selectedDaemonSet.available}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedDaemonSet.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedDaemonSet.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Node Selector -->
				{#if Object.keys(selectedDaemonSet.nodeSelector ?? {}).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Node Selector</h3>
						<div class="flex flex-wrap gap-1">
							{#each Object.entries(selectedDaemonSet.nodeSelector) as [k, v]}
								<Badge variant="secondary" class="text-xs">{k}={v}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Selector -->
				{#if Object.keys(selectedDaemonSet.selector ?? {}).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Selector</h3>
						<div class="flex flex-wrap gap-1">
							{#each Object.entries(selectedDaemonSet.selector) as [k, v]}
								<Badge variant="secondary" class="text-xs">{k}={v}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Containers -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Containers</h3>
					<div class="space-y-3">
						{#each selectedDaemonSet.containers ?? [] as container}
							<div class="rounded-md border bg-muted/40 p-3">
								<div class="grid grid-cols-2 gap-3">
									<div>
										<p class="text-sm font-medium text-muted-foreground">Name</p>
										<p class="mt-1 font-mono text-sm">{container.name}</p>
									</div>
									<div class="col-span-2">
										<p class="text-sm font-medium text-muted-foreground">Image</p>
										<p class="mt-1 break-all font-mono text-xs">{container.image}</p>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Conditions -->
				{#if (selectedDaemonSet.conditions ?? []).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Conditions</h3>
						<div class="space-y-2">
							{#each selectedDaemonSet.conditions as condition}
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
					{#if Object.keys(selectedDaemonSet.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedDaemonSet.labels) as [k, v]}
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
					{#if Object.keys(selectedDaemonSet.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedDaemonSet.annotations) as [k, v]}
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
