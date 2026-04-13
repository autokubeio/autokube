<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import NamespaceSelect from '$lib/components/namespace-select.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { cn } from '$lib/utils';
	import { formatCreatedAt } from '$lib/utils/formatters';
	import { arraySort } from '$lib/utils/arrays';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import {
		RefreshCw,
		Search,
		AlertCircle,
		Package,
		Info,
		Trash2,
		Loader2
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { onDestroy } from 'svelte';
	import {
		type HelmRelease,
		type HelmReleaseWithAge,
		getStatusColor,
		getStatusIcon
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, helmReleasesColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';

	const activeCluster = $derived(clusterStore.active);
	let allReleases = $state<HelmRelease[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');
	let selectedStatus = $state('all');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedRelease = $state<HelmReleaseWithAge | null>(null);
	let deleting = $state(false);

	// Time ticker for age calculations
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Releases with age
	const releasesWithAge = $derived.by((): HelmReleaseWithAge[] => {
		const currentTime = timeTicker.now;
		return allReleases.map((r) => ({
			...r,
			age: calculateAgeWithTicker(r.updatedAt || r.createdAt, currentTime)
		}));
	});

	// Filtered releases
	const filteredReleases = $derived.by(() => {
		let result = releasesWithAge;

		if (selectedNamespace !== 'all') {
			result = result.filter((r) => r.namespace === selectedNamespace);
		}

		if (selectedStatus !== 'all') {
			result = result.filter((r) => r.status === selectedStatus);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(r) =>
					r.name.toLowerCase().includes(query) ||
					r.namespace.toLowerCase().includes(query) ||
					r.chart.toLowerCase().includes(query) ||
					r.chartVersion.toLowerCase().includes(query) ||
					r.appVersion.toLowerCase().includes(query) ||
					r.status.toLowerCase().includes(query)
			);
		}

		if (sortState) {
			result = arraySort(result, sortState.field as keyof HelmRelease, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				updatedAt: (val: string) => new Date(val).getTime(),
				revision: (val: number) => Number(val)
			});
		}

		return result;
	});

	// Fetch on cluster change
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchReleases();
		} else {
			allReleases = [];
			namespaces = [];
		}
	});

	onDestroy(() => {
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
			console.error('[HelmReleases] Failed to fetch namespaces:', err);
		}
	}

	async function fetchReleases() {
		if (!activeCluster?.id) return;
		loading = true;
		error = null;
		try {
			const nsParam = selectedNamespace !== 'all' ? `&namespace=${selectedNamespace}` : '';
			const res = await fetch(`/api/helm-releases?cluster=${activeCluster.id}${nsParam}`);
			const data = await res.json();
			if (data.success) {
				allReleases = data.releases ?? [];
			} else {
				error = data.error ?? 'Failed to fetch Helm releases';
				allReleases = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch Helm releases';
			allReleases = [];
		} finally {
			loading = false;
		}
	}

	async function deleteRelease(release: HelmRelease) {
		if (!activeCluster?.id) return;
		deleting = true;
		try {
			const res = await fetch(
				`/api/helm-releases/delete?cluster=${activeCluster.id}&name=${encodeURIComponent(release.name)}&namespace=${encodeURIComponent(release.namespace)}`,
				{ method: 'DELETE' }
			);
			const data = await res.json();
			if (data.success) {
				toast.success(`Helm release "${release.name}" uninstalled successfully`);
				allReleases = allReleases.filter(
					(r) => !(r.name === release.name && r.namespace === release.namespace)
				);
				showDetailDialog = false;
			} else {
				toast.error(data.error ?? 'Failed to uninstall release');
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to uninstall release');
		} finally {
			deleting = false;
		}
	}

	function openDetail(release: HelmReleaseWithAge) {
		selectedRelease = release;
		showDetailDialog = true;
	}

	// Available statuses for the filter dropdown
	const availableStatuses = $derived(
		Array.from(new Set(allReleases.map((r) => r.status))).sort()
	);
</script>

<svelte:head>
	<title>Helm Releases - AutoKube</title>
</svelte:head>

<!-- ── Header ────────────────────────────────────────────────────────────── -->
<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Helm Releases</h1>
			<span class="text-sm text-muted-foreground">
				{filteredReleases.length} of {releasesWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchReleases}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<!-- Status filter -->
			{#if availableStatuses.length > 1}
				<Select.Root type="single" value={selectedStatus} onValueChange={(v: string) => { if (v) selectedStatus = v; }}>
					<Select.Trigger class="h-8 text-xs sm:w-36">
						{selectedStatus === 'all' ? 'All statuses' : selectedStatus}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="all">All statuses</Select.Item>
						{#each availableStatuses as s}
							<Select.Item value={s}>{s}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- Namespace filter -->
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns) => { selectedNamespace = ns; fetchReleases(); }}
			/>

			<!-- Search -->
			<div class="relative flex-1 sm:flex-none">
				<Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					placeholder="Search releases..."
					bind:value={searchQuery}
					class="h-8 w-full pl-8 text-xs sm:w-56"
				/>
			</div>
		</div>
	</div>

	<!-- Error -->
	{#if error}
		<div class="mb-4 flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
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
				<p class="text-sm text-muted-foreground">Select a cluster to view Helm releases</p>
			</div>
		</div>
	{:else if !loading && !error && allReleases.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Package class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No Helm releases found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no Helm releases'
						: `No Helm releases in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredReleases}
				keyField="name"
				name={TableName.helmreleases}
				columns={helmReleasesColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, release: HelmReleaseWithAge)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Package class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{release.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={release.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = release.namespace;
								fetchReleases();
							}}
						/>
					{:else if column.id === 'chart'}
						<span class="truncate text-muted-foreground">{release.chart || '—'}</span>
					{:else if column.id === 'chartVersion'}
						<span class="font-mono text-xs text-muted-foreground">{release.chartVersion || '—'}</span>
					{:else if column.id === 'appVersion'}
						<span class="font-mono text-xs text-muted-foreground">{release.appVersion || '—'}</span>
					{:else if column.id === 'status'}
						{@const StatusIcon = getStatusIcon(release.status)}
						<Badge
							class="{getStatusColor(release.status)} px-2 py-0.5"
							title={release.status}
						>
							<StatusIcon class="mr-1 h-3 w-3" />
							<span class="text-xs">{release.status}</span>
						</Badge>
					{:else if column.id === 'revision'}
						<span class="text-center font-mono text-xs text-muted-foreground">{release.revision}</span>
					{:else if column.id === 'age'}
						<span class="font-mono text-xs text-muted-foreground">{release.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer hover:text-foreground"
								onclick={(e) => { e.stopPropagation(); openDetail(release); }}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={release.name}
								loading={deleting}
								onConfirm={() => deleteRelease(release)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Uninstall release"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- ── Detail Dialog ─────────────────────────────────────────────────────── -->
{#if selectedRelease}
	{@const StatusIcon = getStatusIcon(selectedRelease.status)}
	<Dialog.Root bind:open={showDetailDialog}>
		<Dialog.Content class="max-w-lg">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<Package class="size-4 text-muted-foreground" />
					{selectedRelease.name}
				</Dialog.Title>
				<Dialog.Description>
					Helm release details
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-3 py-1 text-sm">

				<!-- Status + namespace row -->
				<div class="flex items-center justify-between">
					<Badge
						variant="outline"
						class={cn('gap-1 font-mono text-[11px]', getStatusColor(selectedRelease.status))}
					>
						<StatusIcon class="size-3" />
						{selectedRelease.status}
					</Badge>
					<NamespaceBadge namespace={selectedRelease.namespace} />
				</div>

				<!-- Detail grid -->
				<div class="rounded-lg border divide-y text-xs">
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-muted-foreground">Chart</span>
						<span class="font-mono font-medium">
							{selectedRelease.chart || '—'}
							{#if selectedRelease.chartVersion}
								<span class="text-muted-foreground"> v{selectedRelease.chartVersion}</span>
							{/if}
						</span>
					</div>
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-muted-foreground">App Version</span>
						<span class="font-mono font-medium">{selectedRelease.appVersion || '—'}</span>
					</div>
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-muted-foreground">Revision</span>
						<span class="font-mono font-medium">{selectedRelease.revision}</span>
					</div>
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-muted-foreground">Last Updated</span>
						<span class="font-mono font-medium">
							{selectedRelease.updatedAt ? formatCreatedAt(selectedRelease.updatedAt) : '—'}
						</span>
					</div>
					<div class="flex items-center justify-between px-3 py-2">
						<span class="text-muted-foreground">Age</span>
						<span class="font-mono font-medium">{selectedRelease.age}</span>
					</div>
					{#if selectedRelease.description}
						<div class="flex items-start justify-between gap-4 px-3 py-2">
							<span class="text-muted-foreground">Description</span>
							<span class="text-right font-medium">{selectedRelease.description}</span>
						</div>
					{/if}
				</div>
			</div>

			<Dialog.Footer class="gap-2">
				<ConfirmDelete
					title={selectedRelease.name}
					loading={deleting}
					onConfirm={() => deleteRelease(selectedRelease!)}
				>
					<Button
						variant="destructive"
						size="sm"
						class="h-8 gap-1.5 text-xs"
						disabled={deleting}
					>
						{#if deleting}
							<Loader2 class="size-3.5 animate-spin" />
						{:else}
							<Trash2 class="size-3.5" />
						{/if}
						Uninstall
					</Button>
				</ConfirmDelete>
				<Button variant="outline" size="sm" class="h-8 text-xs" onclick={() => (showDetailDialog = false)}>
					Close
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
