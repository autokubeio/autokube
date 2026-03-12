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
		Scale,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Gauge
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type ResourceQuota,
		type ResourceQuotaWithAge,
		formatResourceName,
		getUsagePercent,
		getUsageColor
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, resourceQuotasColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allQuotas = $state<ResourceQuota[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedQuota = $state<ResourceQuotaWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Quotas with age
	const quotasWithAge = $derived.by((): ResourceQuotaWithAge[] => {
		const currentTime = timeTicker.now;
		return allQuotas.map((q) => ({
			...q,
			age: calculateAgeWithTicker(q.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredQuotas = $derived.by(() => {
		let result = quotasWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((q) => q.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(q) =>
					q.name.toLowerCase().includes(query) ||
					q.namespace.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof ResourceQuota, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let quotasWatch: ReturnType<typeof useResourceWatch<ResourceQuota>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchQuotas();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (quotasWatch) quotasWatch.unsubscribe();

			quotasWatch = useResourceWatch<ResourceQuota>({
				clusterId: activeCluster.id,
				resourceType: 'resourcequotas',
				namespace: ns,
				onAdded: (q) => {
					allQuotas = arrayAdd(allQuotas, q, (i) => `${i.namespace}/${i.name}`);
				},
				onModified: (q) => {
					allQuotas = arrayModify(allQuotas, q, (i) => `${i.namespace}/${i.name}`);
				},
				onDeleted: (q) => {
					allQuotas = arrayDelete(allQuotas, q, (i) => `${i.namespace}/${i.name}`);
				}
			});

			quotasWatch.subscribe();
		} else {
			allQuotas = [];
			namespaces = [];
			if (quotasWatch) {
				quotasWatch.unsubscribe();
				quotasWatch = null;
			}
		}
	});

	onDestroy(() => {
		quotasWatch?.unsubscribe();
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
			console.error('[ResourceQuotas] Failed to fetch namespaces:', err);
		}
	}

	async function fetchQuotas() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/resourcequotas?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.resourceQuotas) {
				allQuotas = data.resourceQuotas;
			} else {
				error = data.error || 'Failed to fetch resource quotas';
				allQuotas = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch resource quotas';
			allQuotas = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/resourcequotas/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete resource quota');
			}
			toast.success(`Resource quota "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete resource quota: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(quota: ResourceQuotaWithAge) {
		selectedQuota = quota;
		showDetailDialog = true;
	}

	function openYamlEditor(quota: ResourceQuotaWithAge) {
		drawerResource = { resourceType: 'resourcequota', name: quota.name, namespace: quota.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchQuotas();
	}
</script>

<svelte:head>
	<title>Resource Quotas - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Resource Quotas</h1>
			<span class="text-sm text-muted-foreground">
				{filteredQuotas.length} of {quotasWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchQuotas}
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
						fetchQuotas();
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
					placeholder="Search resource quotas..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view resource quotas</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredQuotas}
				keyField="id"
				name={TableName.resourcequotas}
				columns={resourceQuotasColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, quota: ResourceQuotaWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Scale class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{quota.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={quota.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = quota.namespace;
								fetchQuotas();
							}}
						/>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{quota.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(quota);
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
									openDetail(quota);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={quota.name}
								loading={deleting}
								onConfirm={() => handleDelete(quota.name, quota.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete resource quota"
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
							<Scale class="size-6 text-muted-foreground" />
						</div>
						<h3 class="mb-1 font-semibold text-foreground">No resource quotas found</h3>
						<p class="text-sm">
							{selectedNamespace === 'all'
								? 'This cluster has no resource quotas'
								: `No resource quotas in namespace "${selectedNamespace}"`}
						</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading resource quotas...
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
			<Dialog.Title>Resource Quota Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedQuota}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedQuota.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedQuota.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Resources</p>
							<p class="mt-1 text-sm">{Object.keys(selectedQuota.hard).length} limits defined</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedQuota.age}</p>
						</div>
						<div class="col-span-2">
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedQuota.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Resource Usage -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						<span class="flex items-center gap-1.5">
							<Gauge class="size-4" />
							Resource Usage ({Object.keys(selectedQuota.hard).length})
						</span>
					</h3>
					{#if Object.keys(selectedQuota.hard).length > 0}
						<div class="space-y-2">
							{#each Object.entries(selectedQuota.hard) as [resource, hardVal]}
								{@const usedVal = selectedQuota.used[resource] || '0'}
								{@const percent = getUsagePercent(usedVal, hardVal)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<div class="mb-1 flex items-center justify-between">
										<span class="font-mono text-xs font-medium">{resource}</span>
										<span class={cn('text-xs font-medium', getUsageColor(percent))}>
											{percent}%
										</span>
									</div>
									<div class="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
										<div
											class={cn(
												'h-full rounded-full transition-all',
												percent >= 90
													? 'bg-red-500'
													: percent >= 75
														? 'bg-amber-500'
														: 'bg-green-500'
											)}
											style="width: {percent}%"
										></div>
									</div>
									<div class="flex justify-between text-[11px] text-muted-foreground">
										<span>Used: {usedVal}</span>
										<span>Hard: {hardVal}</span>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No resource limits defined</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedQuota.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedQuota.labels) as [k, v]}
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
					{#if Object.keys(selectedQuota.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedQuota.annotations) as [k, v]}
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
