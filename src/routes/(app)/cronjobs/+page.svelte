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
		Calendar,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Pause,
		Play,
		Zap
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type CronJob,
		type CronJobWithAge,
		getCronJobStatus,
		getStatusIcon,
		getStatusColor,
		statusDotClass
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, cronJobsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allCronJobs = $state<CronJob[]>([]);
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
	let selectedCronJob = $state<CronJobWithAge | null>(null);
	let deleting = $state(false);
	let suspending = $state(false);
	let triggering = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// CronJobs with age (reactive to ticker)
	const cronJobsWithAge = $derived.by((): CronJobWithAge[] => {
		const currentTime = timeTicker.now;
		return allCronJobs.map((cj) => ({
			...cj,
			id: `${cj.namespace}/${cj.name}`,
			age: calculateAgeWithTicker(cj.createdAt, currentTime)
		}));
	});

	// Filtered cronjobs
	const filteredCronJobs = $derived.by(() => {
		let result = cronJobsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((cj) => cj.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(cj) =>
					cj.name?.toLowerCase().includes(query) ||
					cj.namespace?.toLowerCase().includes(query) ||
					cj.schedule?.toLowerCase().includes(query) ||
					(cj.containers ?? []).some((c) => c.image?.toLowerCase().includes(query))
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof CronJob, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				active: (val: number) => Number(val)
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let cronJobsWatch: ReturnType<typeof useBatchWatch<CronJob>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchNamespaces(clusterId);
			fetchCronJobs(clusterId, selectedNamespace);

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (cronJobsWatch) cronJobsWatch.unsubscribe();

			cronJobsWatch = useBatchWatch<CronJob>({


				clusterId,


				resourceType: 'cronjobs',


				namespace: ns,


				getItems: () => allCronJobs,


				setItems: (v) => { allCronJobs = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			cronJobsWatch.subscribe();
		} else {
			allCronJobs = [];
			namespaces = [];
			if (cronJobsWatch) {
				cronJobsWatch.unsubscribe();
				cronJobsWatch = null;
			}
		}
	});

	onDestroy(() => {
		cronJobsWatch?.unsubscribe();
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
			console.error('[CronJobs] Failed to fetch namespaces:', err);
		}
	}

	async function fetchCronJobs(clusterId: number, nsParam: string) {
		loading = true;
		error = null;

		try {
			const ns = nsParam === 'all' ? 'all' : nsParam;
			const res = await fetch(`/api/clusters/${clusterId}/cronjobs?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.cronJobs) {
				allCronJobs = data.cronJobs;
			} else {
				error = data.error || 'Failed to fetch cronjobs';
				allCronJobs = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch cronjobs';
			allCronJobs = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const params = new URLSearchParams({
				cluster: activeCluster.id.toString(),
				name,
				namespace
			});
			const response = await fetch(`/api/cronjobs/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete cronjob');
			}
			toast.success(`CronJob "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete cronjob: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	async function handleSuspend(name: string, namespace: string, suspend: boolean) {
		if (!activeCluster?.id) return;

		try {
			suspending = true;
			const response = await fetch('/api/cronjobs/suspend', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cluster: activeCluster.id,
					name,
					namespace,
					suspend
				})
			});
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || `Failed to ${suspend ? 'suspend' : 'resume'} cronjob`);
			}
			toast.success(`CronJob "${name}" ${suspend ? 'suspended' : 'resumed'}`);
		} catch (err: any) {
			toast.error(`Failed to ${suspend ? 'suspend' : 'resume'} cronjob: ${err.message}`);
		} finally {
			suspending = false;
		}
	}

	async function handleTrigger(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			triggering = true;
			const response = await fetch('/api/cronjobs/trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					cluster: activeCluster.id,
					name,
					namespace
				})
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(data.error || 'Failed to trigger cronjob');
			}
			toast.success(
				`CronJob "${name}" triggered${data.jobName ? ` (job: ${data.jobName})` : ''}`
			);
		} catch (err: any) {
			toast.error(`Failed to trigger cronjob: ${err.message}`);
		} finally {
			triggering = false;
		}
	}

	function openDetail(cj: CronJobWithAge) {
		selectedCronJob = cj;
		showDetailDialog = true;
	}

	function openYamlEditor(cj: CronJobWithAge) {
		drawerResource = { resourceType: 'cronjob', name: cj.name, namespace: cj.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchCronJobs(activeClusterId, selectedNamespace);
	}

	function formatLastSchedule(ts?: string): string {
		if (!ts) return '—';
		const diff = Date.now() - new Date(ts).getTime();
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}
</script>

<svelte:head>
	<title>CronJobs - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">CronJobs</h1>
			<span class="text-sm text-muted-foreground">
				{filteredCronJobs.length} of {cronJobsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchCronJobs(activeClusterId, selectedNamespace); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns: string) => { selectedNamespace = ns; if (activeClusterId) fetchCronJobs(activeClusterId, ns); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search cronjobs..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view cronjobs</p>
			</div>
		</div>
	{:else if !loading && !error && allCronJobs.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No cronjobs found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no cronjobs'
						: `No cronjobs in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredCronJobs}
				keyField="id"
				name={TableName.cronjobs}
				columns={cronJobsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, cronjob: CronJobWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Calendar class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{cronjob.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={cronjob.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = cronjob.namespace;
								if (activeClusterId) fetchCronJobs(activeClusterId, cronjob.namespace);
							}}
						/>
					{:else if column.id === 'schedule'}
						<Badge variant="outline" class="font-mono px-1.5 py-0 text-xs">
							{cronjob.schedule}
						</Badge>
					{:else if column.id === 'suspend'}
						{@const status = getCronJobStatus(cronjob)}
						{@const StatusIcon = getStatusIcon(status)}
						<Badge class="{getStatusColor(status)} px-2 py-0.5" title={status}>
							<StatusIcon class="mr-1 h-3 w-3" />
							<span class="text-xs">{status}</span>
						</Badge>
					{:else if column.id === 'active'}
						<span class="font-mono text-xs">{cronjob.active}</span>
					{:else if column.id === 'lastSchedule'}
						<span class="text-xs text-muted-foreground">
							{formatLastSchedule(cronjob.lastSchedule)}
						</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{cronjob.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								disabled={triggering}
								onclick={(e) => {
									e.stopPropagation();
									handleTrigger(cronjob.name, cronjob.namespace);
								}}
								title="Trigger now"
							>
								<Zap class={cn('h-3.5 w-3.5', triggering && 'animate-pulse')} />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								disabled={suspending}
								onclick={(e) => {
									e.stopPropagation();
									handleSuspend(cronjob.name, cronjob.namespace, !cronjob.suspend);
								}}
								title={cronjob.suspend ? 'Resume' : 'Suspend'}
							>
								{#if cronjob.suspend}
									<Play class="h-3.5 w-3.5" />
								{:else}
									<Pause class="h-3.5 w-3.5" />
								{/if}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(cronjob);
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
									openDetail(cronjob);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={cronjob.name}
								loading={deleting}
								onConfirm={() => handleDelete(cronjob.name, cronjob.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete cronjob"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Calendar class="mb-3 h-10 w-10 opacity-40" />
						<p>No cronjobs found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading cronjobs...
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
			<Dialog.Title>CronJob Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedCronJob}
			{@const status = getCronJobStatus(selectedCronJob)}
			{@const CjStatusIcon = getStatusIcon(status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedCronJob.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs"
								>{selectedCronJob.namespace}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(status)} px-2 py-0.5 text-xs"
									title={status}
								>
									<CjStatusIcon class="mr-1 size-3" />
									{status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Schedule</p>
							<Badge variant="outline" class="mt-1 font-mono text-xs"
								>{selectedCronJob.schedule}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Suspended</p>
							<p class="mt-1 font-mono text-sm">{selectedCronJob.suspend ? 'Yes' : 'No'}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Active Jobs</p>
							<p class="mt-1 font-mono text-sm">{selectedCronJob.active}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Last Schedule</p>
							<p class="mt-1 text-sm">
								{#if selectedCronJob.lastSchedule}
									{formatCreatedAt(selectedCronJob.lastSchedule)}
									<span class="text-xs text-muted-foreground">
										({formatLastSchedule(selectedCronJob.lastSchedule)})
									</span>
								{:else}
									—
								{/if}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedCronJob.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedCronJob.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Containers -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Containers</h3>
					<div class="space-y-3">
						{#each selectedCronJob.containers ?? [] as container}
							<div class="rounded-md border bg-muted/40 p-3">
								<div class="grid grid-cols-2 gap-3">
									<div>
										<p class="text-sm font-medium text-muted-foreground">Name</p>
										<p class="mt-1 font-mono text-sm">{container.name}</p>
									</div>
									<div class="col-span-2">
										<p class="text-sm font-medium text-muted-foreground">Image</p>
										<p class="mt-1 break-all font-mono text-xs">{container.image}</p>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedCronJob.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedCronJob.labels) as [k, v]}
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
					{#if Object.keys(selectedCronJob.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedCronJob.annotations) as [k, v]}
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
