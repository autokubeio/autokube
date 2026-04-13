<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import NamespaceSelect from '$lib/components/namespace-select.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import { arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Network,
		Info,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type Endpoint,
		type EndpointWithAge,
		formatAddresses,
		formatPorts,
		getAddresses,
		getPorts
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, endpointsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allEndpoints = $state<Endpoint[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Search debounce
	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSearch(value: string) {
		if (_searchTimer !== null) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => { searchQuery = value; }, 150);
	}

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedEndpoint = $state<EndpointWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Endpoints with age (reactive to ticker)
	const endpointsWithAge = $derived.by((): EndpointWithAge[] => {
		const currentTime = timeTicker.now;
		return allEndpoints.map((ep) => ({
			...ep,
			age: calculateAgeWithTicker(ep.createdAt, currentTime)
		}));
	});

	// Filtered endpoints
	const filteredEndpoints = $derived.by(() => {
		let result = endpointsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((ep) => ep.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(ep) =>
					ep.name.toLowerCase().includes(query) ||
					ep.namespace.toLowerCase().includes(query) ||
					formatAddresses(ep.subsets).toLowerCase().includes(query) ||
					formatPorts(ep.subsets).toLowerCase().includes(query)
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof Endpoint, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let endpointsWatch: ReturnType<typeof useBatchWatch<Endpoint>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchEndpoints();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (endpointsWatch) endpointsWatch.unsubscribe();

			endpointsWatch = useBatchWatch<Endpoint>({


				clusterId: activeCluster.id,


				resourceType: 'endpoints',


				namespace: ns,


				getItems: () => allEndpoints,


				setItems: (v) => { allEndpoints = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			endpointsWatch.subscribe();
		} else {
			allEndpoints = [];
			namespaces = [];
			if (endpointsWatch) {
				endpointsWatch.unsubscribe();
				endpointsWatch = null;
			}
		}
	});

	onDestroy(() => {
		endpointsWatch?.unsubscribe();
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
			console.error('[Endpoints] Failed to fetch namespaces:', err);
		}
	}

	async function fetchEndpoints() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/endpoints?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.endpoints) {
				allEndpoints = data.endpoints;
			} else {
				error = data.error || 'Failed to fetch endpoints';
				allEndpoints = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch endpoints';
			allEndpoints = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/endpoints/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete endpoint');
			}
			toast.success(`Endpoint "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete endpoint: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(ep: EndpointWithAge) {
		selectedEndpoint = ep;
		showDetailDialog = true;
	}

	function openYamlEditor(ep: EndpointWithAge) {
		drawerResource = { resourceType: 'endpoint', name: ep.name, namespace: ep.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchEndpoints();
	}
</script>

<svelte:head>
	<title>Endpoints - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Endpoints</h1>
			<span class="text-sm text-muted-foreground">
				{filteredEndpoints.length} of {endpointsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchEndpoints}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns) => { selectedNamespace = ns; fetchEndpoints(); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search endpoints..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view endpoints</p>
			</div>
		</div>
	{:else if !loading && !error && allEndpoints.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No endpoints found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no endpoints'
						: `No endpoints in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredEndpoints}
				keyField="name"
				name={TableName.endpoints}
				columns={endpointsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, ep: EndpointWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Network class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{ep.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={ep.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = ep.namespace;
								fetchEndpoints();
							}}
						/>
					{:else if column.id === 'addresses'}
						{@const addrs = getAddresses(ep.subsets)}
						<span class="truncate font-mono text-xs" title={addrs.join(', ') || 'None'}>
							{formatAddresses(ep.subsets)}
						</span>
					{:else if column.id === 'ports'}
						<span class="truncate font-mono text-xs" title={formatPorts(ep.subsets)}>
							{formatPorts(ep.subsets)}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{ep.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(ep);
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
									openDetail(ep);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={ep.name}
								loading={deleting}
								onConfirm={() => handleDelete(ep.name, ep.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete endpoint"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Network class="mb-3 h-10 w-10 opacity-40" />
						<p>No endpoints found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading endpoints...
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
			<Dialog.Title>Endpoint Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedEndpoint}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedEndpoint.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedEndpoint.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedEndpoint.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedEndpoint.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Subsets -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Subsets</h3>
					{#if selectedEndpoint.subsets.length > 0}
						<div class="space-y-3">
							{#each selectedEndpoint.subsets as subset, i}
								<div class="rounded-md border bg-muted/40 p-3">
									<p class="mb-2 text-xs font-medium text-muted-foreground">Subset {i + 1}</p>
									<!-- Addresses -->
									<div class="mb-3">
										<p class="mb-1 text-xs font-medium text-muted-foreground">Addresses</p>
										{#if (subset.addresses ?? []).length > 0}
											<div class="flex flex-wrap gap-1.5">
												{#each subset.addresses ?? [] as addr}
													<Badge variant="outline" class="font-mono text-xs">
														{addr.ip}{addr.nodeName ? ` (${addr.nodeName})` : ''}
													</Badge>
												{/each}
											</div>
										{:else}
											<p class="text-xs text-muted-foreground">No addresses</p>
										{/if}
									</div>
									<!-- Ports -->
									<div>
										<p class="mb-1 text-xs font-medium text-muted-foreground">Ports</p>
										{#if (subset.ports ?? []).length > 0}
											<div class="flex flex-wrap gap-1.5">
												{#each subset.ports ?? [] as port}
													<Badge variant="outline" class="font-mono text-xs">
														{port.name ? `${port.name}: ` : ''}{port.port}/{port.protocol}
													</Badge>
												{/each}
											</div>
										{:else}
											<p class="text-xs text-muted-foreground">No ports</p>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No subsets</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedEndpoint.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedEndpoint.labels) as [k, v]}
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
					{#if Object.keys(selectedEndpoint.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedEndpoint.annotations) as [k, v]}
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
