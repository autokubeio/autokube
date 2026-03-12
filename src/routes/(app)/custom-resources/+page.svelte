<script lang="ts">
	import { page } from '$app/state';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Command from '$lib/components/ui/command';
	import * as Popover from '$lib/components/ui/popover';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import CodeEditor from '$lib/components/code-editor.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Blocks,
		Loader2,
		FileCode,
		Info,
		Trash2,
		Check,
		ChevronDown,
		Sun,
		Moon,
		X
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import type { ColumnConfig } from '$lib/components/data-table-view';
	import { toast } from 'svelte-sonner';
	import * as yaml from 'js-yaml';
	import { onDestroy, untrack } from 'svelte';

	// ── Types ─────────────────────────────────────────────────────────────────

	interface AdditionalPrinterColumn {
		name: string;
		jsonPath: string;
		type: string;
		description?: string;
	}

	interface CRDInfo {
		name: string;
		group: string;
		version: string;
		versions: string[];
		plural: string;
		singular: string;
		kind: string;
		scope: 'Namespaced' | 'Cluster';
		additionalPrinterColumns: AdditionalPrinterColumn[];
	}

	interface CRDResource {
		uid: string;
		name: string;
		namespace?: string;
		createdAt: string;
		labels: Record<string, string>;
		annotations: Record<string, string>;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		raw: Record<string, any>;
	}

	// ── State ─────────────────────────────────────────────────────────────────

	const activeCluster = $derived(clusterStore.active);
	// Stable primitive ID — prevents object-reference churn from re-triggering effects
	const activeClusterId = $derived(activeCluster?.id ?? null);

	// CRD list
	let allCrds = $state<CRDInfo[]>([]);
	let loadingCrds = $state(false);
	let crdsError = $state<string | null>(null);

	// CRD combobox
	let crdSelectorOpen = $state(false);
	let crdSearch = $state('');

	// Selected CRD via URL params
	const selectedGroup = $derived(page.url.searchParams.get('group') ?? '');
	const selectedVersion = $derived(page.url.searchParams.get('version') ?? '');
	const selectedPlural = $derived(page.url.searchParams.get('plural') ?? '');
	const selectedCrd = $derived(
		allCrds.find(
			(c) =>
				c.group === selectedGroup &&
				c.version === selectedVersion &&
				c.plural === selectedPlural
		) ?? null
	);
	const activeVersion = $derived(selectedCrd?.version ?? selectedVersion);
	// Boolean flag so the fetch effect triggers once CRDs load without tracking the full CRD object
	const hasCrdSelected = $derived(selectedCrd !== null);

	// Resources
	let allResources = $state<CRDResource[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Sort
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedResource = $state<CRDResource | null>(null);

	// YAML dialog
	let showYamlDialog = $state(false);
	let yamlResource = $state<CRDResource | null>(null);
	let editorTheme = $state<'dark' | 'light'>('dark');
	const yamlContent = $derived(
		yamlResource ? yaml.dump(yamlResource.raw, { indent: 2, lineWidth: 120 }) : ''
	);

	// Delete
	let deleting = $state(false);

	// Age ticker
	const timeTicker = createTimeTicker(10000);

	// ── Derived columns (dynamic from CRD printer columns) ────────────────────

	const tableColumns = $derived((): ColumnConfig[] => {
		const base: ColumnConfig[] = [
			{ id: 'name', label: 'Name', width: 240, minWidth: 150, grow: true, sortable: true }
		];
		if (selectedCrd?.scope === 'Namespaced') {
			base.push({ id: 'namespace', label: 'Namespace', width: 130, minWidth: 100, sortable: true });
		}
		for (const col of selectedCrd?.additionalPrinterColumns ?? []) {
			base.push({
				id: col.jsonPath,
				label: col.name,
				width: 160,
				minWidth: 80,
				sortable: true
			});
		}
		base.push({
			id: 'age',
			label: 'Age',
			width: 80,
			minWidth: 60,
			sortable: true,
			sortField: 'createdAt'
		});
		base.push({ id: 'actions', label: '', fixed: 'end', width: 100, resizable: false });
		return base;
	});

	// ── Derived table name per CRD (for per-CRD column preferences) ──────────

	const tableName = $derived(
		selectedCrd ? `crd_${selectedCrd.group}_${selectedCrd.plural}` : 'crd_none'
	);

	// ── Filtered + sorted resources ───────────────────────────────────────────

	const resourcesWithAge = $derived.by(() => {
		const now = timeTicker.now;
		return allResources.map((r) => ({
			...r,
			_age: calculateAgeWithTicker(r.createdAt, now)
		}));
	});

	const filteredResources = $derived.by(() => {
		let result = resourcesWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((r) => r.namespace === selectedNamespace);
		}

		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(r) =>
					r.name.toLowerCase().includes(q) || (r.namespace ?? '').toLowerCase().includes(q)
			);
		}

		if (sortState) {
			const field = sortState.field;
			result = [...result].sort((a, b) => {
				let va: string, vb: string;
				if (field === 'createdAt') {
					va = a.createdAt;
					vb = b.createdAt;
				} else if (field === 'name') {
					va = a.name;
					vb = b.name;
				} else if (field === 'namespace') {
					va = a.namespace ?? '';
					vb = b.namespace ?? '';
				} else {
					va = resolveJsonPath(a.raw, field);
					vb = resolveJsonPath(b.raw, field);
				}
				return sortState!.direction === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
			});
		}

		return result;
	});

	// ── CRD grouped list for combobox ─────────────────────────────────────────

	const crdGroups = $derived.by(() => {
		const filtered = crdSearch.trim()
			? allCrds.filter(
					(c) =>
						c.kind.toLowerCase().includes(crdSearch.toLowerCase()) ||
						c.group.toLowerCase().includes(crdSearch.toLowerCase()) ||
						c.plural.toLowerCase().includes(crdSearch.toLowerCase())
				)
			: allCrds;

		const map = new Map<string, CRDInfo[]>();
		for (const crd of filtered) {
			const g = crd.group || 'core';
			if (!map.has(g)) map.set(g, []);
			map.get(g)!.push(crd);
		}
		return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
	});

	// ── Helpers ───────────────────────────────────────────────────────────────

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function resolveJsonPath(obj: any, jsonPath: string): string {
		const path = jsonPath.startsWith('.') ? jsonPath.slice(1) : jsonPath;
		const parts = path.split('.');
		let current: unknown = obj;
		for (const part of parts) {
			if (!part) continue;
			const arrMatch = part.match(/^(\w+)\[(\d+)\]$/);
			if (arrMatch) {
				if (current == null || typeof current !== 'object') return '';
				current = (current as Record<string, unknown>)[arrMatch[1]];
				if (!Array.isArray(current)) return '';
				current = current[parseInt(arrMatch[2])];
			} else {
				if (current == null || typeof current !== 'object') return '';
				current = (current as Record<string, unknown>)[part];
			}
		}
		if (current === null || current === undefined) return '';
		if (typeof current === 'object') return JSON.stringify(current);
		return String(current);
	}

	// ── API ───────────────────────────────────────────────────────────────────

	async function loadCrds(clusterId: number) {
		loadingCrds = true;
		crdsError = null;
		try {
			const res = await fetch(`/api/custom-resources/${clusterId}`);
			if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to load CRDs');
			const data = await res.json();
			allCrds = data.crds ?? [];
		} catch (err) {
			crdsError = err instanceof Error ? err.message : 'Failed to load CRDs';
			console.error('[CustomResources] Load CRDs error:', err);
		} finally {
			loadingCrds = false;
		}
	}

	async function fetchResources() {
		if (!activeCluster || !selectedCrd) return;
		loading = true;
		error = null;
		try {
			const params = new URLSearchParams({
				group: selectedCrd.group,
				version: activeVersion,
				plural: selectedCrd.plural
			});
			if (selectedNamespace && selectedNamespace !== 'all')
				params.set('namespace', selectedNamespace);

			const res = await fetch(
				`/api/custom-resources/${activeCluster.id}/resources?${params}`
			);
			if (!res.ok) throw new Error((await res.json()).message ?? 'Failed to load resources');
			const data = await res.json();
			allResources = data.items ?? [];

			// Derive namespaces from loaded resources
			const ns = [...new Set(allResources.map((r) => r.namespace).filter(Boolean) as string[])].sort();
			namespaces = ns;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load resources';
			allResources = [];
			console.error('[CustomResources] Fetch resources error:', err);
		} finally {
			loading = false;
		}
	}

	async function handleDelete(resource: CRDResource) {
		if (!activeCluster || !selectedCrd) return;
		deleting = true;
		try {
			const params = new URLSearchParams({
				group: selectedCrd.group,
				version: activeVersion,
				plural: selectedCrd.plural,
				name: resource.name
			});
			if (resource.namespace) params.set('namespace', resource.namespace);

			const res = await fetch(
				`/api/custom-resources/${activeCluster.id}/resources?${params}`,
				{ method: 'DELETE' }
			);
			if (!res.ok) throw new Error((await res.json()).message ?? 'Delete failed');

			allResources = allResources.filter((r) => r.uid !== resource.uid);
			toast.success(`Deleted ${selectedCrd.kind}/${resource.name}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Delete failed');
			console.error('[CustomResources] Delete error:', err);
		} finally {
			deleting = false;
		}
	}

	function selectCrd(crd: CRDInfo) {
		crdSelectorOpen = false;
		crdSearch = '';
		allResources = [];
		searchQuery = '';
		selectedNamespace = 'all';
		const params = new URLSearchParams({
			group: crd.group,
			version: crd.version,
			plural: crd.plural
		});
		goto(`?${params}`, { replaceState: false, noScroll: true });
	}

	function openDetail(resource: CRDResource) {
		selectedResource = resource;
		showDetailDialog = true;
	}

	// ── Effects ───────────────────────────────────────────────────────────────

	// Use primitive cluster ID so object-reference refreshes from the store
	// (e.g. background polling updating the cluster object) do NOT re-trigger.
	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId !== null) {
			untrack(() => loadCrds(clusterId));
		} else {
			allCrds = [];
			allResources = [];
		}
	});

	// Use stable URL-param strings + cluster ID as deps so only real navigation
	// changes (different CRD selected, different cluster) trigger a re-fetch.
	// hasCrdSelected fires when CRDs finish loading on initial page open with URL params.
	// untrack() prevents internal reads inside fetchResources from adding more deps.
	$effect(() => {
		const clusterId = activeClusterId;
		const group = selectedGroup;
		const version = selectedVersion;
		const plural = selectedPlural;
		const crdReady = hasCrdSelected;

		if (clusterId !== null && group && plural && crdReady) {
			untrack(() => fetchResources());
		} else {
			allResources = [];
		}
	});

	$effect(() => {
		if (crdSelectorOpen && selectedCrd) {
			setTimeout(() => {
				const el = document.querySelector<HTMLElement>('[data-selected-crd="true"]');
				if (!el) return;
				const list = el.closest('[data-cmdk-list]') as HTMLElement | null;
				if (list) {
					const elTop = el.offsetTop;
					const elBottom = elTop + el.offsetHeight;
					const listTop = list.scrollTop;
					const listBottom = listTop + list.clientHeight;
					if (elTop < listTop || elBottom > listBottom) {
						list.scrollTop = elTop - list.clientHeight / 2 + el.offsetHeight / 2;
					}
				} else {
					el.scrollIntoView({ block: 'nearest' });
				}
			}, 60);
		}
	});

	onDestroy(() => timeTicker.stop());
</script>

<svelte:head>
	<title>Custom Resources - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2 flex-wrap">
			<!-- Title + CRD Selector -->
			<Popover.Root bind:open={crdSelectorOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="flex items-center gap-1.5 group"
							disabled={loadingCrds || !activeCluster}
						>
							<h1 class="text-2xl font-bold">
								{selectedCrd ? selectedCrd.kind : 'Custom Resources'}
							</h1>
							{#if activeCluster}
								<ChevronDown
									class="size-5 mt-0.5 text-muted-foreground group-hover:text-foreground transition-colors"
								/>
							{/if}
						</button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content class="w-80 p-0" align="start">
					<Command.Root>
						<Command.Input placeholder="Search kind, group…" bind:value={crdSearch} />
						<Command.List class="max-h-72 overflow-y-auto">
							{#if loadingCrds}
								<Command.Empty>
									<span class="flex items-center gap-2 text-muted-foreground">
										<Loader2 class="size-4 animate-spin" />Loading…
									</span>
								</Command.Empty>
							{:else if allCrds.length === 0}
								<Command.Empty>No CRDs found</Command.Empty>
							{:else}
								{#each crdGroups as [group, crds]}
									<Command.Group heading={group}>
										{#each crds as crd (crd.name)}
											<Command.Item
												value={crd.name}
												onSelect={() => selectCrd(crd)}
												class="flex items-center gap-2 cursor-pointer"
												data-selected-crd={selectedCrd?.name === crd.name ? 'true' : undefined}
											>
												<Check
													class={cn(
														'size-4 shrink-0',
														selectedCrd?.name === crd.name ? 'opacity-100' : 'opacity-0'
													)}
												/>
												<span class="flex-1 min-w-0">
													<span class="font-medium">{crd.kind}</span>
													<span class="ml-1.5 text-xs text-muted-foreground">{crd.plural}</span>
												</span>
												<Badge variant="outline" class="text-[10px] shrink-0">
													{crd.scope === 'Cluster' ? 'Cluster' : 'NS'}
												</Badge>
											</Command.Item>
										{/each}
									</Command.Group>
								{/each}
							{/if}
						</Command.List>
					</Command.Root>
				</Popover.Content>
			</Popover.Root>

			{#if selectedCrd}
				<span class="text-sm text-muted-foreground">
					{filteredResources.length} of {allResources.length}
				</span>
			{/if}

			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster || !selectedCrd}
				onclick={fetchResources}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>

		<div class="flex items-center gap-2">
			<!-- Version selector -->
			{#if selectedCrd && (selectedCrd.versions?.length ?? 0) > 1}
				<Select.Root
					type="single"
					value={activeVersion}
					onValueChange={(v: string) => {
						if (!selectedCrd) return;
						const params = new URLSearchParams({
							group: selectedCrd.group,
							version: v,
							plural: selectedCrd.plural
						});
						goto(`?${params}`, { replaceState: true, noScroll: true });
					}}
				>
					<Select.Trigger class="h-8 w-24 text-xs">
						{activeVersion}
					</Select.Trigger>
					<Select.Content>
						{#each selectedCrd.versions as v (v)}
							<Select.Item value={v}>{v}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- Namespace selector -->
			{#if selectedCrd?.scope === 'Namespaced'}
				<Select.Root
					type="single"
					value={selectedNamespace}
					onValueChange={(v: string) => {
						if (v) {
							selectedNamespace = v;
							fetchResources();
						}
					}}
				>
					<Select.Trigger class="h-8 flex-1 text-xs sm:w-44">
						{selectedNamespace === 'all' ? 'All namespaces' : selectedNamespace}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="all">All namespaces</Select.Item>
						{#each namespaces as ns (ns)}
							<Select.Item value={ns}>{ns}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- Search -->
			{#if selectedCrd}
				<div class="relative flex-1 sm:flex-none">
					<Search
						class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						placeholder="Search {selectedCrd.kind}…"
						class="h-8 w-full pl-8 text-xs sm:w-56"
						bind:value={searchQuery}
					/>
				</div>
			{/if}
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

	<!-- Empty / loading states -->
	{#if !activeCluster}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No cluster selected</h3>
				<p class="text-sm text-muted-foreground">Select a cluster to browse custom resources</p>
			</div>
		</div>
	{:else if crdsError}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<AlertCircle class="size-8 text-destructive" />
			<p class="text-sm text-destructive">{crdsError}</p>
			<Button variant="outline" size="sm" onclick={() => loadCrds(activeCluster!.id)}>
				Retry
			</Button>
		</div>
	{:else if !selectedCrd}
		<!-- CRD browser grid -->
		{#if loadingCrds}
			<div class="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
				<Loader2 class="size-5 animate-spin" />
				<span>Loading custom resource definitions…</span>
			</div>
		{:else if allCrds.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
				<div class="flex size-12 items-center justify-center rounded-full bg-muted">
					<Blocks class="size-6 text-muted-foreground" />
				</div>
				<div>
					<h3 class="mb-1 font-semibold">No CRDs found</h3>
					<p class="text-sm text-muted-foreground">This cluster has no custom resource definitions</p>
				</div>
			</div>
		{:else}
			<!-- CRD cards grouped by API group -->
			<div class="overflow-y-auto space-y-6 pr-1">
				{#each crdGroups as [group, crds]}
					<section>
						<h3
							class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1"
						>
							{group}
							<span class="ml-1 font-normal normal-case">({crds.length})</span>
						</h3>
						<div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
							{#each crds as crd (crd.name)}
								<button
									type="button"
									onclick={() => selectCrd(crd)}
									class="flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left hover:bg-accent hover:border-accent-foreground/20 transition-colors"
								>
									<div class="flex items-center gap-1.5 w-full">
										<Blocks class="size-4 text-primary shrink-0" />
										<span class="font-medium text-sm truncate">{crd.kind}</span>
										<Badge
											variant="outline"
											class="ml-auto text-[10px] shrink-0 border-dashed"
										>
											{crd.scope === 'Cluster' ? 'Cluster' : 'NS'}
										</Badge>
									</div>
									<span class="text-xs text-muted-foreground truncate w-full">{crd.plural}</span>
									<span class="text-[10px] text-muted-foreground/70 truncate w-full">{crd.version}</span>
								</button>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	{:else}
		<!-- Resource DataTable -->
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredResources}
				keyField="uid"
				name={tableName}
				columns={tableColumns()}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, resource)}
					{@const res = resource as CRDResource & { _age: string }}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Blocks class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{res.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={res.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = res.namespace ?? 'all';
								fetchResources();
							}}
						/>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{res._age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e: MouseEvent) => {
									e.stopPropagation();
									yamlResource = res;
									showYamlDialog = true;
								}}
								title="View YAML"
							>
								<FileCode class="h-3.5 w-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e: MouseEvent) => {
									e.stopPropagation();
									openDetail(res);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={res.name}
								loading={deleting}
								onConfirm={() => handleDelete(res)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{:else}
						{@const val = resolveJsonPath(res.raw, column.id)}
						{#if selectedCrd?.additionalPrinterColumns.find((c) => c.jsonPath === column.id)?.type === 'boolean'}
							<Badge variant={val === 'true' ? 'default' : 'secondary'} class="text-[10px]">
								{val || 'false'}
							</Badge>
						{:else}
							<span class="text-xs text-muted-foreground truncate" title={val}>{val || '—'}</span>
						{/if}
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Blocks class="mb-3 h-10 w-10 opacity-40" />
						<p>No {selectedCrd?.kind ?? 'resources'} found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading {selectedCrd?.kind ?? 'resources'}…
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
			<Dialog.Title>{selectedCrd?.kind ?? 'Resource'} Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedResource}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedResource.name}</p>
						</div>
						{#if selectedResource.namespace}
							<div>
								<p class="text-sm font-medium text-muted-foreground">Namespace</p>
								<Badge variant="outline" class="mt-1 text-xs">{selectedResource.namespace}</Badge>
							</div>
						{/if}
						<div>
							<p class="text-sm font-medium text-muted-foreground">Kind</p>
							<p class="mt-1 text-sm">{selectedCrd?.kind}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">API Group</p>
							<p class="mt-1 font-mono text-xs">{selectedCrd?.group}/{activeVersion}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">UID</p>
							<p class="mt-1 font-mono text-xs truncate">{selectedResource.uid}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">{formatCreatedAt(selectedResource.createdAt)}</p>
						</div>
					</div>
				</div>

				<!-- Additional fields from printer columns -->
				{#if (selectedCrd?.additionalPrinterColumns.length ?? 0) > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Status</h3>
						<div class="grid grid-cols-2 gap-4">
							{#each selectedCrd?.additionalPrinterColumns ?? [] as col}
								{@const val = resolveJsonPath(selectedResource.raw, col.jsonPath)}
								<div>
									<p class="text-sm font-medium text-muted-foreground">{col.name}</p>
									<p class="mt-1 font-mono text-sm">{val || '—'}</p>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedResource.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedResource.labels) as [k, v]}
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
					{#if Object.keys(selectedResource.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedResource.annotations) as [k, v]}
								{@const parsed = tryPrettyJson(v)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<p class="mb-1 font-mono text-[11px] break-all text-muted-foreground">{k}</p>
									{#if parsed.pretty}
										<pre class="overflow-x-auto font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap">{parsed.text}</pre>
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

<!-- YAML Dialog -->
<Dialog.Root
	bind:open={showYamlDialog}
	onOpenChange={(open) => { if (!open) { yamlResource = null; editorTheme = 'dark'; } }}
>
	<Dialog.Content class="max-w-5xl h-[85vh] flex flex-col p-0" showCloseButton={false}>
		<Dialog.Header class="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="p-1.5 rounded-md bg-zinc-200 dark:bg-zinc-700">
						<FileCode class="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
					</div>
					<div>
						<Dialog.Title class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
							View {selectedCrd?.kind ?? 'Resource'} YAML
						</Dialog.Title>
						<Dialog.Description class="text-xs text-zinc-500 dark:text-zinc-400">
							{#if yamlResource?.namespace}
								{yamlResource.namespace}/{yamlResource.name}
							{:else}
								{yamlResource?.name ?? ''}
							{/if}
						</Dialog.Description>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => (editorTheme = editorTheme === 'light' ? 'dark' : 'light')}
						tabindex="-1"
						class="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
						title={editorTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
					>
						{#if editorTheme === 'light'}
							<Moon class="w-4 h-4" />
						{:else}
							<Sun class="w-4 h-4" />
						{/if}
					</button>
					<button
						type="button"
						onclick={() => (showYamlDialog = false)}
						tabindex="-1"
						class="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
					>
						<X class="w-4 h-4" />
					</button>
				</div>
			</div>
		</Dialog.Header>
		<div class="flex-1 min-h-0 overflow-hidden px-6 py-4">
			<CodeEditor
				value={yamlContent}
				language="yaml"
				theme={editorTheme}
				readonly={true}
				class="h-full rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700"
			/>
		</div>
	</Dialog.Content>
</Dialog.Root>
