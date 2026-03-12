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
		Globe,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Lock,
		Unlock
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type Ingress,
		type IngressWithAge,
		formatHosts,
		formatAddresses,
		hasTls,
		formatPath
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, ingressColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allIngresses = $state<Ingress[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedIngress = $state<IngressWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Ingresses with age
	const ingressesWithAge = $derived.by((): IngressWithAge[] => {
		const currentTime = timeTicker.now;
		return allIngresses.map((ing) => ({
			...ing,
			age: calculateAgeWithTicker(ing.createdAt, currentTime)
		}));
	});

	// Filtered ingresses
	const filteredIngresses = $derived.by(() => {
		let result = ingressesWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((ing) => ing.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(ing) =>
					ing.name.toLowerCase().includes(query) ||
					ing.namespace.toLowerCase().includes(query) ||
					ing.hosts.some((h) => h.toLowerCase().includes(query)) ||
					(ing.ingressClass || '').toLowerCase().includes(query) ||
					ing.addresses.some((a) => a.toLowerCase().includes(query))
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof Ingress, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	let ingressWatch: ReturnType<typeof useResourceWatch<Ingress>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchIngresses();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (ingressWatch) ingressWatch.unsubscribe();

			ingressWatch = useResourceWatch<Ingress>({
				clusterId: activeCluster.id,
				resourceType: 'ingresses',
				namespace: ns,
				onAdded: (ing) => {
					allIngresses = arrayAdd(allIngresses, ing, (i) => `${i.namespace}/${i.name}`);
				},
				onModified: (ing) => {
					allIngresses = arrayModify(allIngresses, ing, (i) => `${i.namespace}/${i.name}`);
				},
				onDeleted: (ing) => {
					allIngresses = arrayDelete(allIngresses, ing, (i) => `${i.namespace}/${i.name}`);
				}
			});

			ingressWatch.subscribe();
		} else {
			allIngresses = [];
			namespaces = [];
			if (ingressWatch) {
				ingressWatch.unsubscribe();
				ingressWatch = null;
			}
		}
	});

	onDestroy(() => {
		ingressWatch?.unsubscribe();
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
			console.error('[Ingress] Failed to fetch namespaces:', err);
		}
	}

	async function fetchIngresses() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/ingresses?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.ingresses) {
				allIngresses = data.ingresses;
			} else {
				error = data.error || 'Failed to fetch ingresses';
				allIngresses = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch ingresses';
			allIngresses = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/ingresses/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete ingress');
			}
			toast.success(`Ingress "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete ingress: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(ing: IngressWithAge) {
		selectedIngress = ing;
		showDetailDialog = true;
	}

	function openYamlEditor(ing: IngressWithAge) {
		drawerResource = { resourceType: 'ingress', name: ing.name, namespace: ing.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchIngresses();
	}
</script>

<svelte:head>
	<title>Ingress - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Ingresses</h1>
			<span class="text-sm text-muted-foreground">
				{filteredIngresses.length} of {ingressesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchIngresses}
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
						fetchIngresses();
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
					placeholder="Search ingresses..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view ingresses</p>
			</div>
		</div>
	{:else if !loading && !error && allIngresses.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No ingresses found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no ingresses'
						: `No ingresses in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredIngresses}
				keyField="name"
				name={TableName.ingress}
				columns={ingressColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, ing: IngressWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Globe class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{ing.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={ing.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = ing.namespace;
								fetchIngresses();
							}}
						/>
					{:else if column.id === 'hosts'}
						<span
							class="truncate font-mono text-xs"
							title={ing.hosts.join(', ') || '*'}
						>
							{formatHosts(ing.hosts)}
						</span>
					{:else if column.id === 'addresses'}
						<span
							class="truncate font-mono text-xs"
							title={ing.addresses.join(', ') || 'None'}
						>
							{formatAddresses(ing.addresses)}
						</span>
					{:else if column.id === 'ingressClass'}
						<Badge variant="outline" class="px-1.5 py-0 text-xs">
							{ing.ingressClass || 'default'}
						</Badge>
					{:else if column.id === 'tls'}
						{#if hasTls(ing.tls)}
							<Lock class="size-3.5 text-green-600 dark:text-green-400" />
						{:else}
							<Unlock class="size-3.5 text-muted-foreground" />
						{/if}
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{ing.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(ing);
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
									openDetail(ing);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={ing.name}
								loading={deleting}
								onConfirm={() => handleDelete(ing.name, ing.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete ingress"
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
						<p>No ingresses found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading ingresses...
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
			<Dialog.Title>Ingress Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedIngress}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedIngress.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedIngress.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Ingress Class</p>
							<Badge variant="outline" class="mt-1 text-xs">
								{selectedIngress.ingressClass || 'default'}
							</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">TLS</p>
							<div class="mt-1 flex items-center gap-1.5">
								{#if hasTls(selectedIngress.tls)}
									<Lock class="size-3.5 text-green-600 dark:text-green-400" />
									<span class="text-sm text-green-600 dark:text-green-400">Enabled</span>
								{:else}
									<Unlock class="size-3.5 text-muted-foreground" />
									<span class="text-sm text-muted-foreground">Disabled</span>
								{/if}
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedIngress.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedIngress.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Hosts -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Hosts</h3>
					{#if selectedIngress.hosts.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each selectedIngress.hosts as host}
								<Badge variant="outline" class="font-mono text-xs">{host}</Badge>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">* (all hosts)</p>
					{/if}
				</div>

				<!-- Addresses -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Addresses</h3>
					{#if selectedIngress.addresses.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each selectedIngress.addresses as addr}
								<Badge variant="outline" class="font-mono text-xs">{addr}</Badge>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No addresses assigned</p>
					{/if}
				</div>

				<!-- Rules / Paths -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						Rules ({selectedIngress.paths.length})
					</h3>
					{#if selectedIngress.paths.length > 0}
						<div class="space-y-2">
							{#each selectedIngress.paths as p}
								<div class="rounded-md border bg-muted/40 p-3">
									<div class="flex items-center gap-2 text-xs">
										<Badge variant="outline" class="font-mono text-xs">
											{p.host === '*' ? '*' : p.host}
										</Badge>
										<span class="font-mono text-muted-foreground">{p.path}</span>
										<Badge variant="secondary" class="text-[10px]">{p.pathType}</Badge>
									</div>
									<div class="mt-1.5 text-xs text-muted-foreground">
										→ <span class="font-mono">{p.backend.service}:{p.backend.port}</span>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No rules defined</p>
					{/if}
				</div>

				<!-- TLS -->
				{#if hasTls(selectedIngress.tls)}
					<div>
						<h3 class="mb-3 text-sm font-semibold">TLS Certificates</h3>
						<div class="space-y-2">
							{#each selectedIngress.tls as tlsEntry}
								<div class="rounded-md border bg-muted/40 p-3">
									<div class="mb-1.5 flex flex-wrap gap-1.5">
										{#each tlsEntry.hosts as host}
											<Badge variant="outline" class="font-mono text-xs">{host}</Badge>
										{/each}
									</div>
									{#if tlsEntry.secretName}
										<p class="text-xs text-muted-foreground">
											Secret: <span class="font-mono">{tlsEntry.secretName}</span>
										</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedIngress.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedIngress.labels) as [k, v]}
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
					{#if Object.keys(selectedIngress.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedIngress.annotations) as [k, v]}
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
