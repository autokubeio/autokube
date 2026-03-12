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
		Activity,
		Info,
		Trash2,
		Loader2
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { onDestroy } from 'svelte';
	import {
		type K8sEvent,
		type K8sEventWithAge,
		getTypeIcon,
		getTypeColor,
		formatInvolvedObject
	} from './columns';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, eventsColumns } from '$lib/table-columns';
	import { toast } from 'svelte-sonner';

	const activeCluster = $derived(clusterStore.active);
	let allEvents = $state<K8sEvent[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');
	let selectedType = $state('all');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedEvent = $state<K8sEventWithAge | null>(null);
	let deleting = $state(false);

	// Time ticker for auto-updating age calculations (updates every 10 seconds)
	const timeTicker = createTimeTicker(10000);

	// Sort state
	let sortState = $state<DataTableSortState | undefined>(undefined);

	// Events with age (reactive to ticker)
	const eventsWithAge = $derived.by((): K8sEventWithAge[] => {
		const currentTime = timeTicker.now;
		return allEvents.map((evt) => ({
			...evt,
			age: calculateAgeWithTicker(evt.lastSeen || evt.createdAt, currentTime)
		}));
	});

	// Filtered events
	const filteredEvents = $derived.by(() => {
		let result = eventsWithAge;

		// Filter by namespace
		if (selectedNamespace !== 'all') {
			result = result.filter((evt) => evt.namespace === selectedNamespace);
		}

		// Filter by type
		if (selectedType !== 'all') {
			result = result.filter((evt) => evt.type === selectedType);
		}

		// Filter by search
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(evt) =>
					evt.name.toLowerCase().includes(query) ||
					evt.namespace.toLowerCase().includes(query) ||
					evt.reason.toLowerCase().includes(query) ||
					evt.message.toLowerCase().includes(query) ||
					evt.source.toLowerCase().includes(query) ||
					formatInvolvedObject(evt.involvedObject).toLowerCase().includes(query)
			);
		}

		// Apply sorting
		if (sortState) {
			result = arraySort(result, sortState.field as keyof K8sEvent, sortState.direction, {
				createdAt: (val: string) => new Date(val).getTime(),
				lastSeen: (val: string) => new Date(val).getTime(),
				count: (val: number) => Number(val)
			});
		}

		return result;
	});

	// Plain let — NOT $state. Writing inside a $effect would re-trigger it.
	let eventsWatch: ReturnType<typeof useResourceWatch<K8sEvent>> | null = null;

	// Watch for cluster/namespace changes
	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchEvents();

			const ns = selectedNamespace === 'all' ? undefined : selectedNamespace;

			if (eventsWatch) eventsWatch.unsubscribe();

			eventsWatch = useResourceWatch<K8sEvent>({
				clusterId: activeCluster.id,
				resourceType: 'events',
				namespace: ns,
				onAdded: (evt) => {
					allEvents = arrayAdd(allEvents, evt, (e) => `${e.namespace}/${e.name}`);
				},
				onModified: (evt) => {
					allEvents = arrayModify(allEvents, evt, (e) => `${e.namespace}/${e.name}`);
				},
				onDeleted: (evt) => {
					allEvents = arrayDelete(allEvents, evt, (e) => `${e.namespace}/${e.name}`);
				}
			});

			eventsWatch.subscribe();
		} else {
			allEvents = [];
			namespaces = [];
			if (eventsWatch) {
				eventsWatch.unsubscribe();
				eventsWatch = null;
			}
		}
	});

	onDestroy(() => {
		eventsWatch?.unsubscribe();
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
			console.error('[Events] Failed to fetch namespaces:', err);
		}
	}

	async function fetchEvents() {
		if (!activeCluster?.id) return;

		loading = true;
		error = null;

		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/events?namespace=${ns}`);
			const data = await res.json();

			if (data.success && data.events) {
				allEvents = data.events;
			} else {
				error = data.error || 'Failed to fetch events';
				allEvents = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch events';
			allEvents = [];
		} finally {
			loading = false;
		}
	}

	async function handleDelete(name: string, namespace: string) {
		if (!activeCluster?.id) return;

		try {
			deleting = true;
			const response = await fetch(
				`/api/clusters/${activeCluster.id}/events/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to delete event');
			}
			toast.success(`Event "${name}" deleted`);
		} catch (err: any) {
			toast.error(`Failed to delete event: ${err.message}`);
		} finally {
			deleting = false;
		}
	}

	function openDetail(evt: K8sEventWithAge) {
		selectedEvent = evt;
		showDetailDialog = true;
	}
</script>

<svelte:head>
	<title>Events - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Events</h1>
			<span class="text-sm text-muted-foreground">
				{filteredEvents.length} of {eventsWithAge.length}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={loading || !activeCluster}
				onclick={fetchEvents}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<Select.Root
				type="single"
				value={selectedType}
				onValueChange={(v: string) => {
					if (v) selectedType = v;
				}}
			>
				<Select.Trigger class="h-8 w-28 text-xs">
					{selectedType === 'all' ? 'All types' : selectedType}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All types</Select.Item>
					<Select.Item value="Normal">Normal</Select.Item>
					<Select.Item value="Warning">Warning</Select.Item>
				</Select.Content>
			</Select.Root>
			<Select.Root
				type="single"
				value={selectedNamespace}
				onValueChange={(v: string) => {
					if (v) {
						selectedNamespace = v;
						fetchEvents();
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
					placeholder="Search events..."
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
				<p class="text-sm text-muted-foreground">Select a cluster to view events</p>
			</div>
		</div>
	{:else if !loading && !error && allEvents.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No events found</h3>
				<p class="text-sm text-muted-foreground">
					{selectedNamespace === 'all'
						? 'This cluster has no events'
						: `No events in namespace "${selectedNamespace}"`}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1">
			<DataTableView
				data={filteredEvents}
				keyField="name"
				name={TableName.events}
				columns={eventsColumns}
				{sortState}
				onSortChange={(state) => (sortState = state)}
				onRowClick={openDetail}
				wrapperClass="border rounded-lg"
			>
				{#snippet cell(column, evt: K8sEventWithAge, rowState)}
					{#if column.id === 'type'}
						{@const TypeIcon = getTypeIcon(evt.type)}
						<div class="flex items-center gap-1.5">
							<Badge class="{getTypeColor(evt.type)} px-2 py-0.5" title={evt.type}>
								<TypeIcon class="mr-1 h-3 w-3" />
								<span class="text-xs">{evt.type}</span>
							</Badge>
						</div>
					{:else if column.id === 'namespace'}
						<NamespaceBadge
							namespace={evt.namespace}
							onclick={(e) => {
								e.stopPropagation();
								selectedNamespace = evt.namespace;
								fetchEvents();
							}}
						/>
					{:else if column.id === 'reason'}
						<span class="text-xs font-medium">{evt.reason}</span>
					{:else if column.id === 'object'}
						<span class="truncate font-mono text-xs" title={formatInvolvedObject(evt.involvedObject)}>
							{formatInvolvedObject(evt.involvedObject)}
						</span>
					{:else if column.id === 'message'}
						<span class="truncate text-xs text-muted-foreground" title={evt.message}>
							{evt.message}
						</span>
					{:else if column.id === 'count'}
						<span class="font-mono text-xs">{evt.count}</span>
					{:else if column.id === 'age'}
						<span class="text-xs text-muted-foreground">{evt.age}</span>
					{:else if column.id === 'actions'}
						<div class="flex items-center justify-end gap-0.5">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:cursor-pointer"
								onclick={(e) => {
									e.stopPropagation();
									openDetail(evt);
								}}
								title="View details"
							>
								<Info class="h-3.5 w-3.5" />
							</Button>
							<ConfirmDelete
								title={evt.name}
								loading={deleting}
								onConfirm={() => handleDelete(evt.name, evt.namespace)}
							>
								<Button
									variant="ghost"
									size="icon"
									disabled={deleting}
									class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
									title="Delete event"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</Button>
							</ConfirmDelete>
						</div>
					{/if}
				{/snippet}

				{#snippet emptyState()}
					<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<Activity class="mb-3 h-10 w-10 opacity-40" />
						<p>No events found</p>
					</div>
				{/snippet}

				{#snippet loadingState()}
					<div class="flex items-center justify-center py-16 text-muted-foreground">
						<Loader2 class="mr-2 h-5 w-5 animate-spin" />
						Loading events...
					</div>
				{/snippet}
			</DataTableView>
		</div>
	{/if}
</section>

<!-- Detail Dialog -->
<Dialog.Root bind:open={showDetailDialog}>
	<Dialog.Content class="max-h-[90vh] max-w-3xl overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Event Details</Dialog.Title>
		</Dialog.Header>
		{#if selectedEvent}
			{@const TypeIcon = getTypeIcon(selectedEvent.type)}
			<div class="space-y-6">
				<!-- Overview -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Overview</h3>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm break-all">{selectedEvent.name}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Namespace</p>
							<Badge variant="outline" class="mt-1 text-xs">{selectedEvent.namespace}</Badge>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Type</p>
							<div class="mt-1">
								<Badge class="{getTypeColor(selectedEvent.type)} px-2 py-0.5 text-xs">
									<TypeIcon class="mr-1 size-3" />
									{selectedEvent.type}
								</Badge>
							</div>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Reason</p>
							<p class="mt-1 text-sm font-medium">{selectedEvent.reason}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Count</p>
							<p class="mt-1 font-mono text-sm">{selectedEvent.count}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Source</p>
							<p class="mt-1 font-mono text-sm">{selectedEvent.source}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">First Seen</p>
							<p class="mt-1 font-mono text-sm">
								{selectedEvent.firstSeen ? formatCreatedAt(selectedEvent.firstSeen) : '—'}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Last Seen</p>
							<p class="mt-1 font-mono text-sm">
								{selectedEvent.lastSeen ? formatCreatedAt(selectedEvent.lastSeen) : '—'}
							</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Age</p>
							<p class="mt-1 text-sm">{selectedEvent.age}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Created</p>
							<p class="mt-1 font-mono text-sm">
								{formatCreatedAt(selectedEvent.createdAt)}
							</p>
						</div>
					</div>
				</div>

				<!-- Message -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Message</h3>
					<div class="rounded-md border bg-muted/40 p-3">
						<p class="text-sm whitespace-pre-wrap break-all">
							{selectedEvent.message || 'No message'}
						</p>
					</div>
				</div>

				<!-- Involved Object -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Involved Object</h3>
					<div class="grid grid-cols-2 gap-4 rounded-md border bg-muted/40 p-3">
						<div>
							<p class="text-sm font-medium text-muted-foreground">Kind</p>
							<p class="mt-1 text-sm">{selectedEvent.involvedObject.kind}</p>
						</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Name</p>
							<p class="mt-1 font-mono text-sm">{selectedEvent.involvedObject.name}</p>
						</div>
						{#if selectedEvent.involvedObject.namespace}
							<div>
								<p class="text-sm font-medium text-muted-foreground">Namespace</p>
								<Badge variant="outline" class="mt-1 text-xs">
									{selectedEvent.involvedObject.namespace}
								</Badge>
							</div>
						{/if}
					</div>
				</div>

				<!-- Labels -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Labels</h3>
					{#if Object.keys(selectedEvent.labels ?? {}).length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each Object.entries(selectedEvent.labels) as [k, v]}
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
					{#if Object.keys(selectedEvent.annotations ?? {}).length > 0}
						<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each Object.entries(selectedEvent.annotations) as [k, v]}
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
