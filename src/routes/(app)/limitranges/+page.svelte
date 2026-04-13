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
		Ruler,
		Info,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type LimitRange,
		type LimitRangeWithAge,
		getLimitTypeColor,
		getLimitTypeShort
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, limitRangesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allLimitRanges = $state<LimitRange[]>([]);
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
	let selectedLimitRange = $state<LimitRangeWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// LimitRanges with age
	const limitRangesWithAge = $derived.by((): LimitRangeWithAge[] => {
		const currentTime = timeTicker.now;
		return allLimitRanges.map((lr) => ({
			...lr,
			age: calculateAgeWithTicker(lr.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredLimitRanges = $derived.by(() => {
		let result = limitRangesWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((lr) => lr.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(lr) =>
					lr.name.toLowerCase().includes(query) ||
					lr.namespace.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof LimitRange, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let lrWatch: ReturnType<typeof useBatchWatch<LimitRange>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchLimitRanges();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (lrWatch) lrWatch.unsubscribe();

			lrWatch = useBatchWatch<LimitRange>({


				clusterId: activeCluster.id,


				resourceType: 'limitranges',


				namespace: ns,


				getItems: () => allLimitRanges,


				setItems: (v) => { allLimitRanges = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			lrWatch.subscribe();
		} else {
			allLimitRanges = [];
			namespaces = [];
			if (lrWatch) {
				lrWatch.unsubscribe();
				lrWatch = null;
			}
		}
	});

	onDestroy(() => {
		lrWatch?.unsubscribe();
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
			console.error('[LimitRanges] Failed to fetch namespaces:', err);
		}
	}

	async function fetchLimitRanges() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/limitranges?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.limitRanges) {
				allLimitRanges = data.limitRanges;
			} else {
				error = data.error || 'Failed to fetch limit ranges';
				allLimitRanges = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch limit ranges';
			allLimitRanges = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/limitranges/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete limit range');
			}
			toast.success(`Limit range "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete limit range: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(lr: LimitRangeWithAge) {
		selectedLimitRange = lr;
		showDetailDialog = true;
	}

	function openYamlEditor(lr: LimitRangeWithAge) {
		drawerResource = { resourceType: 'limitrange', name: lr.name, namespace: lr.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchLimitRanges();
	}
</script>

<svelte:head>
	<title>Limit Ranges - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Limit Ranges</h1>
			<span class="text-sm text-muted-foreground">
				{filteredLimitRanges.length} of {limitRangesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchLimitRanges}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns) => { selectedNamespace = ns; fetchLimitRanges(); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search limit ranges..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view limit ranges</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredLimitRanges}
				keyField="id"
				name={TableName.limitranges}
				columns={limitRangesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, lr: LimitRangeWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Ruler class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{lr.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={lr.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = lr.namespace;
								fetchLimitRanges();
							}}
						/>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{lr.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(lr);
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
									openDetail(lr);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={lr.name}
								loading={deleting}
								onConfirm={() => handleDelete(lr.name, lr.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete limit range"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<div class="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
							<Ruler class="size-6 text-muted-foreground" />
						</div>
						<h3 class="mb-1 font-semibold text-foreground">No limit ranges found</h3>
						<p class="text-sm">
							{selectedNamespace === 'all'
								? 'This cluster has no limit ranges'
								: `No limit ranges in namespace "${selectedNamespace}"`}
						</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading limit ranges...
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
			<Dialog.Title>Limit Range Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedLimitRange}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedLimitRange.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs"
								>{selectedLimitRange.namespace}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Limit Rules</p>
							<p class="mt-1 text-sm">
								{selectedLimitRange.limits.length} rule{selectedLimitRange.limits.length !== 1
									? 's'
									: ''}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedLimitRange.age}</p>
						</div>
						<div class="col-span-2">
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedLimitRange.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Limit Rules -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						<span class="flex items-center gap-1.5">
							<Ruler class="size-4" />
							Limit Rules ({selectedLimitRange.limits.length})
						</span>
					</h3>
					{#if selectedLimitRange.limits.length > 0}
						<div class="space-y-3">
							{#each selectedLimitRange.limits as limit, i}
								<div class="rounded-md border bg-muted/40 px-3 py-3">
									<div class="mb-2 flex items-center gap-2">
										<Badge
											class="{getLimitTypeColor(limit.type || 'Unknown')} px-1.5 py-0 text-xs"
										>
											{getLimitTypeShort(limit.type || 'Unknown')}
										</Badge>
										<span class="text-[11px] text-muted-foreground">Rule {i + 1}</span>
									</div>

									<div class="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
										{#if limit.max && Object.keys(limit.max).length > 0}
											<div>
												<p class="mb-1 font-medium text-muted-foreground">Max</p>
												{#each Object.entries(limit.max) as [k, v]}
													<p class="font-mono">
														<span class="text-muted-foreground">{k}:</span>
														{v}
													</p>
												{/each}
											</div>
										{/if}
										{#if limit.min && Object.keys(limit.min).length > 0}
											<div>
												<p class="mb-1 font-medium text-muted-foreground">Min</p>
												{#each Object.entries(limit.min) as [k, v]}
													<p class="font-mono">
														<span class="text-muted-foreground">{k}:</span>
														{v}
													</p>
												{/each}
											</div>
										{/if}
										{#if limit.default && Object.keys(limit.default).length > 0}
											<div>
												<p class="mb-1 font-medium text-muted-foreground">Default</p>
												{#each Object.entries(limit.default) as [k, v]}
													<p class="font-mono">
														<span class="text-muted-foreground">{k}:</span>
														{v}
													</p>
												{/each}
											</div>
										{/if}
										{#if limit.defaultRequest && Object.keys(limit.defaultRequest).length > 0}
											<div>
												<p class="mb-1 font-medium text-muted-foreground">Default Request</p>
												{#each Object.entries(limit.defaultRequest) as [k, v]}
													<p class="font-mono">
														<span class="text-muted-foreground">{k}:</span>
														{v}
													</p>
												{/each}
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No limit rules defined</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedLimitRange.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedLimitRange.labels) as [k, v]}
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
					{#if Object.keys(selectedLimitRange.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedLimitRange.annotations) as [k, v]}
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
