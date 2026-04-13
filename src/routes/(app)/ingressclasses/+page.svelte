<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
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
		Globe,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Star
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import type { IngressClass, IngressClassWithAge } from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, ingressClassesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allIngressClasses = $state<IngressClass[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let searchQuery = $state('');

	// Search debounce
	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSearch(value: string) {
		if (_searchTimer !== null) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => { searchQuery = value; }, 150);
	}

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedClass = $state<IngressClassWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// IngressClasses with age
	const ingressClassesWithAge = $derived.by((): IngressClassWithAge[] => {
		const currentTime = timeTicker.now;
		return allIngressClasses.map((ic) => ({
			...ic,
			age: calculateAgeWithTicker(ic.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredIngressClasses = $derived.by(() => {
		let result = ingressClassesWithAge;

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(ic) =>
					ic.name.toLowerCase().includes(query) ||
					ic.controller.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof IngressClass, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	let ingressClassWatch: ReturnType<typeof useBatchWatch<IngressClass>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchIngressClasses();

			if (ingressClassWatch) ingressClassWatch.unsubscribe();

			ingressClassWatch = useBatchWatch<IngressClass>({


				clusterId: activeCluster.id,


				resourceType: 'ingressclasses',


				getItems: () => allIngressClasses,


				setItems: (v) => { allIngressClasses = v; },


				keyFn: (i) => i.name


			});

			ingressClassWatch.subscribe();
		} else {
			allIngressClasses = [];
			if (ingressClassWatch) {
				ingressClassWatch.unsubscribe();
				ingressClassWatch = null;
			}
		}
	});

	onDestroy(() => {
		ingressClassWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchIngressClasses() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const res = await fetch(`/api/clusters/${activeCluster.id}/ingressclasses`);
			const data = await res.json();

			if (data.success && data.ingressClasses) {
				allIngressClasses = data.ingressClasses;
			} else {
				error = data.error || 'Failed to fetch ingress classes';
				allIngressClasses = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch ingress classes';
			allIngressClasses = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/ingressclasses/${encodeURIComponent(name)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete ingress class');
			}
			toast.success(`Ingress class "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete ingress class: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(ic: IngressClassWithAge) {
		selectedClass = ic;
		showDetailDialog = true;
	}

	function openYamlEditor(ic: IngressClassWithAge) {
		drawerResource = { resourceType: 'ingressclass', name: ic.name };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchIngressClasses();
	}
</script>

<svelte:head>
	<title>Ingress Classes - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Ingress Classes</h1>
			<span class="text-sm text-muted-foreground">
				{filteredIngressClasses.length} of {ingressClassesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchIngressClasses}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search ingress classes..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view ingress classes</p>
			</div>
		</div>
	{:else if !loading && !error && allIngressClasses.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No ingress classes found</h3>
				<p class="text-sm text-muted-foreground">This cluster has no ingress classes</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredIngressClasses}
				keyField="name"
				name={TableName.ingressclasses}
				columns={ingressClassesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, ic: IngressClassWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Globe class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{ic.name}</span>
							{#if ic.isDefault}
								<Star class="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
							{/if}
						</div>
					{:else if column.id === 'controller'}
						<span class="truncate font-mono text-xs" title={ic.controller}>
							{ic.controller}
						</span>
					{:else if column.id === 'isDefault'}
						{#if ic.isDefault}
							<Badge
								class="bg-amber-500/15 px-1.5 py-0 text-xs text-amber-700 dark:text-amber-400"
							>
								Default
							</Badge>
						{:else}
							<span class="text-xs text-muted-foreground">—</span>
						{/if}
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{ic.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(ic);
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
									openDetail(ic);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={ic.name}
								loading={deleting}
								onConfirm={() => handleDelete(ic.name)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete ingress class"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Globe class="mb-3 h-10 w-10 opacity-40" />
						<p>No ingress classes found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading ingress classes...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-h-[90vh] max-w-2xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Ingress Class Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedClass}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedClass.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Default</p>
							<div class="mt-1">
								{#if selectedClass.isDefault}
									<Badge
										class="bg-amber-500/15 text-xs text-amber-700 dark:text-amber-400"
									>
										<Star class="mr-1 h-3 w-3 fill-amber-400" />
										Default
									</Badge>
								{:else}
									<span class="text-sm text-muted-foreground">No</span>
								{/if}
							</div>
						</div>
						<div class="col-span-2">
							<p class="text-sm font-medium text-muted-foreground">Controller</p>
							<p class="mt-1 font-mono text-sm">{selectedClass.controller}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedClass.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedClass.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Parameters -->
				{#if selectedClass.parameters}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Parameters</h3>
						<div class="rounded-md border bg-muted/40 p-3">
							{#if selectedClass.parameters.apiGroup}
								<div class="flex items-start gap-2 text-xs">
									<span class="font-mono text-muted-foreground">apiGroup:</span>
									<span class="font-mono">{selectedClass.parameters.apiGroup}</span>
								</div>
							{/if}
							{#if selectedClass.parameters.kind}
								<div class="flex items-start gap-2 text-xs">
									<span class="font-mono text-muted-foreground">kind:</span>
									<span class="font-mono">{selectedClass.parameters.kind}</span>
								</div>
							{/if}
							{#if selectedClass.parameters.name}
								<div class="flex items-start gap-2 text-xs">
									<span class="font-mono text-muted-foreground">name:</span>
									<span class="font-mono">{selectedClass.parameters.name}</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedClass.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedClass.labels) as [k, v]}
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
					{#if Object.keys(selectedClass.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedClass.annotations) as [k, v]}
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
