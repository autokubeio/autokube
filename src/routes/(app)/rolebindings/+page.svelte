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
		Link,
		Info,
		Trash2,
		Loader2,
		FileCode
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import { type RoleBinding, type RoleBindingWithAge, formatSubjects } from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, roleBindingsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allRoleBindings = $state<RoleBinding[]>([]);
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
	let selectedRoleBinding = $state<RoleBindingWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// RoleBindings with age
	const roleBindingsWithAge = $derived.by((): RoleBindingWithAge[] => {
		const currentTime = timeTicker.now;
		return allRoleBindings.map((rb) => ({
			...rb,
			age: calculateAgeWithTicker(rb.createdAt, currentTime)
		}));
	});

	// Filtered
	const filteredRoleBindings = $derived.by(() => {
		let result = roleBindingsWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((rb) => rb.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(rb) =>
					rb.name.toLowerCase().includes(query) ||
					rb.namespace.toLowerCase().includes(query) ||
					(rb.roleRef.name ?? '').toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof RoleBinding, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let rbWatch: ReturnType<typeof useBatchWatch<RoleBinding>> | null = null;

	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchNamespaces(clusterId);
			fetchRoleBindings(clusterId, selectedNamespace);

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (rbWatch) rbWatch.unsubscribe();

			rbWatch = useBatchWatch<RoleBinding>({


				clusterId,


				resourceType: 'rolebindings',


				namespace: ns,


				getItems: () => allRoleBindings,


				setItems: (v) => { allRoleBindings = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			rbWatch.subscribe();
		} else {
			allRoleBindings = [];
			namespaces = [];
			if (rbWatch) {
				rbWatch.unsubscribe();
				rbWatch = null;
			}
		}
	});

	onDestroy(() => {
		rbWatch?.unsubscribe();
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
			console.error('[RoleBindings] Failed to fetch namespaces:', err);
		}
	}

	async function fetchRoleBindings(clusterId: number, nsParam: string) {
		loading = true;
		error = null;

		try {
			const ns = nsParam === 'all' ? 'all' : nsParam;
			const res = await fetch(`/api/clusters/${clusterId}/rolebindings?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.roleBindings) {
				allRoleBindings = data.roleBindings;
			} else {
				error = data.error || 'Failed to fetch role bindings';
				allRoleBindings = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch role bindings';
			allRoleBindings = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/rolebindings/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete role binding');
			}
			toast.success(`RoleBinding "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete role binding: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(rb: RoleBindingWithAge) {
		selectedRoleBinding = rb;
		showDetailDialog = true;
	}

	function openYamlEditor(rb: RoleBindingWithAge) {
		drawerResource = { resourceType: 'rolebinding', name: rb.name, namespace: rb.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchRoleBindings(activeClusterId, selectedNamespace);
	}
</script>

<svelte:head>
	<title>Role Bindings - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Role Bindings</h1>
			<span class="text-sm text-muted-foreground">
				{filteredRoleBindings.length} of {roleBindingsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchRoleBindings(activeClusterId, selectedNamespace); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns: string) => { selectedNamespace = ns; if (activeClusterId) fetchRoleBindings(activeClusterId, ns); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search role bindings..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view role bindings</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredRoleBindings}
				keyField="id"
				name={TableName.rolebindings}
				columns={roleBindingsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, rb: RoleBindingWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Link class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{rb.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={rb.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = rb.namespace;
								if (activeClusterId) fetchRoleBindings(activeClusterId, rb.namespace);
							}}
						/>
					{:else if column.id === 'role'}
						<span class="truncate font-mono text-xs">{rb.roleRef.name ?? '—'}</span>
					{:else if column.id === 'roleKind'}
						<Badge variant="secondary" class="px-1.5 py-0 text-xs">
							{rb.roleRef.kind ?? '—'}
						</Badge>
					{:else if column.id === 'subjects'}
						<span class="text-xs font-medium">{rb.subjects.length}</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{rb.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(rb);
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
									openDetail(rb);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={rb.name}
								loading={deleting}
								onConfirm={() => handleDelete(rb.name, rb.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete role binding"
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
							<Link class="size-6 text-muted-foreground" />
						</div>
						<h3 class="mb-1 font-semibold text-foreground">No role bindings found</h3>
						<p class="text-sm">
							{selectedNamespace === 'all'
								? 'This cluster has no role bindings'
								: `No role bindings in namespace "${selectedNamespace}"`}
						</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading role bindings...
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
			<Dialog.Title>RoleBinding Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedRoleBinding}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedRoleBinding.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs"
								>{selectedRoleBinding.namespace}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Subjects</p>
							<p class="mt-1 text-sm font-medium">{selectedRoleBinding.subjects.length}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedRoleBinding.age}</p>
						</div>
						<div class="col-span-2">
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedRoleBinding.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Role Reference -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Role Reference</h3>
					<div class="rounded-md border bg-muted/40 px-3 py-2">
						<div class="grid grid-cols-3 gap-2 text-xs">
							<div>
								<span class="font-medium text-muted-foreground">Kind</span>
								<p class="mt-0.5 font-mono">{selectedRoleBinding.roleRef.kind ?? '—'}</p>
							</div>
							<div>
								<span class="font-medium text-muted-foreground">Name</span>
								<p class="mt-0.5 font-mono">{selectedRoleBinding.roleRef.name ?? '—'}</p>
							</div>
							<div>
								<span class="font-medium text-muted-foreground">API Group</span>
								<p class="mt-0.5 font-mono">
									{selectedRoleBinding.roleRef.apiGroup ?? '—'}
								</p>
							</div>
						</div>
					</div>
				</div>

				<!-- Subjects -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Subjects</h3>
					{#if selectedRoleBinding.subjects.length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto">
							{#each selectedRoleBinding.subjects as subject}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<div class="grid grid-cols-3 gap-2 text-xs">
										<div>
											<span class="font-medium text-muted-foreground">Kind</span>
											<p class="mt-0.5 font-mono">{subject.kind ?? '—'}</p>
										</div>
										<div>
											<span class="font-medium text-muted-foreground">Name</span>
											<p class="mt-0.5 font-mono">{subject.name ?? '—'}</p>
										</div>
										<div>
											<span class="font-medium text-muted-foreground">Namespace</span>
											<p class="mt-0.5 font-mono">{subject.namespace ?? '—'}</p>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No subjects</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedRoleBinding.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedRoleBinding.labels) as [k, v]}
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
					{#if Object.keys(selectedRoleBinding.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedRoleBinding.annotations) as [k, v]}
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
