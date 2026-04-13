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
		type Service,
		type ServiceWithAge,
		getTypeIcon,
		getTypeColor,
		formatPorts,
		formatExternalIPs
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, servicesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allServices = $state<Service[]>([]);
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
	let selectedService = $state<ServiceWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Services with age (reactive to ticker)
	const servicesWithAge = $derived.by((): ServiceWithAge[] => {
		const currentTime = timeTicker.now;
		return allServices.map((svc) => ({
			...svc,
			age: calculateAgeWithTicker(svc.createdAt, currentTime)
		}));
	});

	// Filtered services
	const filteredServices = $derived.by(() => {
		let result = servicesWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((svc) => svc.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(svc) =>
					svc.name.toLowerCase().includes(query) ||
					svc.namespace.toLowerCase().includes(query) ||
					svc.type.toLowerCase().includes(query) ||
					svc.clusterIP.toLowerCase().includes(query) ||
					formatPorts(svc.ports).toLowerCase().includes(query) ||
					formatExternalIPs(svc.externalIPs).toLowerCase().includes(query)
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof Service, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let servicesWatch: ReturnType<typeof useBatchWatch<Service>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchServices();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (servicesWatch) servicesWatch.unsubscribe();

			servicesWatch = useBatchWatch<Service>({


				clusterId: activeCluster.id,


				resourceType: 'services',


				namespace: ns,


				getItems: () => allServices,


				setItems: (v) => { allServices = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			servicesWatch.subscribe();
		} else {
			allServices = [];
			namespaces = [];
			if (servicesWatch) {
				servicesWatch.unsubscribe();
				servicesWatch = null;
			}
		}
	});

	onDestroy(() => {
		servicesWatch?.unsubscribe();
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
			console.error('[Services] Failed to fetch namespaces:', err);
		}
	}

	async function fetchServices() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/services?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.services) {
				allServices = data.services;
			} else {
				error = data.error || 'Failed to fetch services';
				allServices = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch services';
			allServices = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/services/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete service');
			}
			toast.success(`Service "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete service: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(svc: ServiceWithAge) {
		selectedService = svc;
		showDetailDialog = true;
	}

	function openYamlEditor(svc: ServiceWithAge) {
		drawerResource = { resourceType: 'service', name: svc.name, namespace: svc.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchServices();
	}
</script>

<svelte:head>
	<title>Services - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Services</h1>
			<span class="text-sm text-muted-foreground">
				{filteredServices.length} of {servicesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchServices}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns) => { selectedNamespace = ns; fetchServices(); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search services..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view services</p>
			</div>
		</div>
	{:else if !loading && !error && allServices.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No services found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no services'
						: `No services in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredServices}
				keyField="name"
				name={TableName.services}
				columns={servicesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, svc: ServiceWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Network class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{svc.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={svc.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = svc.namespace;
								fetchServices();
							}}
						/>
					{:else if column.id === 'type'}
						{@const TypeIcon = getTypeIcon(svc.type)}
						<div class="flex items-center gap-1.5">
							<Badge class="{getTypeColor(svc.type)} px-2 py-0.5" title={svc.type}>
								<TypeIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{svc.type}</span>
							</Badge>
						</div>
					{:else if column.id === 'clusterIP'}
						<span class="font-mono text-xs">{svc.clusterIP}</span>
					{:else if column.id === 'externalIP'}
						<span class="truncate font-mono text-xs text-muted-foreground" title={formatExternalIPs(svc.externalIPs)}>
							{formatExternalIPs(svc.externalIPs)}
						</span>
					{:else if column.id === 'ports'}
						<span class="truncate font-mono text-xs" title={formatPorts(svc.ports)}>
							{formatPorts(svc.ports)}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{svc.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(svc);
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
									openDetail(svc);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={svc.name}
								loading={deleting}
								onConfirm={() => handleDelete(svc.name, svc.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete service"
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
						<p>No services found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading services...
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
			<Dialog.Title>Service Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedService}
			{@const TypeIcon = getTypeIcon(selectedService.type)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedService.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedService.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Type</p>
							<div class="mt-1">
								<Badge class="{getTypeColor(selectedService.type)} px-2 py-0.5 text-xs">
									<TypeIcon class="mr-1 size-3" />
									{selectedService.type}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Cluster IP</p>
							<p class="mt-1 font-mono text-sm">{selectedService.clusterIP}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">External IPs</p>
							<p class="mt-1 font-mono text-sm">
								{formatExternalIPs(selectedService.externalIPs)}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Session Affinity</p>
							<p class="mt-1 text-sm">{selectedService.sessionAffinity}</p>
						</div>
						{#if selectedService.loadBalancerIP}
							<div>
								<p class="text-sm font-medium text-muted-foreground">Load Balancer IP</p>
								<p class="mt-1 font-mono text-sm">{selectedService.loadBalancerIP}</p>
							</div>
						{/if}
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedService.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedService.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Ports -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Ports</h3>
					{#if selectedService.ports.length > 0}
						<div class="space-y-2">
							{#each selectedService.ports as port}
								<div class="rounded-md border bg-muted/40 p-3">
									<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
										{#if port.name}
											<div>
												<p class="text-sm font-medium text-muted-foreground">Name</p>
												<p class="mt-1 font-mono text-sm">{port.name}</p>
											</div>
										{/if}
										<div>
											<p class="text-sm font-medium text-muted-foreground">Port</p>
											<p class="mt-1 font-mono text-sm">{port.port}</p>
										</div>
										<div>
											<p class="text-sm font-medium text-muted-foreground">Target Port</p>
											<p class="mt-1 font-mono text-sm">{port.targetPort}</p>
										</div>
										<div>
											<p class="text-sm font-medium text-muted-foreground">Protocol</p>
											<p class="mt-1 text-sm">{port.protocol}</p>
										</div>
										{#if port.nodePort}
											<div>
												<p class="text-sm font-medium text-muted-foreground">Node Port</p>
												<p class="mt-1 font-mono text-sm">{port.nodePort}</p>
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No ports configured</p>
					{/if}
				</div>

				<!-- Selector -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Selector</h3>
					{#if Object.keys(selectedService.selector ?? {}).length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each Object.entries(selectedService.selector) as [k, v]}
								<Badge variant="outline" class="font-mono text-xs">{k}={v}</Badge>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No selector</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedService.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedService.labels) as [k, v]}
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
					{#if Object.keys(selectedService.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedService.annotations) as [k, v]}
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
