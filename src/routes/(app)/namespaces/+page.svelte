<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { calculateAge, formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import { arrayAdd, arrayModify, arrayDelete, arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Info,
		Trash2,
		Box,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import { type Namespace, type NamespaceWithAge, getStatusIcon, getStatusColor } from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, namespacesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allNamespaces = $state<Namespace[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedNamespace = $state<NamespaceWithAge | null>(null);
	let deleting = $state(false);
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	function openDetail(ns: NamespaceWithAge) {
		selectedNamespace = ns;
		showDetailDialog = true;
	}

	const namespacesWithAge = $derived.by((): NamespaceWithAge[] => {
		// Access ticker.now to make this derived reactive to time updates
		const currentTime = timeTicker.now;
		return allNamespaces.map((ns) => ({ ...ns, age: calculateAgeWithTicker(ns.createdAt, currentTime) }));
	});

	let filteredNamespaces = $derived.by(() => {
		let result = namespacesWithAge;

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(namespace) =>
					namespace.name.toLowerCase().includes(query) ||
					namespace.status.toLowerCase().includes(query)
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof Namespace, sortState.direction, {
				createdAt: (val: any) => new Date(val).getTime(),
				labels: (val: any) => Object.keys(val).length
			});
		}

		return result;
	});

	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let namespacesWatch: ReturnType<typeof useResourceWatch<Namespace>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();

			if (namespacesWatch) namespacesWatch.unsubscribe();

			namespacesWatch = useResourceWatch<Namespace>({
				clusterId: activeCluster.id,
				resourceType: 'namespaces',
				onAdded: (ns) => {
					allNamespaces = arrayAdd(allNamespaces, ns, (n) => n.name);
				},
				onModified: (ns) => {
					allNamespaces = arrayModify(allNamespaces, ns, (n) => n.name);
				},
				onDeleted: (ns) => {
					allNamespaces = arrayDelete(allNamespaces, ns, (n) => n.name);
				}
			});

			namespacesWatch.subscribe();
		} else {
			allNamespaces = [];
			if (namespacesWatch) {
				namespacesWatch.unsubscribe();
				namespacesWatch = null;
			}
		}
	});

	onDestroy(() => {
		namespacesWatch?.unsubscribe();
		timeTicker.stop();
	});

	async function fetchNamespaces() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const res = await fetch(`/api/namespaces?cluster=${activeCluster.id}`);
			const data = await res.json();

			if (data.success && data.namespaces) {
				allNamespaces = data.namespaces;
			} else {
				error = data.error || 'Failed to fetch namespaces';
				allNamespaces = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch namespaces';
			allNamespaces = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(namespaceName: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const params = new URLSearchParams({
				cluster: activeCluster.id.toString(),
				name: namespaceName
			});
			const response = await fetch(`/api/namespaces/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete namespace');
			}
			toast.success(`Namespace ${namespaceName} deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete namespace: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function showDetails(namespace: NamespaceWithAge) {
		selectedNamespace = namespace;
		showDetailDialog = true;
	}

	function openYamlEditor(namespace: NamespaceWithAge) {
		drawerResource = { resourceType: 'namespace', name: namespace.name };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchNamespaces();
	}
</script>

<svelte:head>
	<title>Namespaces - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Namespaces</h1>
			<span class="text-sm text-muted-foreground">
				{filteredNamespaces.length} of {namespacesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchNamespaces}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				placeholder="Search namespaces..."
				class="h-8 w-full pl-8 text-xs sm:w-56"
				bind:value={searchQuery}
			/>
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
				<p class="text-sm text-muted-foreground">Select a cluster to view namespaces</p>
			</div>
		</div>
	{:else if !loading && !error && allNamespaces.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No namespaces found</h3>
				<p class="text-sm text-muted-foreground">This cluster has no namespaces</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredNamespaces}
				keyField="name"
				name={TableName.namespaces}
				columns={namespacesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, namespace: NamespaceWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Box class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{namespace.name}</span>
						</div>
					{:else if column.id === 'status'}
						{@const StatusIcon = getStatusIcon(namespace.status)}
						<div class="flex justify-center">
							<Badge
								class="{getStatusColor(namespace.status)} px-2 py-0.5"
								title={namespace.status}
							>
								<StatusIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{namespace.status}</span>
							</Badge>
						</div>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{namespace.age}</span>
					{:else if column.id === 'labels'}
						<div class="flex flex-wrap gap-1">
							{#if Object.keys(namespace.labels).length > 0}
								{#each Object.entries(namespace.labels).slice(0, 1) as [key, value]}
									<Badge variant="outline" class="px-1.5 py-0 font-mono text-xs">
										{key}: {value}
									</Badge>
								{/each}
								{#if Object.keys(namespace.labels).length > 1}
									<Badge variant="outline" class="px-1.5 py-0 text-xs">
										+{Object.keys(namespace.labels).length - 1}
									</Badge>
								{/if}
							{:else}
								<span class="text-xs text-muted-foreground">None</span>
							{/if}
						</div>
					{:else if column.id === 'created'}
						<span class="font-mono text-xs text-muted-foreground"
							>{formatCreatedAt(namespace.createdAt)}</span
						>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-1">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(namespace);
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
									showDetails(namespace);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={namespace.name}
								loading={deleting}
								onConfirm={() => handleDelete(namespace.name)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete namespace"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Box class="mb-3 h-10 w-10 opacity-40" />
						<p>No namespaces found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading namespaces...
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
			<Dialog.Title>Namespace Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedNamespace}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedNamespace.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class={cn(
										'rounded-full px-2 py-0.5 text-xs font-medium',
										selectedNamespace.status === 'Active'
											? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15'
											: 'bg-red-500/15 text-red-400 hover:bg-red-500/15'
									)}
								>
									<span
										class={cn(
											'mr-1.5 inline-block size-1.5 rounded-full',
											selectedNamespace.status === 'Active' ? 'bg-emerald-400' : 'bg-red-400'
										)}
									></span>
									{selectedNamespace.status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedNamespace.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">{formatCreatedAt(selectedNamespace.createdAt)}</p>
						</div>
					</div>
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedNamespace.labels).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedNamespace.labels) as [k, v]}
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
					{#if Object.keys(selectedNamespace.annotations).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedNamespace.annotations) as [k, v]}
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
