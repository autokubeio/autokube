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
		type EndpointSlice,
		type EndpointSliceWithAge,
		formatAddresses,
		formatPorts,
		getEndpointCount,
		getAddressTypeColor
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, endpointSlicesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allEndpointSlices = $state<EndpointSlice[]>([]);
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
	let selectedSlice = $state<EndpointSliceWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// EndpointSlices with age
	const endpointSlicesWithAge = $derived.by((): EndpointSliceWithAge[] => {
		const currentTime = timeTicker.now;
		return allEndpointSlices.map((es) => ({
			...es,
			age: calculateAgeWithTicker(es.createdAt, currentTime)
		}));
	});

	// Filtered endpoint slices
	const filteredEndpointSlices = $derived.by(() => {
		let result = endpointSlicesWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((es) => es.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(es) =>
					es.name.toLowerCase().includes(query) ||
					es.namespace.toLowerCase().includes(query) ||
					es.addressType.toLowerCase().includes(query) ||
					formatPorts(es.ports).toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof EndpointSlice, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	let endpointSlicesWatch: ReturnType<typeof useBatchWatch<EndpointSlice>> | null = null;

	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchNamespaces(clusterId);
			fetchEndpointSlices(clusterId, selectedNamespace);

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (endpointSlicesWatch) endpointSlicesWatch.unsubscribe();

			endpointSlicesWatch = useBatchWatch<EndpointSlice>({


				clusterId,


				resourceType: 'endpointslices',


				namespace: ns,


				getItems: () => allEndpointSlices,


				setItems: (v) => { allEndpointSlices = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			endpointSlicesWatch.subscribe();
		} else {
			allEndpointSlices = [];
			namespaces = [];
			if (endpointSlicesWatch) {
				endpointSlicesWatch.unsubscribe();
				endpointSlicesWatch = null;
			}
		}
	});

	onDestroy(() => {
		endpointSlicesWatch?.unsubscribe();
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
			console.error('[EndpointSlices] Failed to fetch namespaces:', err);
		}
	}

	async function fetchEndpointSlices(clusterId: number, nsParam: string) {
		loading = true;
		error = null;

		try {
			const ns = nsParam === 'all' ? 'all' : nsParam;
			const res = await fetch(`/api/clusters/${clusterId}/endpointslices?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.endpointSlices) {
				allEndpointSlices = data.endpointSlices;
			} else {
				error = data.error || 'Failed to fetch endpoint slices';
				allEndpointSlices = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch endpoint slices';
			allEndpointSlices = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/endpointslices/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete endpoint slice');
			}
			toast.success(`Endpoint slice "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete endpoint slice: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(es: EndpointSliceWithAge) {
		selectedSlice = es;
		showDetailDialog = true;
	}

	function openYamlEditor(es: EndpointSliceWithAge) {
		drawerResource = { resourceType: 'endpointslice', name: es.name, namespace: es.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchEndpointSlices(activeClusterId, selectedNamespace);
	}
</script>

<svelte:head>
	<title>Endpoint Slices - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Endpoint Slices</h1>
			<span class="text-sm text-muted-foreground">
				{filteredEndpointSlices.length} of {endpointSlicesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchEndpointSlices(activeClusterId, selectedNamespace); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns: string) => { selectedNamespace = ns; if (activeClusterId) fetchEndpointSlices(activeClusterId, ns); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search endpoint slices..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view endpoint slices</p>
			</div>
		</div>
	{:else if !loading && !error && allEndpointSlices.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No endpoint slices found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no endpoint slices'
						: `No endpoint slices in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredEndpointSlices}
				keyField="id"
				name={TableName.endpointslices}
				columns={endpointSlicesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, es: EndpointSliceWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Network class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{es.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={es.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = es.namespace;
								if (activeClusterId) fetchEndpointSlices(activeClusterId, es.namespace);
							}}
						/>
					{:else if column.id === 'addressType'}
						<span
							class={cn(
								'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
								getAddressTypeColor(es.addressType)
							)}
						>
							{es.addressType}
						</span>
					{:else if column.id === 'endpoints'}
						<span class="text-xs text-muted-foreground">
							{getEndpointCount(es.endpoints)}
						</span>
					{:else if column.id === 'ports'}
						<span class="truncate font-mono text-xs" title={formatPorts(es.ports)}>
							{formatPorts(es.ports)}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{es.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(es);
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
									openDetail(es);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={es.name}
								loading={deleting}
								onConfirm={() => handleDelete(es.name, es.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete endpoint slice"
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
						<p>No endpoint slices found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading endpoint slices...
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
			<Dialog.Title>Endpoint Slice Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedSlice}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedSlice.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedSlice.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Address Type</p>
							<span
								class={cn(
									'mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
									getAddressTypeColor(selectedSlice.addressType)
								)}
							>
								{selectedSlice.addressType}
							</span>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedSlice.age}</p>
						</div>
						<div class="col-span-2">
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedSlice.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Endpoints -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						Endpoints ({getEndpointCount(selectedSlice.endpoints)})
					</h3>
					{#if selectedSlice.endpoints.length > 0}
						<div class="space-y-2">
							{#each selectedSlice.endpoints as ep, i}
								<div class="rounded-md border bg-muted/40 p-3">
									<div class="mb-1 flex items-center gap-2">
										<p class="text-xs font-medium text-muted-foreground">Endpoint {i + 1}</p>
										{#if ep.conditions?.ready !== undefined}
											<Badge
												variant={ep.conditions.ready ? 'default' : 'destructive'}
												class="px-1.5 py-0 text-[10px]"
											>
												{ep.conditions.ready ? 'Ready' : 'Not Ready'}
											</Badge>
										{/if}
									</div>
									{#if (ep.addresses ?? []).length > 0}
										<div class="flex flex-wrap gap-1.5">
											{#each ep.addresses ?? [] as addr}
												<Badge variant="outline" class="font-mono text-xs">{addr}</Badge>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">No addresses</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No endpoints</p>
					{/if}
				</div>

				<!-- Ports -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Ports</h3>
					{#if selectedSlice.ports.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each selectedSlice.ports as port}
								<Badge variant="outline" class="font-mono text-xs">
									{port.name ? `${port.name}: ` : ''}{port.port}/{port.protocol || 'TCP'}
								</Badge>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No ports</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedSlice.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedSlice.labels) as [k, v]}
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
					{#if Object.keys(selectedSlice.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedSlice.annotations) as [k, v]}
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
