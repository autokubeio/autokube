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
		HardDrive,
		Info,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type PVC,
		type PVCWithAge,
		getStatusColor,
		formatAccessMode
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, persistentVolumeClaimsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allPVCs = $state<PVC[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedPVC = $state<PVCWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// PVCs with age
	const pvcsWithAge = $derived.by((): PVCWithAge[] => {
		const currentTime = timeTicker.now;
		return allPVCs.map((pvc) => ({
			...pvc,
			age: calculateAgeWithTicker(pvc.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredPVCs = $derived.by(() => {
		let result = pvcsWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((pvc) => pvc.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(pvc) =>
					pvc.name.toLowerCase().includes(query) ||
					pvc.namespace.toLowerCase().includes(query) ||
					pvc.status.toLowerCase().includes(query) ||
					pvc.volume.toLowerCase().includes(query) ||
					pvc.storageClass.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof PVC, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let pvcsWatch: ReturnType<typeof useResourceWatch<PVC>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchPVCs();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (pvcsWatch) pvcsWatch.unsubscribe();

			pvcsWatch = useResourceWatch<PVC>({
				clusterId: activeCluster.id,
				resourceType: 'persistentvolumeclaims',
				namespace: ns,
				onAdded: (pvc) => {
					allPVCs = arrayAdd(allPVCs, pvc, (i) => `${i.namespace}/${i.name}`);
				},
				onModified: (pvc) => {
					allPVCs = arrayModify(allPVCs, pvc, (i) => `${i.namespace}/${i.name}`);
				},
				onDeleted: (pvc) => {
					allPVCs = arrayDelete(allPVCs, pvc, (i) => `${i.namespace}/${i.name}`);
				}
			});

			pvcsWatch.subscribe();
		} else {
			allPVCs = [];
			namespaces = [];
			if (pvcsWatch) {
				pvcsWatch.unsubscribe();
				pvcsWatch = null;
			}
		}
	});

	onDestroy(() => {
		pvcsWatch?.unsubscribe();
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
			console.error('[PVCs] Failed to fetch namespaces:', err);
		}
	}

	async function fetchPVCs() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(
				`/api/clusters/${activeCluster.id}/persistentvolumeclaims?namespace=${ns}`
			);
			const data = await res.json();

			if (data.success && data.persistentVolumeClaims) {
				allPVCs = data.persistentVolumeClaims;
			} else {
				error = data.error || 'Failed to fetch PVCs';
				allPVCs = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch PVCs';
			allPVCs = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/persistentvolumeclaims/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete PVC');
			}
			toast.success(`PVC "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete PVC: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(pvc: PVCWithAge) {
		selectedPVC = pvc;
		showDetailDialog = true;
	}

	function openYamlEditor(pvc: PVCWithAge) {
		drawerResource = { resourceType: 'persistentvolumeclaim', name: pvc.name, namespace: pvc.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchPVCs();
	}
</script>

<svelte:head>
	<title>Persistent Volume Claims - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Persistent Volume Claims</h1>
			<span class="text-sm text-muted-foreground">
				{filteredPVCs.length} of {pvcsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchPVCs}
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
						fetchPVCs();
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
					placeholder="Search PVCs..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view PVCs</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredPVCs}
				keyField="id"
				name={TableName.persistentvolumeclaims}
				columns={persistentVolumeClaimsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, pvc: PVCWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<HardDrive class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{pvc.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={pvc.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = pvc.namespace;
								fetchPVCs();
							}}
						/>
					{:else if column.id === 'status'}
						<Badge class="{getStatusColor(pvc.status)} px-1.5 py-0 text-xs">
							{pvc.status}
						</Badge>
					{:else if column.id === 'volume'}
						<span class="truncate font-mono text-xs text-muted-foreground">
							{pvc.volume || '—'}
						</span>
					{:else if column.id === 'capacity'}
						<span class="text-xs font-medium">{pvc.capacity}</span>
					{:else if column.id === 'accessModes'}
						<div class="flex gap-1">
							{#each pvc.accessModes as mode}
								<Badge variant="secondary" class="px-1 py-0 text-[10px]">
									{formatAccessMode(mode)}
								</Badge>
							{/each}
						</div>
					{:else if column.id === 'storageClass'}
						<span class="truncate text-xs text-muted-foreground">
							{pvc.storageClass || '—'}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{pvc.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(pvc);
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
									openDetail(pvc);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={pvc.name}
								loading={deleting}
								onConfirm={() => handleDelete(pvc.name, pvc.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete PVC"
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
							<HardDrive class="size-6 text-muted-foreground" />
						</div>
						<h3 class="mb-1 font-semibold text-foreground">No PVCs found</h3>
						<p class="text-sm">
							{selectedNamespace === 'all'
								? 'This cluster has no persistent volume claims'
								: `No PVCs in namespace "${selectedNamespace}"`}
						</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading PVCs...
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
			<Dialog.Title>PVC Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedPVC}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedPVC.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedPVC.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(selectedPVC.status)} px-2 py-0.5 text-xs"
								>
									{selectedPVC.status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Capacity</p>
							<p class="mt-1 text-sm font-medium">{selectedPVC.capacity}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Volume</p>
							<p class="mt-1 font-mono text-sm">{selectedPVC.volume || '—'}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Storage Class</p>
							<p class="mt-1 text-sm">{selectedPVC.storageClass || '—'}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Volume Mode</p>
							<p class="mt-1 text-sm">{selectedPVC.volumeMode}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Access Modes</p>
							<div class="mt-1 flex gap-1">
								{#each selectedPVC.accessModes as mode}
									<Badge variant="secondary" class="px-1.5 py-0 text-xs">
										{formatAccessMode(mode)}
									</Badge>
								{/each}
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedPVC.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedPVC.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedPVC.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedPVC.labels) as [k, v]}
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
					{#if Object.keys(selectedPVC.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedPVC.annotations) as [k, v]}
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
