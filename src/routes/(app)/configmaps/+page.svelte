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
		FileText,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Database
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import type { ConfigMap, ConfigMapWithAge } from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, configMapsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allConfigMaps = $state<ConfigMap[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedConfigMap = $state<ConfigMapWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// ConfigMaps with age
	const configMapsWithAge = $derived.by((): ConfigMapWithAge[] => {
		const currentTime = timeTicker.now;
		return allConfigMaps.map((cm) => ({
			...cm,
			age: calculateAgeWithTicker(cm.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredConfigMaps = $derived.by(() => {
		let result = configMapsWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((cm) => cm.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(cm) =>
					cm.name.toLowerCase().includes(query) ||
					cm.namespace.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof ConfigMap, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let configMapsWatch: ReturnType<typeof useResourceWatch<ConfigMap>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchConfigMaps();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (configMapsWatch) configMapsWatch.unsubscribe();

			configMapsWatch = useResourceWatch<ConfigMap>({
				clusterId: activeCluster.id,
				resourceType: 'configmaps',
				namespace: ns,
				onAdded: (cm) => {
					allConfigMaps = arrayAdd(allConfigMaps, cm, (i) => `${i.namespace}/${i.name}`);
				},
				onModified: (cm) => {
					allConfigMaps = arrayModify(allConfigMaps, cm, (i) => `${i.namespace}/${i.name}`);
				},
				onDeleted: (cm) => {
					allConfigMaps = arrayDelete(allConfigMaps, cm, (i) => `${i.namespace}/${i.name}`);
				}
			});

			configMapsWatch.subscribe();
		} else {
			allConfigMaps = [];
			namespaces = [];
			if (configMapsWatch) {
				configMapsWatch.unsubscribe();
				configMapsWatch = null;
			}
		}
	});

	onDestroy(() => {
		configMapsWatch?.unsubscribe();
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
			console.error('[ConfigMaps] Failed to fetch namespaces:', err);
		}
	}

	async function fetchConfigMaps() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/configmaps?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.configMaps) {
				allConfigMaps = data.configMaps;
			} else {
				error = data.error || 'Failed to fetch config maps';
				allConfigMaps = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch config maps';
			allConfigMaps = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/configmaps/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete config map');
			}
			toast.success(`ConfigMap "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete config map: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(cm: ConfigMapWithAge) {
		selectedConfigMap = cm;
		showDetailDialog = true;
	}

	function openYamlEditor(cm: ConfigMapWithAge) {
		drawerResource = { resourceType: 'configmap', name: cm.name, namespace: cm.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchConfigMaps();
	}
</script>

<svelte:head>
	<title>ConfigMaps - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">ConfigMaps</h1>
			<span class="text-sm text-muted-foreground">
				{filteredConfigMaps.length} of {configMapsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchConfigMaps}
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
						fetchConfigMaps();
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
					placeholder="Search config maps..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view config maps</p>
			</div>
		</div>
	{:else if !loading && !error && allConfigMaps.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<FileText class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No config maps found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no config maps'
						: `No config maps in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredConfigMaps}
				keyField="id"
				name={TableName.configmaps}
				columns={configMapsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, cm: ConfigMapWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{cm.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={cm.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = cm.namespace;
								fetchConfigMaps();
							}}
						/>
					{:else if column.id === 'dataCount'}
						<div class="flex items-center gap-1">
							<Database class="size-3 text-muted-foreground" />
							<span class="text-xs">{cm.dataCount}</span>
						</div>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{cm.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(cm);
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
									openDetail(cm);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={cm.name}
								loading={deleting}
								onConfirm={() => handleDelete(cm.name, cm.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete config map"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<FileText class="mb-3 h-10 w-10 opacity-40" />
						<p>No config maps found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading config maps...
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
			<Dialog.Title>ConfigMap Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedConfigMap}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedConfigMap.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedConfigMap.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Data Keys</p>
							<p class="mt-1 text-sm">{selectedConfigMap.dataCount}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Binary Data Keys</p>
							<p class="mt-1 text-sm">{Object.keys(selectedConfigMap.binaryData).length}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedConfigMap.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedConfigMap.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Data -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Data ({Object.keys(selectedConfigMap.data).length} keys)</h3>
					{#if Object.keys(selectedConfigMap.data).length > 0}
						<div class="max-h-96 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedConfigMap.data) as [key, value]}
								{@const parsed = tryPrettyJson(value)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<p class="mb-1 font-mono text-xs font-medium text-muted-foreground">{key}</p>
									{#if parsed.pretty}
										<pre class="overflow-x-auto font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">{parsed.text}</pre>
									{:else}
										<pre class="overflow-x-auto font-mono text-xs break-all whitespace-pre-wrap">{value}</pre>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No data</p>
					{/if}
				</div>

				<!-- Binary Data -->
				{#if Object.keys(selectedConfigMap.binaryData).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Binary Data ({Object.keys(selectedConfigMap.binaryData).length} keys)</h3>
						<div class="flex flex-wrap gap-1.5">
							{#each Object.keys(selectedConfigMap.binaryData) as key}
								<Badge variant="secondary" class="font-mono text-xs">{key}</Badge>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedConfigMap.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedConfigMap.labels) as [k, v]}
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
					{#if Object.keys(selectedConfigMap.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedConfigMap.annotations) as [k, v]}
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
