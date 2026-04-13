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
		Shield,
		Info,
		Trash2,
		Loader2,
		FileCode,
		ArrowDownToLine,
		ArrowUpFromLine
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type NetworkPolicy,
		type NetworkPolicyWithAge,
		formatPolicyTypes,
		formatPodSelector
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, networkPoliciesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	let allPolicies = $state<NetworkPolicy[]>([]);
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
	let selectedPolicy = $state<NetworkPolicyWithAge | null>(null);
	let deleting = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Policies with age
	const policiesWithAge = $derived.by((): NetworkPolicyWithAge[] => {
		const currentTime = timeTicker.now;
		return allPolicies.map((p) => ({
			...p,
			age: calculateAgeWithTicker(p.createdAt, currentTime)
		}));
	});

	// Filtered policies
	const filteredPolicies = $derived.by(() => {
		let result = policiesWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((p) => p.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(p) =>
					p.name.toLowerCase().includes(query) ||
					p.namespace.toLowerCase().includes(query) ||
					formatPolicyTypes(p.policyTypes).toLowerCase().includes(query) ||
					formatPodSelector(p.podSelector).toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof NetworkPolicy, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime()
			});
		}

		return result;
	});

	// SSE watch
	let policiesWatch: ReturnType<typeof useBatchWatch<NetworkPolicy>> | null = null;

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchPolicies();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (policiesWatch) policiesWatch.unsubscribe();

			policiesWatch = useBatchWatch<NetworkPolicy>({


				clusterId: activeCluster.id,


				resourceType: 'networkpolicies',


				namespace: ns,


				getItems: () => allPolicies,


				setItems: (v) => { allPolicies = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			policiesWatch.subscribe();
		} else {
			allPolicies = [];
			namespaces = [];
			if (policiesWatch) {
				policiesWatch.unsubscribe();
				policiesWatch = null;
			}
		}
	});

	onDestroy(() => {
		policiesWatch?.unsubscribe();
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
			console.error('[NetworkPolicies] Failed to fetch namespaces:', err);
		}
	}

	async function fetchPolicies() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/networkpolicies?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.networkPolicies) {
				allPolicies = data.networkPolicies;
			} else {
				error = data.error || 'Failed to fetch network policies';
				allPolicies = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch network policies';
			allPolicies = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/networkpolicies/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete network policy');
			}
			toast.success(`Network policy "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete network policy: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(policy: NetworkPolicyWithAge) {
		selectedPolicy = policy;
		showDetailDialog = true;
	}

	function openYamlEditor(policy: NetworkPolicyWithAge) {
		drawerResource = { resourceType: 'networkpolicy', name: policy.name, namespace: policy.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		fetchPolicies();
	}
</script>

<svelte:head>
	<title>Network Policies - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Network Policies</h1>
			<span class="text-sm text-muted-foreground">
				{filteredPolicies.length} of {policiesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchPolicies}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns) => { selectedNamespace = ns; fetchPolicies(); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search network policies..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view network policies</p>
			</div>
		</div>
	{:else if !loading && !error && allPolicies.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Shield class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No network policies found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no network policies'
						: `No network policies in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredPolicies}
				keyField="name"
				name={TableName.networkpolicies}
				columns={networkPoliciesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, policy: NetworkPolicyWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Shield class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{policy.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={policy.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = policy.namespace;
								fetchPolicies();
							}}
						/>
					{:else if column.id === 'policyTypes'}
						<div class="flex items-center gap-1">
							{#each policy.policyTypes as pType}
								<Badge variant="secondary" class="px-1.5 py-0 text-xs">
									{#if pType === 'Ingress'}
										<ArrowDownToLine class="mr-0.5 size-3" />
									{:else if pType === 'Egress'}
										<ArrowUpFromLine class="mr-0.5 size-3" />
									{/if}
									{pType}
								</Badge>
							{/each}
							{#if policy.policyTypes.length === 0}
								<span class="text-xs text-muted-foreground">None</span>
							{/if}
						</div>
					{:else if column.id === 'ingressRules'}
						<span class="text-xs">
							{policy.ingress.length} rule{policy.ingress.length !== 1 ? 's' : ''}
						</span>
					{:else if column.id === 'egressRules'}
						<span class="text-xs">
							{policy.egress.length} rule{policy.egress.length !== 1 ? 's' : ''}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{policy.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(policy);
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
									openDetail(policy);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={policy.name}
								loading={deleting}
								onConfirm={() => handleDelete(policy.name, policy.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete network policy"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Shield class="mb-3 h-10 w-10 opacity-40" />
						<p>No network policies found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading network policies...
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
			<Dialog.Title>Network Policy Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedPolicy}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedPolicy.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedPolicy.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Policy Types</p>
							<div class="mt-1 flex gap-1">
								{#each selectedPolicy.policyTypes as pType}
									<Badge variant="secondary" class="text-xs">{pType}</Badge>
								{/each}
								{#if selectedPolicy.policyTypes.length === 0}
									<span class="text-sm text-muted-foreground">None</span>
								{/if}
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Pod Selector</p>
							<p class="mt-1 font-mono text-sm">{formatPodSelector(selectedPolicy.podSelector)}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedPolicy.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedPolicy.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Ingress Rules -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						<span class="flex items-center gap-1.5">
							<ArrowDownToLine class="size-4" />
							Ingress Rules ({selectedPolicy.ingress.length})
						</span>
					</h3>
					{#if selectedPolicy.ingress.length > 0}
						<div class="space-y-2">
							{#each selectedPolicy.ingress as rule, idx}
								<div class="rounded-md border bg-muted/40 p-3">
									<p class="mb-2 text-xs font-medium text-muted-foreground">Rule {idx + 1}</p>
									{#if rule.from && Array.isArray(rule.from)}
										<div class="mb-2">
											<p class="text-xs font-medium text-muted-foreground">From:</p>
											{#each rule.from as source}
												<div class="mt-1 rounded border bg-background p-2">
													{#if source.podSelector}
														<p class="font-mono text-xs">Pod Selector: {JSON.stringify(source.podSelector.matchLabels || source.podSelector)}</p>
													{/if}
													{#if source.namespaceSelector}
														<p class="font-mono text-xs">Namespace Selector: {JSON.stringify(source.namespaceSelector.matchLabels || source.namespaceSelector)}</p>
													{/if}
													{#if source.ipBlock}
														<p class="font-mono text-xs">IP Block: {source.ipBlock.cidr}{source.ipBlock.except ? ` except ${source.ipBlock.except.join(', ')}` : ''}</p>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
									{#if rule.ports && Array.isArray(rule.ports)}
										<div>
											<p class="text-xs font-medium text-muted-foreground">Ports:</p>
											<div class="mt-1 flex flex-wrap gap-1">
												{#each rule.ports as port}
													<Badge variant="outline" class="font-mono text-xs">
														{port.protocol || 'TCP'}/{port.port || '*'}
													</Badge>
												{/each}
											</div>
										</div>
									{/if}
									{#if !rule.from && !rule.ports}
										<p class="text-xs text-muted-foreground">Allow all ingress</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No ingress rules (all ingress denied if Ingress policy type is set)</p>
					{/if}
				</div>

				<!-- Egress Rules -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">
						<span class="flex items-center gap-1.5">
							<ArrowUpFromLine class="size-4" />
							Egress Rules ({selectedPolicy.egress.length})
						</span>
					</h3>
					{#if selectedPolicy.egress.length > 0}
						<div class="space-y-2">
							{#each selectedPolicy.egress as rule, idx}
								<div class="rounded-md border bg-muted/40 p-3">
									<p class="mb-2 text-xs font-medium text-muted-foreground">Rule {idx + 1}</p>
									{#if rule.to && Array.isArray(rule.to)}
										<div class="mb-2">
											<p class="text-xs font-medium text-muted-foreground">To:</p>
											{#each rule.to as dest}
												<div class="mt-1 rounded border bg-background p-2">
													{#if dest.podSelector}
														<p class="font-mono text-xs">Pod Selector: {JSON.stringify(dest.podSelector.matchLabels || dest.podSelector)}</p>
													{/if}
													{#if dest.namespaceSelector}
														<p class="font-mono text-xs">Namespace Selector: {JSON.stringify(dest.namespaceSelector.matchLabels || dest.namespaceSelector)}</p>
													{/if}
													{#if dest.ipBlock}
														<p class="font-mono text-xs">IP Block: {dest.ipBlock.cidr}{dest.ipBlock.except ? ` except ${dest.ipBlock.except.join(', ')}` : ''}</p>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
									{#if rule.ports && Array.isArray(rule.ports)}
										<div>
											<p class="text-xs font-medium text-muted-foreground">Ports:</p>
											<div class="mt-1 flex flex-wrap gap-1">
												{#each rule.ports as port}
													<Badge variant="outline" class="font-mono text-xs">
														{port.protocol || 'TCP'}/{port.port || '*'}
													</Badge>
												{/each}
											</div>
										</div>
									{/if}
									{#if !rule.to && !rule.ports}
										<p class="text-xs text-muted-foreground">Allow all egress</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No egress rules (all egress denied if Egress policy type is set)</p>
					{/if}
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedPolicy.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedPolicy.labels) as [k, v]}
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
					{#if Object.keys(selectedPolicy.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedPolicy.annotations) as [k, v]}
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
