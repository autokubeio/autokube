<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';
	import { createTimeTicker, calculateAgeWithTicker } from '$lib/utils/time-ticker.svelte';
	import { arrayAdd, arrayModify, arrayDelete } from '$lib/utils/arrays';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import NamespaceBadge from '$lib/components/namespace-badge.svelte';
	import { formatCreatedAt, tryPrettyJson } from '$lib/utils/formatters';
	import {
		RefreshCw,
		Search,
		AlertTriangle,
		Info,
		Loader2
	} from 'lucide-svelte';
	import {
		type K8sEvent,
		type K8sEventWithAge,
		getTypeIcon,
		getTypeColor,
		formatInvolvedObject
	} from '../events/columns';

	// ─── State ────────────────────────────────────────────────────────────────

	const activeCluster = $derived(clusterStore.active);
	let allEvents = $state<K8sEvent[]>([]);
	let loading = $state(false);
	let namespaces = $state<string[]>([]);

	let selectedType = $state('all');
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// Detail dialog
	let showDetailDialog = $state(false);
	let selectedEvent = $state<K8sEventWithAge | null>(null);

	function openDetail(evt: K8sEventWithAge) {
		selectedEvent = evt;
		showDetailDialog = true;
	}

	const timeTicker = createTimeTicker(10_000);

	// Plain let — NOT $state. Assigning inside $effect would re-trigger it.
	let eventsWatch: ReturnType<typeof useResourceWatch<K8sEvent>> | null = null;

	// ─── Derived ──────────────────────────────────────────────────────────────

	const eventsWithAge = $derived.by((): K8sEventWithAge[] => {
		const now = timeTicker.now;
		return allEvents.map((evt) => ({
			...evt,
			age: calculateAgeWithTicker(evt.lastSeen || evt.createdAt, now)
		}));
	});

	const filteredEvents = $derived.by(() => {
		let result = eventsWithAge;
		if (selectedNamespace !== 'all') result = result.filter((e) => e.namespace === selectedNamespace);
		if (selectedType !== 'all') result = result.filter((e) => e.type === selectedType);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(e) =>
					e.name.toLowerCase().includes(q) ||
					e.namespace.toLowerCase().includes(q) ||
					e.reason.toLowerCase().includes(q) ||
					e.message.toLowerCase().includes(q) ||
					e.source.toLowerCase().includes(q) ||
					formatInvolvedObject(e.involvedObject).toLowerCase().includes(q)
			);
		}
		result = [...result].sort((a, b) => {
			const ta = new Date(a.lastSeen || a.createdAt).getTime();
			const tb = new Date(b.lastSeen || b.createdAt).getTime();
			return tb - ta;
		});
		return result;
	});

	const warningCount = $derived(allEvents.filter((e) => e.type === 'Warning').length);
	const hasFilters = $derived(
		selectedType !== 'all' || selectedNamespace !== 'all' || searchQuery.trim() !== ''
	);

	// ─── Watch & fetch setup (same pattern as Events page) ────────────────────

	$effect(() => {
		if (activeCluster) {
			fetchNamespaces();
			fetchEvents();

			if (eventsWatch) eventsWatch.unsubscribe();

			eventsWatch = useResourceWatch<K8sEvent>({
				clusterId: activeCluster.id,
				resourceType: 'events',
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

	// ─── Data fetching ────────────────────────────────────────────────────────

	async function fetchNamespaces() {
		if (!activeCluster?.id) return;
		try {
			const res = await fetch(`/api/namespaces?cluster=${activeCluster.id}`);
			const data = await res.json();
			if (data.success && data.namespaces) {
				namespaces = data.namespaces.map((ns: { name: string }) => ns.name).sort();
			}
		} catch (err) {
			console.error('[Timeline] Failed to fetch namespaces:', err);
		}
	}

	async function fetchEvents() {
		if (!activeCluster?.id) return;
		loading = true;
		try {
			// Always fetch all events — namespace / severity filtering is done client-side
			const res = await fetch(`/api/clusters/${activeCluster.id}/events?namespace=all`);
			const data = await res.json();
			if (data.success && data.events) {
				allEvents = data.events;
			}
		} catch (err) {
			console.error('[Timeline] Failed to fetch events:', err);
		} finally {
			loading = false;
		}
	}

	function clearFilters() {
		selectedType = 'all';
		selectedNamespace = 'all';
		searchQuery = '';
	}
</script>

<svelte:head>
	<title>Timeline - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Toolbar -->
	<div class="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-2">
			<h1 class="text-2xl font-bold">Timeline</h1>
			<span class="text-sm text-muted-foreground">
				{filteredEvents.length} of {eventsWithAge.length}
			</span>
			{#if warningCount > 0}
				<span class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
					<AlertTriangle class="size-3" />{warningCount} warning{warningCount !== 1 ? 's' : ''}
				</span>
			{/if}
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
				onValueChange={(v: string) => { if (v) selectedType = v; }}
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
				onValueChange={(v: string) => { if (v) selectedNamespace = v; }}
			>
				<Select.Trigger class="h-8 w-36 text-xs">
					{selectedNamespace === 'all' ? 'All namespaces' : selectedNamespace}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All namespaces</Select.Item>
					{#each namespaces as ns (ns)}<Select.Item value={ns}>{ns}</Select.Item>{/each}
				</Select.Content>
			</Select.Root>

			<div class="relative">
				<Search class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input placeholder="Search…" class="h-8 w-44 pl-8 text-xs" bind:value={searchQuery} />
			</div>
		</div>
	</div>

	<!-- Content -->
	{#if !loading && !activeCluster}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<div class="flex size-12 items-center justify-center rounded-full bg-muted">
				<Search class="size-6 text-muted-foreground" />
			</div>
			<div>
				<h3 class="mb-1 font-semibold">No cluster selected</h3>
				<p class="text-sm text-muted-foreground">Select a cluster to view the timeline</p>
			</div>
		</div>
	{:else if loading}
		<div class="flex flex-1 items-center justify-center text-muted-foreground">
			<Loader2 class="mr-2 size-5 animate-spin" />
			Loading events…
		</div>
	{:else if filteredEvents.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
			<Info class="size-8 opacity-40" />
			<p class="text-sm">No events found</p>
			{#if hasFilters}
				<Button variant="ghost" size="sm" class="text-xs" onclick={clearFilters}>Clear filters</Button>
			{/if}
		</div>
	{:else}
		<div class="relative min-h-0 flex-1 overflow-y-auto">
			<!-- vertical spine -->
			<div class="pointer-events-none absolute top-0 bottom-0 left-4.5 w-px bg-border"></div>

			<div class="pb-6">
				{#each filteredEvents as evt (`${evt.namespace}/${evt.name}`)}
					{@const TypeIcon = getTypeIcon(evt.type)}
					{@const isWarning = evt.type === 'Warning'}

					<div class="relative flex gap-4 py-1.5 pr-1">
						<!-- dot -->
						<div
							class={cn(
								'relative z-10 mt-3 flex size-4.5 shrink-0 items-center justify-center rounded-full border-2',
								isWarning
									? 'border-amber-500 bg-amber-500/15'
									: 'border-emerald-500 bg-emerald-500/15'
							)}
						>
							<TypeIcon class={cn('size-2.5', isWarning ? 'text-amber-400' : 'text-emerald-400')} />
						</div>

						<!-- card -->
						<div class="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2 shadow-xs transition-colors hover:bg-accent/30">
							<!-- top row: reason + object + namespace + age -->
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
								<span class="text-xs font-semibold">{evt.reason}</span>
								<span
									class="truncate font-mono text-[11px] text-muted-foreground"
									title={formatInvolvedObject(evt.involvedObject)}
								>
									{formatInvolvedObject(evt.involvedObject)}
								</span>
								<span class="ml-auto flex shrink-0 items-center gap-1.5">
									<NamespaceBadge
										namespace={evt.namespace}
										onclick={(e: MouseEvent) => {
											e.stopPropagation();
											selectedNamespace = evt.namespace;
										}}
									/>
									<span class="text-[11px] tabular-nums text-muted-foreground">{evt.age}</span>
								</span>
							</div>

							<!-- message row -->
							<p
								class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
								title={evt.message}
							>
								{evt.message}
							</p>

						<!-- bottom meta: source + count + detail button -->
						<div class="mt-1 flex items-center gap-3">
							{#if evt.source}
								<span class="text-[10px] text-muted-foreground/60">{evt.source}</span>
							{/if}
							{#if evt.count > 1}
								<span class="text-[10px] text-muted-foreground/60">×{evt.count}</span>
							{/if}
							<Button
								variant="ghost"
								size="sm"
								class="ml-auto h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
								onclick={() => openDetail(evt)}
							>
								<Info class="size-3" />
								Details
							</Button>
						</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</section>

<!-- Event Detail Dialog -->
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
							<p class="mt-1 break-all font-mono text-sm">{selectedEvent.name}</p>
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
							<p class="mt-1 font-mono text-sm">{formatCreatedAt(selectedEvent.createdAt)}</p>
						</div>
					</div>
				</div>

				<!-- Message -->
				<div>
					<h3 class="mb-3 text-sm font-semibold">Message</h3>
					<div class="rounded-md border bg-muted/40 p-3">
						<p class="whitespace-pre-wrap break-all text-sm">{selectedEvent.message || 'No message'}</p>
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
							{#each Object.entries(selectedEvent.labels) as [k, v] (k)}
								<div class="flex items-start gap-2 text-xs">
									<span class="min-w-0 break-all font-mono text-muted-foreground">{k}:</span>
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
							{#each Object.entries(selectedEvent.annotations) as [k, v] (k)}
								{@const parsed = tryPrettyJson(v)}
								<div class="rounded-md border bg-muted/40 px-3 py-2">
									<p class="mb-1 break-all font-mono text-[11px] text-muted-foreground">{k}</p>
									{#if parsed.pretty}
										<pre class="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">{parsed.text}</pre>
									{:else}
										<p class="break-all font-mono text-xs">{v}</p>
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
