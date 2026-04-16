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
		Timer,
		Info,
		Trash2,
		Loader2,
		FileCode,
		Pause,
		Play
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useBatchWatch } from '$lib/hooks/use-batch-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type Job,
		type JobWithAge,
		getJobStatus,
		getStatusIcon,
		getStatusColor,
		statusDotClass
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, jobsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';
	import ResourceDrawer, { type ResourceRef } from '$lib/components/resource-drawer.svelte';

	const activeCluster = $derived(clusterStore.active);
	const activeClusterId = $derived(clusterStore.active?.id ?? null);
	let allJobs = $state<Job[]>([]);
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
	let selectedJob = $state<JobWithAge | null>(null);
	let deleting = $state(false);
	let suspending = $state(false);

	// YAML editor
	let showYamlDialog = $state(false);
	let drawerResource = $state<ResourceRef | null>(null);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Jobs with age (reactive to ticker)
	const jobsWithAge = $derived.by((): JobWithAge[] => {
		const currentTime = timeTicker.now;
		return allJobs.map((job) => ({
			...job,
			id: `${job.namespace}/${job.name}`,
			age: calculateAgeWithTicker(job.createdAt, currentTime)
		}));
	});

	// Filtered jobs
	const filteredJobs = $derived.by(() => {
		let result = jobsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((job) => job.namespace === selectedNamespace);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(job) =>
					job.name?.toLowerCase().includes(query) ||
					job.namespace?.toLowerCase().includes(query) ||
					job.status?.toLowerCase().includes(query) ||
					(job.containers ?? []).some((c) => c.image?.toLowerCase().includes(query))
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof Job, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				succeeded: (val: number) => Number(val),
				failed: (val: number) => Number(val),
				active: (val: number) => Number(val)
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let jobsWatch: ReturnType<typeof useBatchWatch<Job>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		const clusterId = activeClusterId;
		if (clusterId) {
			fetchNamespaces(clusterId);
			fetchJobs(clusterId, selectedNamespace);

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (jobsWatch) jobsWatch.unsubscribe();

			jobsWatch = useBatchWatch<Job>({


				clusterId,


				resourceType: 'jobs',


				namespace: ns,


				getItems: () => allJobs,


				setItems: (v) => { allJobs = v; },


				keyFn: (i) => `${i.namespace}/${i.name}`


			});

			jobsWatch.subscribe();
		} else {
			allJobs = [];
			namespaces = [];
			if (jobsWatch) {
				jobsWatch.unsubscribe();
				jobsWatch = null;
			}
		}
	});

	onDestroy(() => {
		jobsWatch?.unsubscribe();
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
			console.error('[Jobs] Failed to fetch namespaces:', err);
		}
	}

	async function fetchJobs(clusterId: number, nsParam: string) {
		loading = true;
		error = null;

		try {
			const ns = nsParam === 'all' ? 'all' : nsParam;
			const res = await fetch(`/api/clusters/${clusterId}/jobs?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.jobs) {
				allJobs = data.jobs;
			} else {
				error = data.error || 'Failed to fetch jobs';
				allJobs = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch jobs';
			allJobs = [];
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
			const response = await fetch(`/api/jobs/delete?${params}`, { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete job');
			}
			toast.success(`Job "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete job: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	async function handleSuspend(name: string, namespace: string, suspend: boolean) {
		if (!activeCluster?.id) return;

		try {
			suspending = true;
			const response = await fetch('/api/jobs/suspend', {
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
				throw new Error(data.error || `Failed to ${suspend ? 'suspend' : 'resume'} job`);
			}
			toast.success(`Job "${name}" ${suspend ? 'suspended' : 'resumed'}`);
		} catch (err: any) {
			toast.error(`Failed to ${suspend ? 'suspend' : 'resume'} job: ${err.message}`);
		} finally {
			suspending = false;
		}
	}

	function openDetail(job: JobWithAge) {
		selectedJob = job;
		showDetailDialog = true;
	}

	function openYamlEditor(job: JobWithAge) {
		drawerResource = { resourceType: 'job', name: job.name, namespace: job.namespace };
		showYamlDialog = true;
	}

	function closeYamlEditor() {
		showYamlDialog = false;
		drawerResource = null;
	}

	function handleYamlSuccess() {
		if (activeClusterId) fetchJobs(activeClusterId, selectedNamespace);
	}
</script>

<svelte:head>
	<title>Jobs - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Jobs</h1>
			<span class="text-sm text-muted-foreground">
				{filteredJobs.length} of {jobsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={() => { if (activeClusterId) fetchJobs(activeClusterId, selectedNamespace); }}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<NamespaceSelect
				{namespaces}
				value={selectedNamespace}
				onChange={(ns: string) => { selectedNamespace = ns; if (activeClusterId) fetchJobs(activeClusterId, ns); }}
			/>
			<div class="relative flex-1 sm:flex-none">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="Search jobs..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view jobs</p>
			</div>
		</div>
	{:else if !loading && !error && allJobs.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No jobs found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no jobs'
						: `No jobs in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredJobs}
				keyField="id"
				name={TableName.jobs}
				columns={jobsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
				virtualScroll={true}
			>
				{#snippet cell(column, job: JobWithAge, rowState)}
					{#if column.id === 'name'}
						<div class="flex items-center gap-1.5 text-sm font-medium">
							<Timer class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="truncate">{job.name}</span>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={job.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = job.namespace;
								if (activeClusterId) fetchJobs(activeClusterId, job.namespace);
							}}
						/>
					{:else if column.id === 'status'}
						{@const status = getJobStatus(job)}
						{@const StatusIcon = getStatusIcon(status)}
						<div class="flex items-center gap-1.5">
							<Badge class="{getStatusColor(status)} px-2 py-0.5" title={status}>
								<StatusIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{status}</span>
							</Badge>
						</div>
					{:else if column.id === 'completions'}
						<span class="font-mono text-xs">{job.completions}</span>
					{:else if column.id === 'duration'}
						<span class="text-xs text-muted-foreground">{job.duration || '—'}</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{job.age}</span>
					{:else if column.id === 'containers'}
						<div class="flex flex-wrap gap-1">
							{#each (job.containers ?? []).slice(0, 2) as container}
								<Badge variant="outline" class="max-w-45 truncate px-1.5 py-0 text-xs">
									{container.image.split('/').pop()?.split(':')[0] ?? container.image}
								</Badge>
							{/each}
							{#if (job.containers ?? []).length > 2}
								<Badge variant="outline" class="px-1.5 py-0 text-xs">
									+{(job.containers ?? []).length - 2}
								</Badge>
							{/if}
						</div>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							{#if job.status === 'Running' || job.status === 'Suspended'}
								<Button
									variant="ghost"
									size="icon"
									class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
									disabled={suspending}
									onclick={(e) => {
										e.stopPropagation();
										const isSuspended = job.status === 'Suspended';
										handleSuspend(job.name, job.namespace, !isSuspended);
									}}
									title={job.status === 'Suspended' ? 'Resume' : 'Suspend'}
								>
									{#if job.status === 'Suspended'}
										<Play class="h-3.5 w-3.5" />
									{:else}
										<Pause class="h-3.5 w-3.5" />
									{/if}
								</Button>
							{/if}
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openYamlEditor(job);
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
									openDetail(job);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={job.name}
								loading={deleting}
								onConfirm={() => handleDelete(job.name, job.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete job"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Timer class="mb-3 h-10 w-10 opacity-40" />
						<p>No jobs found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading jobs...
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
			<Dialog.Title>Job Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedJob}
			{@const status = getJobStatus(selectedJob)}
			{@const JobStatusIcon = getStatusIcon(status)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedJob.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs"
								>{selectedJob.namespace}</Badge
							>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Status</p>
							<div class="mt-1">
								<Badge
									class="{getStatusColor(status)} px-2 py-0.5 text-xs"
									title={status}
								>
									<JobStatusIcon class="mr-1 size-3" />
									{status}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Completions</p>
							<p class="mt-1 font-mono text-sm">{selectedJob.completions}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Duration</p>
							<p class="mt-1 text-sm">{selectedJob.duration || '—'}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Active</p>
							<p class="mt-1 font-mono text-sm">{selectedJob.active}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Succeeded</p>
							<p class="mt-1 font-mono text-sm text-emerald-500">{selectedJob.succeeded}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Failed</p>
							<p class="mt-1 font-mono text-sm {selectedJob.failed > 0 ? 'text-red-500' : ''}">{selectedJob.failed}</p>
						</div>
						{#if selectedJob.startTime}
							<div>
								<p class="text-sm font-medium text-muted-foreground">Start Time</p>
								<p class="mt-1 font-mono text-sm">
									{formatCreatedAt(selectedJob.startTime)}
								</p>
							</div>
						{/if}
						{#if selectedJob.completionTime}
							<div>
								<p class="text-sm font-medium text-muted-foreground">Completion Time</p>
								<p class="mt-1 font-mono text-sm">
									{formatCreatedAt(selectedJob.completionTime)}
								</p>
							</div>
						{/if}
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedJob.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedJob.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Containers -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Containers</h3>
					<div class="space-y-3">
						{#each selectedJob.containers ?? [] as container}
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

				<!-- Conditions -->
				{#if (selectedJob.conditions ?? []).length > 0}
					<div>
						<h3 class="mb-3 text-sm font-semibold">Conditions</h3>
						<div class="space-y-2">
							{#each selectedJob.conditions as condition}
								<div class="rounded-md border bg-muted/40 p-2">
									<div class="mb-1 flex items-center gap-2">
										<Badge variant="outline" class="text-xs">{condition.type}</Badge>
										<span
											class={cn(
												'text-xs',
												condition.status === 'True'
													? 'text-emerald-500'
													: condition.status === 'False'
														? 'text-muted-foreground'
														: 'text-yellow-500'
											)}>{condition.status}</span
										>
									</div>
									{#if condition.reason}
										<p class="text-xs text-muted-foreground">Reason: {condition.reason}</p>
									{/if}
									{#if condition.message}
										<p class="mt-1 text-xs text-muted-foreground">{condition.message}</p>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedJob.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedJob.labels) as [k, v]}
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
					{#if Object.keys(selectedJob.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedJob.annotations) as [k, v]}
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
