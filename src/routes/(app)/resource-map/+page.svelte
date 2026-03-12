<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import { Separator } from '$lib/components/ui/separator';
	import { cn } from '$lib/utils';
	import {
		RefreshCw,
		Box,
		Layers,
		Network,
		Globe,
		Server,
		Database,
		Timer,
		Calendar,
		Copy,
		AlertCircle,
		Search,
		ArrowRight,
		ChevronRight,
		X,
		LayoutGrid,
		GanttChart,
		Shield
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';

	// ── Types ───────────────────────────────────────────────────────────────

	interface DiagramPod {
		name: string;
		namespace: string;
		phase: string;
		ready: string;
		restarts: number;
		nodeName?: string;
		labels: Record<string, string>;
		ownerKind?: string;
		ownerName?: string;
		uid?: string;
	}

	interface DiagramDeployment {
		name: string;
		namespace: string;
		replicas: number;
		readyReplicas: number;
		availableReplicas: number;
		labels: Record<string, string>;
		selector: Record<string, string>;
		uid?: string;
	}

	interface DiagramReplicaSet {
		name: string;
		namespace: string;
		replicas: number;
		readyReplicas: number;
		ownerKind?: string;
		ownerName?: string;
		uid?: string;
	}

	interface DiagramDaemonSet {
		name: string;
		namespace: string;
		desired: number;
		ready: number;
		available: number;
		uid?: string;
	}

	interface DiagramStatefulSet {
		name: string;
		namespace: string;
		replicas: number;
		readyReplicas: number;
		uid?: string;
	}

	interface DiagramService {
		name: string;
		namespace: string;
		type: string;
		clusterIP?: string;
		ports: Array<{ port: number; targetPort?: number | string; protocol?: string }>;
		selector: Record<string, string>;
		uid?: string;
	}

	interface DiagramIngress {
		name: string;
		namespace: string;
		hosts: string[];
		backends: Array<{ path?: string; serviceName?: string; servicePort?: number }>;
		tls: boolean;
		uid?: string;
	}

	interface DiagramJob {
		name: string;
		namespace: string;
		succeeded: number;
		failed: number;
		active: number;
		ownerKind?: string;
		ownerName?: string;
		uid?: string;
	}

	interface DiagramCronJob {
		name: string;
		namespace: string;
		schedule: string;
		suspended: boolean;
		uid?: string;
	}

	interface ResourceData {
		pods: DiagramPod[];
		deployments: DiagramDeployment[];
		replicaSets: DiagramReplicaSet[];
		daemonSets: DiagramDaemonSet[];
		statefulSets: DiagramStatefulSet[];
		services: DiagramService[];
		ingresses: DiagramIngress[];
		jobs: DiagramJob[];
		cronJobs: DiagramCronJob[];
	}

	interface NamespaceGroup {
		namespace: string;
		pods: DiagramPod[];
		deployments: DiagramDeployment[];
		replicaSets: DiagramReplicaSet[];
		daemonSets: DiagramDaemonSet[];
		statefulSets: DiagramStatefulSet[];
		services: DiagramService[];
		ingresses: DiagramIngress[];
		jobs: DiagramJob[];
		cronJobs: DiagramCronJob[];
	}

	// ── State ───────────────────────────────────────────────────────────────

	const activeCluster = $derived(clusterStore.active);

	let loading = $state(false);
	let error = $state<string | null>(null);
	let resources = $state<ResourceData | null>(null);
	let namespaces = $state<string[]>([]);
	let selectedNamespace = $state('all');
	let searchQuery = $state('');

	// ── URL-driven state ───────────────────────────────────────────────────

	const viewMode = $derived((page.url.searchParams.get('view') as 'overview' | 'detail') || 'overview');
	const detailNs = $derived(page.url.searchParams.get('ns') || null);

	// Drawer state (local only, not in URL)
	let selectedResource = $state<{ kind: string; name: string; namespace: string; data: any } | null>(null);

	function updateUrl(params: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(params)) {
			if (value === null) url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		goto(url.pathname + url.search, { replaceState: false, noScroll: true });
	}

	// ── Resource icons ──────────────────────────────────────────────────────

	const RESOURCE_ICONS: Record<string, typeof Box> = {
		pod: Box,
		deployment: Layers,
		replicaset: Copy,
		daemonset: Server,
		statefulset: Database,
		service: Network,
		ingress: Globe,
		job: Timer,
		cronjob: Calendar
	};

	// ── Pod status helpers ──────────────────────────────────────────────────

	function podStatusColor(phase: string): string {
		switch (phase) {
			case 'Running': return 'bg-emerald-500';
			case 'Succeeded': return 'bg-blue-500';
			case 'Pending': return 'bg-amber-500';
			case 'Failed': return 'bg-red-500';
			default: return 'bg-zinc-500';
		}
	}

	function healthStatus(ready: number, total: number): 'healthy' | 'degraded' | 'unhealthy' | 'idle' {
		if (total === 0) return 'idle';
		if (ready === total) return 'healthy';
		if (ready > 0) return 'degraded';
		return 'unhealthy';
	}

	function healthDot(status: string): string {
		switch (status) {
			case 'healthy': return 'bg-emerald-500';
			case 'degraded': return 'bg-amber-500';
			case 'unhealthy': return 'bg-red-500';
			default: return 'bg-zinc-500';
		}
	}

	function healthBorder(status: string): string {
		switch (status) {
			case 'healthy': return 'border-emerald-500/25';
			case 'degraded': return 'border-amber-500/25';
			case 'unhealthy': return 'border-red-500/25';
			default: return 'border-zinc-500/25';
		}
	}

	// ── Computed namespace groups ───────────────────────────────────────────

	const namespaceGroups = $derived.by(() => {
		if (!resources) return [];

		const nsMap = new Map<string, NamespaceGroup>();

		function ensureNs(ns: string): NamespaceGroup {
			if (!nsMap.has(ns)) {
				nsMap.set(ns, {
					namespace: ns,
					pods: [],
					deployments: [],
					replicaSets: [],
					daemonSets: [],
					statefulSets: [],
					services: [],
					ingresses: [],
					jobs: [],
					cronJobs: []
				});
			}
			return nsMap.get(ns)!;
		}

		for (const p of resources.pods) ensureNs(p.namespace).pods.push(p);
		for (const d of resources.deployments) ensureNs(d.namespace).deployments.push(d);
		for (const r of resources.replicaSets) ensureNs(r.namespace).replicaSets.push(r);
		for (const d of resources.daemonSets) ensureNs(d.namespace).daemonSets.push(d);
		for (const s of resources.statefulSets) ensureNs(s.namespace).statefulSets.push(s);
		for (const s of resources.services) ensureNs(s.namespace).services.push(s);
		for (const i of resources.ingresses) ensureNs(i.namespace).ingresses.push(i);
		for (const j of resources.jobs) ensureNs(j.namespace).jobs.push(j);
		for (const c of resources.cronJobs) ensureNs(c.namespace).cronJobs.push(c);

		let groups = Array.from(nsMap.values()).sort((a, b) => a.namespace.localeCompare(b.namespace));

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			groups = groups
				.filter((g) => {
					// Match namespace name or any resource name within it
					if (g.namespace.toLowerCase().includes(q)) return true;
					return (
						g.pods.some((p) => p.name.toLowerCase().includes(q)) ||
						g.deployments.some((d) => d.name.toLowerCase().includes(q)) ||
						g.services.some((s) => s.name.toLowerCase().includes(q)) ||
						g.ingresses.some((i) => i.name.toLowerCase().includes(q)) ||
						g.daemonSets.some((d) => d.name.toLowerCase().includes(q)) ||
						g.statefulSets.some((s) => s.name.toLowerCase().includes(q)) ||
						g.replicaSets.some((r) => r.name.toLowerCase().includes(q)) ||
						g.jobs.some((j) => j.name.toLowerCase().includes(q)) ||
						g.cronJobs.some((c) => c.name.toLowerCase().includes(q))
					);
				});
		}

		return groups;
	});

	const detailGroup = $derived(namespaceGroups.find((g) => g.namespace === detailNs) || null);

	// ── Stats ───────────────────────────────────────────────────────────────

	const totalPods = $derived(resources?.pods.length || 0);
	const runningPods = $derived(resources?.pods.filter((p) => p.phase === 'Running').length || 0);
	const totalDeployments = $derived(resources?.deployments.length || 0);
	const totalServices = $derived(resources?.services.length || 0);
	const totalNamespaces = $derived(namespaceGroups.length);

	// ── Data fetching ───────────────────────────────────────────────────────

	async function fetchResources() {
		if (!activeCluster) return;
		loading = true;
		error = null;
		try {
			const ns = selectedNamespace === 'all' ? 'all' : selectedNamespace;
			const res = await fetch(`/api/clusters/${activeCluster.id}/resource-map?namespace=${ns}`);
			const data = await res.json();
			if (!data.success) {
				error = data.error || 'Failed to load resources';
				return;
			}
			resources = data.data;
			const nsSet = new Set<string>();
			for (const p of data.data.pods) nsSet.add(p.namespace);
			for (const d of data.data.deployments) nsSet.add(d.namespace);
			for (const s of data.data.services) nsSet.add(s.namespace);
			namespaces = Array.from(nsSet).sort();
		} catch (err) {
			console.error('[ResourceMap] Failed to fetch:', err);
			error = 'Failed to connect to cluster';
		} finally {
			loading = false;
		}
	}

	// ── Relationship helpers ────────────────────────────────────────────────

	function podsForDeployment(dep: DiagramDeployment, group: NamespaceGroup): DiagramPod[] {
		return group.pods.filter((p) => {
			if (p.ownerKind === 'ReplicaSet') {
				return group.replicaSets.some((r) => r.name === p.ownerName && r.ownerName === dep.name);
			}
			return false;
		});
	}

	function servicesForLabels(labels: Record<string, string>, group: NamespaceGroup): DiagramService[] {
		if (!labels || Object.keys(labels).length === 0) return [];
		return group.services.filter((svc) => {
			if (!svc.selector || Object.keys(svc.selector).length === 0) return false;
			return Object.entries(svc.selector).every(([k, v]) => labels[k] === v);
		});
	}

	function selectResource(kind: string, name: string, namespace: string, data: any) {
		selectedResource = { kind, name, namespace, data };
	}

	function closeResource() {
		selectedResource = null;
	}

	function openDetail(ns: string) {
		updateUrl({ view: 'detail', ns });
	}

	function switchView(mode: 'overview' | 'detail') {
		if (mode === 'overview') {
			updateUrl({ view: null, ns: null });
		} else {
			const ns = detailNs || (namespaceGroups.length > 0 ? namespaceGroups[0].namespace : null);
			updateUrl({ view: 'detail', ns });
		}
	}

	function truncate(str: string, len: number): string {
		return str.length > len ? str.slice(0, len) + '...' : str;
	}

	function nsResourceCount(g: NamespaceGroup): number {
		return g.pods.length + g.deployments.length + g.replicaSets.length +
			g.daemonSets.length + g.statefulSets.length + g.services.length +
			g.ingresses.length + g.jobs.length + g.cronJobs.length;
	}

	function nsHealth(g: NamespaceGroup): 'healthy' | 'degraded' | 'unhealthy' | 'idle' {
		if (g.pods.length === 0) return 'idle';
		if (g.pods.some((p) => p.phase === 'Failed')) return 'unhealthy';
		if (g.pods.some((p) => p.phase === 'Pending')) return 'degraded';
		return 'healthy';
	}

	function podDistribution(pods: DiagramPod[]) {
		const running = pods.filter((p) => p.phase === 'Running').length;
		const pending = pods.filter((p) => p.phase === 'Pending').length;
		const failed = pods.filter((p) => p.phase === 'Failed').length;
		const other = pods.length - running - pending - failed;
		return { running, pending, failed, other, total: pods.length };
	}

	function linkedServiceNames(group: NamespaceGroup): Set<string> {
		const linked = new Set<string>();
		for (const dep of group.deployments) {
			for (const svc of servicesForLabels(dep.selector, group)) {
				linked.add(svc.name);
			}
		}
		return linked;
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	$effect(() => {
		if (activeCluster) {
			fetchResources();
		}
	});
</script>

<svelte:head>
	<title>Resource Map - AutoKube</title>
</svelte:head>

<div class="space-y-6">
	<!-- ━━━ Header ━━━ -->
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<h1 class="text-lg font-semibold tracking-tight">
				{#if viewMode === 'detail' && detailNs}
					{detailNs}
				{:else}
					Resource Map
				{/if}
			</h1>

			{#if resources}
				<div class="hidden items-center gap-2 sm:flex">
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						<span class="size-1.5 rounded-full bg-emerald-500"></span>
						{runningPods}/{totalPods} pods
					</Badge>
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						{totalDeployments} deploys
					</Badge>
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						{totalServices} services
					</Badge>
					<Badge variant="outline" class="gap-1.5 text-xs tabular-nums font-normal">
						{totalNamespaces} ns
					</Badge>
				</div>
			{/if}
		</div>

		<div class="flex items-center gap-2">
			{#if viewMode === 'overview'}
				<div class="relative hidden sm:block">
					<Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						class="h-8 w-48 rounded-md border bg-transparent pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						placeholder="Search namespaces..."
						bind:value={searchQuery}
					/>
				</div>
			{:else}
				<Select.Root
					type="single"
					value={detailNs ?? ''}
					onValueChange={(v: string) => {
						if (v) updateUrl({ ns: v });
					}}
				>
					<Select.Trigger class="h-8 w-44 text-xs">
						{detailNs || 'Select namespace'}
					</Select.Trigger>
					<Select.Content>
						{#each namespaces as ns}
							<Select.Item value={ns}>{ns}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- View toggle -->
			<div class="flex items-center rounded-md border bg-muted/40 p-0.5">
				<button
					class={cn(
						'inline-flex size-7 items-center justify-center rounded transition-colors',
						viewMode === 'overview'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					title="Overview"
					onclick={() => switchView('overview')}
				>
					<LayoutGrid class="size-3.5" />
				</button>
				<button
					class={cn(
						'inline-flex size-7 items-center justify-center rounded transition-colors',
						viewMode === 'detail'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground'
					)}
					title="Detail view"
					onclick={() => switchView('detail')}
				>
					<GanttChart class="size-3.5" />
				</button>
			</div>

			<Button
				variant="outline"
				size="sm"
				class="h-8 gap-1.5 text-xs"
				onclick={fetchResources}
				disabled={loading}
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
				Refresh
			</Button>
		</div>
	</div>

	<!-- ━━━ Main Content ━━━ -->
	<div>
		{#if loading && !resources}
			<div class="flex h-full items-center justify-center">
				<div class="flex flex-col items-center gap-3">
					<RefreshCw class="size-8 animate-spin text-muted-foreground" />
					<p class="text-sm text-muted-foreground">Loading cluster resources...</p>
				</div>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<div class="flex flex-col items-center gap-3 text-center">
					<AlertCircle class="size-12 text-destructive/50" />
					<p class="text-lg font-medium">Failed to load resources</p>
					<p class="text-sm text-muted-foreground">{error}</p>
					<Button variant="outline" size="sm" onclick={fetchResources}>Retry</Button>
				</div>
			</div>
		{:else if !activeCluster}
			<div class="flex h-full items-center justify-center">
				<div class="flex flex-col items-center gap-3 text-center">
					<Server class="size-12 text-muted-foreground/50" />
					<p class="text-lg font-medium">No cluster selected</p>
					<p class="text-sm text-muted-foreground">Select a cluster from the status bar to view resources</p>
				</div>
			</div>
		{:else if resources && namespaceGroups.length === 0}
			<div class="flex h-full items-center justify-center">
				<div class="flex flex-col items-center gap-3 text-center">
					<Box class="size-12 text-muted-foreground/50" />
					<p class="text-lg font-medium">No resources found</p>
					<p class="text-sm text-muted-foreground">
						{searchQuery ? 'Try adjusting your search' : 'This cluster appears to be empty'}
					</p>
				</div>
			</div>

			<!-- ━━━ OVERVIEW MODE ━━━ -->
		{:else if viewMode === 'overview'}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
				{#each namespaceGroups as group (group.namespace)}
					{@const health = nsHealth(group)}
					{@const dist = podDistribution(group.pods)}
					{@const workloads =
						group.deployments.length + group.daemonSets.length + group.statefulSets.length}
					<button
						class={cn(
							'group relative flex flex-col rounded-lg border bg-card text-left transition-all hover:bg-accent/50',
							health === 'unhealthy' && 'border-red-500/30',
							health === 'degraded' && 'border-amber-500/30'
						)}
						onclick={() => openDetail(group.namespace)}
					>
						<!-- Header with health + name + chevron -->
						<div class="flex items-center gap-2 px-3.5 pt-3 pb-2">
							<span class={cn('size-2 shrink-0 rounded-full', healthDot(health))}></span>
							<span class="flex-1 truncate text-sm font-medium">{group.namespace}</span>
							<ChevronRight
								class="size-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
							/>
						</div>

						<!-- Inline resource badges -->
						<div class="flex flex-wrap gap-1.5 px-3.5 pb-3">
							<span class="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
								<Box class="size-2.5 text-sky-400" />
								{dist.total}
							</span>
							{#if workloads > 0}
								<span class="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
									<Layers class="size-2.5 text-violet-400" />
									{workloads}
								</span>
							{/if}
							{#if group.services.length > 0}
								<span class="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
									<Network class="size-2.5 text-emerald-400" />
									{group.services.length}
								</span>
							{/if}
							{#if group.ingresses.length > 0}
								<span class="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
									<Globe class="size-2.5 text-amber-400" />
									{group.ingresses.length}
								</span>
							{/if}
							{#if group.cronJobs.length > 0}
								<span class="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
									<Calendar class="size-2.5 text-rose-400" />
									{group.cronJobs.length}
								</span>
							{/if}
						</div>

						<!-- Pod status footer -->
						{#if dist.total > 0}
							<div class="flex items-center gap-2 border-t px-3.5 py-2">
								<div class="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
									{#if dist.running > 0}
										<div class="bg-emerald-500" style="width: {(dist.running / dist.total) * 100}%"></div>
									{/if}
									{#if dist.pending > 0}
										<div class="bg-amber-500" style="width: {(dist.pending / dist.total) * 100}%"></div>
									{/if}
									{#if dist.failed > 0}
										<div class="bg-red-500" style="width: {(dist.failed / dist.total) * 100}%"></div>
									{/if}
									{#if dist.other > 0}
										<div class="bg-zinc-500" style="width: {(dist.other / dist.total) * 100}%"></div>
									{/if}
								</div>
								<span class="text-[10px] tabular-nums text-muted-foreground">{dist.running}/{dist.total}</span>
							</div>
						{/if}
					</button>
				{/each}
			</div>

			<!-- ━━━ DETAIL MODE ━━━ -->
		{:else if viewMode === 'detail' && detailGroup}
			{@const dGroup = detailGroup}
			{@const dHealth = nsHealth(dGroup)}
			{@const dDist = podDistribution(dGroup.pods)}
			<div class="space-y-6">
				<!-- Namespace stats -->
				<div class="flex flex-wrap items-center gap-3">
					<span class={cn('size-3 rounded-full', healthDot(dHealth))}></span>
					<span class="text-sm capitalize text-muted-foreground">{dHealth}</span>
					<Separator orientation="vertical" class="h-4" />
					<span class="text-sm tabular-nums text-muted-foreground"
						>{dDist.running}/{dDist.total} pods running</span
					>
					<Separator orientation="vertical" class="h-4" />
					<span class="text-sm text-muted-foreground"
						>{dGroup.deployments.length} deployments · {dGroup.services.length} services</span
					>
				</div>

				<!-- ── Ingresses section ── -->
				{#if dGroup.ingresses.length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<Globe class="size-4 text-amber-400" />
							<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Ingresses
							</h2>
							<Badge variant="secondary" class="px-1.5 py-0 text-[10px]"
								>{dGroup.ingresses.length}</Badge
							>
						</div>
						<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{#each dGroup.ingresses as ing (ing.name)}
								<button
									class="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-3 text-left transition-colors hover:bg-amber-950/20"
									onclick={() => selectResource('Ingress', ing.name, dGroup.namespace, ing)}
								>
									<Globe class="mt-0.5 size-4 shrink-0 text-amber-400" />
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium text-amber-300">{ing.name}</p>
										{#if ing.hosts.length > 0}
											<div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
												{#each ing.hosts as host}
													<!-- svelte-ignore a11y_no_static_element_interactions -->
													<a
														href="{ing.tls ? 'https' : 'http'}://{host}"
														target="_blank"
														rel="noopener noreferrer"
														class="truncate text-xs text-amber-400/70 underline decoration-amber-400/30 hover:text-amber-300 hover:decoration-amber-300/50"
														onclick={(e) => e.stopPropagation()}
													>{host}</a>
												{/each}
											</div>
										{:else}
											<p class="mt-0.5 text-xs text-muted-foreground">no host</p>
										{/if}
										{#if ing.backends.length > 0}
											<div class="mt-1.5 flex flex-wrap gap-1">
												{#each ing.backends as b}
													<Badge
														variant="outline"
														class="border-amber-700/30 px-1.5 py-0 text-[10px] text-amber-400/80"
													>
														→ {b.serviceName}:{b.servicePort}
													</Badge>
												{/each}
											</div>
										{/if}
									</div>
									{#if ing.tls}
										<Shield class="size-3.5 shrink-0 text-amber-400/60" />
									{/if}
								</button>
							{/each}
						</div>
					</section>
				{/if}

				<!-- ── Workload rows: Service → Workload → Pods ── -->
				{#if dGroup.deployments.length > 0 || dGroup.daemonSets.length > 0 || dGroup.statefulSets.length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<Layers class="size-4 text-violet-400" />
							<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Workloads
							</h2>
							<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">
								{dGroup.deployments.length +
									dGroup.daemonSets.length +
									dGroup.statefulSets.length}
							</Badge>
						</div>

						<div class="space-y-3">
							<!-- Deployments -->
							{#each dGroup.deployments as dep (dep.name)}
								{@const depPods = podsForDeployment(dep, dGroup)}
								{@const depSvcs = servicesForLabels(dep.selector, dGroup)}
								{@const depHealth = healthStatus(dep.readyReplicas, dep.replicas)}
								{@render WorkloadRow({
									kind: 'Deployment',
									name: dep.name,
									icon: Layers,
									iconColor: 'text-violet-400',
									bgColor: 'bg-violet-500/8',
									borderColor: 'border-violet-500/20',
									hoverColor: 'hover:bg-violet-500/15',
									health: depHealth,
									readyText: `${dep.readyReplicas}/${dep.replicas}`,
									pods: depPods,
									services: depSvcs,
									data: dep,
									namespace: dGroup.namespace
								})}
							{/each}

							<!-- DaemonSets -->
							{#each dGroup.daemonSets as ds (ds.name)}
								{@const dsPods = dGroup.pods.filter(
									(p) => p.ownerKind === 'DaemonSet' && p.ownerName === ds.name
								)}
								{@const dsHealth = healthStatus(ds.ready, ds.desired)}
								{@render WorkloadRow({
									kind: 'DaemonSet',
									name: ds.name,
									icon: Server,
									iconColor: 'text-fuchsia-400',
									bgColor: 'bg-fuchsia-500/8',
									borderColor: 'border-fuchsia-500/20',
									hoverColor: 'hover:bg-fuchsia-500/15',
									health: dsHealth,
									readyText: `${ds.ready}/${ds.desired}`,
									pods: dsPods,
									services: [],
									data: ds,
									namespace: dGroup.namespace
								})}
							{/each}

							<!-- StatefulSets -->
							{#each dGroup.statefulSets as ss (ss.name)}
								{@const ssPods = dGroup.pods.filter(
									(p) => p.ownerKind === 'StatefulSet' && p.ownerName === ss.name
								)}
								{@const ssHealth = healthStatus(ss.readyReplicas, ss.replicas)}
								{@render WorkloadRow({
									kind: 'StatefulSet',
									name: ss.name,
									icon: Database,
									iconColor: 'text-purple-400',
									bgColor: 'bg-purple-500/8',
									borderColor: 'border-purple-500/20',
									hoverColor: 'hover:bg-purple-500/15',
									health: ssHealth,
									readyText: `${ss.readyReplicas}/${ss.replicas}`,
									pods: ssPods,
									services: [],
									data: ss,
									namespace: dGroup.namespace
								})}
							{/each}
						</div>
					</section>
				{/if}

				<!-- ── CronJobs ── -->
				{#if dGroup.cronJobs.length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<Calendar class="size-4 text-rose-400" />
							<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								CronJobs
							</h2>
							<Badge variant="secondary" class="px-1.5 py-0 text-[10px]"
								>{dGroup.cronJobs.length}</Badge
							>
						</div>
						<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{#each dGroup.cronJobs as cj (cj.name)}
								{@const cjJobs = dGroup.jobs.filter(
									(j) => j.ownerKind === 'CronJob' && j.ownerName === cj.name
								)}
								<button
									class="flex items-start gap-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-left transition-colors hover:bg-rose-500/10"
									onclick={() => selectResource('CronJob', cj.name, dGroup.namespace, cj)}
								>
									<Calendar class="mt-0.5 size-4 shrink-0 text-rose-400" />
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium text-rose-300">{cj.name}</p>
										<p class="mt-0.5 font-mono text-xs text-muted-foreground">{cj.schedule}</p>
										{#if cjJobs.length > 0}
											<p class="mt-1 text-[11px] text-muted-foreground">
												{cjJobs.length} job(s)
											</p>
										{/if}
									</div>
									{#if cj.suspended}
										<Badge
											variant="outline"
											class="border-zinc-600/40 px-1.5 py-0 text-[10px] text-zinc-400"
											>Paused</Badge
										>
									{/if}
								</button>
							{/each}
						</div>
					</section>
				{/if}

				<!-- ── Standalone Jobs ── -->
				{#if dGroup.jobs.filter((j) => !j.ownerKind).length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<Timer class="size-4 text-orange-400" />
							<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Jobs
							</h2>
							<Badge variant="secondary" class="px-1.5 py-0 text-[10px]"
								>{dGroup.jobs.filter((j) => !j.ownerKind).length}</Badge
							>
						</div>
						<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{#each dGroup.jobs.filter((j) => !j.ownerKind) as job (job.name)}
								<button
									class="flex items-start gap-3 rounded-lg border border-orange-500/20 bg-orange-500/5 px-4 py-3 text-left transition-colors hover:bg-orange-500/10"
									onclick={() => selectResource('Job', job.name, dGroup.namespace, job)}
								>
									<Timer class="mt-0.5 size-4 shrink-0 text-orange-400" />
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium text-orange-300">{job.name}</p>
										<p class="mt-0.5 text-xs text-muted-foreground">
											{job.succeeded > 0
												? `${job.succeeded} succeeded`
												: job.active > 0
													? `${job.active} active`
													: `${job.failed} failed`}
										</p>
									</div>
									<span
										class={cn(
											'mt-1.5 size-2 shrink-0 rounded-full',
											job.succeeded > 0
												? 'bg-emerald-500'
												: job.active > 0
													? 'bg-blue-500'
													: 'bg-red-500'
										)}
									></span>
								</button>
							{/each}
						</div>
					</section>
				{/if}

				<!-- ── Standalone Services ── -->
				{#if dGroup.services.length > 0}
					{@const allLinkedSvcs = linkedServiceNames(dGroup)}
					{@const standaloneSvcs = dGroup.services.filter((s) => !allLinkedSvcs.has(s.name))}
					{#if standaloneSvcs.length > 0}
						<section>
							<div class="mb-3 flex items-center gap-2">
								<Network class="size-4 text-emerald-400" />
								<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									Services
								</h2>
								<Badge variant="secondary" class="px-1.5 py-0 text-[10px]"
									>{standaloneSvcs.length}</Badge
								>
							</div>
							<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{#each standaloneSvcs as svc (svc.name)}
									<button
										class="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-left transition-colors hover:bg-emerald-500/10"
										onclick={() =>
											selectResource('Service', svc.name, dGroup.namespace, svc)}
									>
										<Network class="mt-0.5 size-4 shrink-0 text-emerald-400" />
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium text-emerald-300">
												{svc.name}
											</p>
											<p class="mt-0.5 text-xs text-muted-foreground">
												{svc.type} · {svc.ports.map((p) => `${p.port}`).join(', ')}
											</p>
										</div>
									</button>
								{/each}
							</div>
						</section>
					{/if}
				{/if}

				<!-- ── Orphan pods ── -->
				{#if dGroup.pods.some((p) => !p.ownerKind)}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<Box class="size-4 text-sky-400" />
							<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Standalone Pods
							</h2>
						</div>
						<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each dGroup.pods.filter((p) => !p.ownerKind) as pod (pod.name)}
								<button
									class="flex items-center gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-left transition-colors hover:bg-sky-500/10"
									onclick={() => selectResource('Pod', pod.name, dGroup.namespace, pod)}
								>
									<span class={cn('size-2 rounded-full', podStatusColor(pod.phase))}></span>
									<span class="flex-1 truncate text-xs text-sky-300"
										>{truncate(pod.name, 36)}</span
									>
									<span class="tabular-nums text-[10px] text-muted-foreground"
										>{pod.ready}</span
									>
								</button>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		{:else if viewMode === 'detail' && !detailGroup}
			<div class="flex h-full items-center justify-center">
				<div class="flex flex-col items-center gap-3 text-center">
					<Box class="size-12 text-muted-foreground/50" />
					<p class="text-lg font-medium">Select a namespace</p>
					<p class="text-sm text-muted-foreground">
						Choose a namespace from the dropdown to see its resource diagram
					</p>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- ━━━ Resource Detail Drawer ━━━ -->
{#if selectedResource}
	{@const DrawerIcon = RESOURCE_ICONS[selectedResource.kind.toLowerCase()] || Box}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex justify-end"
		onclick={closeResource}
		onkeydown={(e) => e.key === 'Escape' && closeResource()}
	>
		<div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]"></div>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="relative z-10 flex w-[420px] max-w-[90vw] flex-col border-l bg-card shadow-2xl animate-in slide-in-from-right"
			onclick={(e: MouseEvent) => e.stopPropagation()}
		>
			<div class="flex items-center gap-3 border-b px-5 py-4">
				<DrawerIcon class="size-5 shrink-0 text-muted-foreground" />
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-semibold">{selectedResource.name}</p>
					<p class="text-xs text-muted-foreground">
						{selectedResource.kind} · {selectedResource.namespace}
					</p>
				</div>
				<button
					class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
					onclick={closeResource}
				>
					<X class="size-4" />
				</button>
			</div>

			<div class="flex-1 space-y-3 overflow-y-auto p-5">
				{#if selectedResource.kind === 'Pod'}
					{@const pod = selectedResource.data as DiagramPod}
					{@render DetailRow({ label: 'Status', value: pod.phase })}
					{@render DetailRow({ label: 'Ready', value: pod.ready })}
					{@render DetailRow({ label: 'Restarts', value: String(pod.restarts) })}
					{#if pod.nodeName}
						{@render DetailRow({ label: 'Node', value: pod.nodeName })}
					{/if}
					{#if pod.ownerKind}
						{@render DetailRow({ label: 'Owner', value: `${pod.ownerKind}/${pod.ownerName}` })}
					{/if}
					{#if Object.keys(pod.labels).length > 0}
						{@render LabelSection({
							title: 'Labels',
							entries: Object.entries(pod.labels).slice(0, 10)
						})}
					{/if}
				{:else if selectedResource.kind === 'Deployment'}
					{@const dep = selectedResource.data as DiagramDeployment}
					{@render DetailRow({
						label: 'Replicas',
						value: `${dep.readyReplicas}/${dep.replicas} ready`
					})}
					{@render DetailRow({ label: 'Available', value: String(dep.availableReplicas) })}
					{#if Object.keys(dep.selector).length > 0}
						{@render LabelSection({
							title: 'Selector',
							entries: Object.entries(dep.selector)
						})}
					{/if}
				{:else if selectedResource.kind === 'Service'}
					{@const svc = selectedResource.data as DiagramService}
					{@render DetailRow({ label: 'Type', value: svc.type })}
					{#if svc.clusterIP}
						{@render DetailRow({ label: 'Cluster IP', value: svc.clusterIP })}
					{/if}
					{#if svc.ports.length > 0}
						<div>
							<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Ports
							</p>
							<div class="space-y-1.5">
								{#each svc.ports as port}
									<div class="flex items-center gap-2 text-xs">
										<Badge variant="outline" class="px-1.5 py-0 text-[10px]"
											>{port.port}</Badge
										>
										<ArrowRight class="size-3 text-muted-foreground" />
										<Badge variant="outline" class="px-1.5 py-0 text-[10px]"
											>{port.targetPort}</Badge
										>
										<span class="text-[10px] text-muted-foreground"
											>{port.protocol || 'TCP'}</span
										>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if Object.keys(svc.selector).length > 0}
						{@render LabelSection({
							title: 'Selector',
							entries: Object.entries(svc.selector)
						})}
					{/if}
				{:else if selectedResource.kind === 'Ingress'}
					{@const ing = selectedResource.data as DiagramIngress}
					{@render DetailRow({ label: 'TLS', value: ing.tls ? 'Yes' : 'No' })}
					{#if ing.hosts.length > 0}
						<div>
							<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Hosts
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each ing.hosts as host}
									<a
										href="{ing.tls ? 'https' : 'http'}://{host}"
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-foreground underline decoration-muted-foreground/30 hover:bg-secondary/80 hover:decoration-foreground/50"
									>
										{host}
										<Globe class="size-2.5 text-muted-foreground" />
									</a>
								{/each}
							</div>
						</div>
					{/if}
					{#if ing.backends.length > 0}
						<div>
							<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Backends
							</p>
							{#each ing.backends as backend}
								<div class="text-xs text-muted-foreground">
									{backend.path || '/'} → {backend.serviceName}:{backend.servicePort}
								</div>
							{/each}
						</div>
					{/if}
				{:else if selectedResource.kind === 'DaemonSet'}
					{@const ds = selectedResource.data as DiagramDaemonSet}
					{@render DetailRow({ label: 'Desired', value: String(ds.desired) })}
					{@render DetailRow({ label: 'Ready', value: String(ds.ready) })}
					{@render DetailRow({ label: 'Available', value: String(ds.available) })}
				{:else if selectedResource.kind === 'StatefulSet'}
					{@const ss = selectedResource.data as DiagramStatefulSet}
					{@render DetailRow({
						label: 'Replicas',
						value: `${ss.readyReplicas}/${ss.replicas} ready`
					})}
				{:else if selectedResource.kind === 'CronJob'}
					{@const cj = selectedResource.data as DiagramCronJob}
					{@render DetailRow({ label: 'Schedule', value: cj.schedule })}
					{@render DetailRow({ label: 'Suspended', value: cj.suspended ? 'Yes' : 'No' })}
				{:else if selectedResource.kind === 'Job'}
					{@const job = selectedResource.data as DiagramJob}
					{@render DetailRow({ label: 'Succeeded', value: String(job.succeeded) })}
					{@render DetailRow({ label: 'Failed', value: String(job.failed) })}
					{@render DetailRow({ label: 'Active', value: String(job.active) })}
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ━━━ Snippets ━━━ -->

{#snippet DetailRow(props: { label: string; value: string })}
	<div class="flex items-center justify-between py-1">
		<span class="text-xs text-muted-foreground">{props.label}</span>
		<span class="text-xs font-medium">{props.value}</span>
	</div>
{/snippet}

{#snippet LabelSection(props: { title: string; entries: [string, string][] })}
	<div>
		<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
			{props.title}
		</p>
		<div class="flex flex-wrap gap-1">
			{#each props.entries as [k, v]}
				<Badge variant="secondary" class="px-1.5 py-0 text-[10px]"
					>{k}={truncate(v, 20)}</Badge
				>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet WorkloadRow(props: {
	kind: string;
	name: string;
	icon: typeof Box;
	iconColor: string;
	bgColor: string;
	borderColor: string;
	hoverColor: string;
	health: 'healthy' | 'degraded' | 'unhealthy' | 'idle';
	readyText: string;
	pods: DiagramPod[];
	services: DiagramService[];
	data: any;
	namespace: string;
})}
	{@const WlIcon = props.icon}
	<div class={cn('overflow-hidden rounded-xl border', props.borderColor, healthBorder(props.health))}>
		<!-- Workload header row: [services] → [workload] → [pod summary] -->
		<div class="flex items-stretch">
			<!-- Services column -->
			{#if props.services.length > 0}
				<div
					class="flex min-w-[180px] flex-col justify-center gap-1 border-r border-dashed border-border/50 px-3 py-2.5"
				>
					{#each props.services as svc}
						<button
							class="flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-emerald-500/10"
							onclick={() => selectResource('Service', svc.name, props.namespace, svc)}
						>
							<Network class="size-3 shrink-0 text-emerald-400" />
							<span class="truncate text-[11px] text-emerald-300"
								>{truncate(svc.name, 22)}</span
							>
							<span class="ml-auto text-[10px] text-muted-foreground"
								>{svc.ports.map((p) => p.port).join(',')}</span
							>
						</button>
					{/each}
				</div>
				<div class="flex items-center px-1">
					<ArrowRight class="size-3.5 text-muted-foreground/50" />
				</div>
			{/if}

			<!-- Workload main -->
			<button
				class={cn(
					'flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors',
					props.bgColor,
					props.hoverColor
				)}
				onclick={() => selectResource(props.kind, props.name, props.namespace, props.data)}
			>
				<span class={cn('size-2.5 rounded-full', healthDot(props.health))}></span>
				<WlIcon class={cn('size-4 shrink-0', props.iconColor)} />
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{props.name}</p>
					<p class="text-[11px] text-muted-foreground">{props.kind}</p>
				</div>
				<Badge
					variant="outline"
					class={cn(
						'shrink-0 px-2 py-0 text-[10px] tabular-nums',
						props.health === 'healthy'
							? 'border-emerald-500/30 text-emerald-400'
							: props.health === 'degraded'
								? 'border-amber-500/30 text-amber-400'
								: props.health === 'unhealthy'
									? 'border-red-500/30 text-red-400'
									: 'border-zinc-500/30 text-zinc-400'
					)}
				>
					{props.readyText}
				</Badge>
			</button>

			<!-- Pod summary column -->
			{#if props.pods.length > 0}
				<div class="flex items-center px-1">
					<ArrowRight class="size-3.5 text-muted-foreground/50" />
				</div>
				<div class="flex items-center gap-1 px-3 py-2.5">
					<div class="flex max-w-[200px] flex-wrap gap-1">
						{#each props.pods.slice(0, 20) as pod}
							<button
								class={cn(
									'size-3 rounded-sm transition-all hover:scale-150',
									podStatusColor(pod.phase)
								)}
								title="{pod.name} ({pod.phase})"
								onclick={() => selectResource('Pod', pod.name, props.namespace, pod)}
							></button>
						{/each}
						{#if props.pods.length > 20}
							<span class="ml-1 text-[10px] text-muted-foreground"
								>+{props.pods.length - 20}</span
							>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Expanded pod list (when ≤ 8 pods, show inline) -->
		{#if props.pods.length > 0 && props.pods.length <= 8}
			<div class="border-t border-dashed border-border/30 bg-black/10 px-3 py-2">
				<div class="flex flex-wrap gap-1.5">
					{#each props.pods as pod (pod.name)}
						<button
							class="flex items-center gap-1.5 rounded-md border border-border/30 bg-background/30 px-2 py-1 text-left transition-colors hover:bg-background/50"
							onclick={() => selectResource('Pod', pod.name, props.namespace, pod)}
						>
							<span class={cn('size-1.5 rounded-full', podStatusColor(pod.phase))}></span>
							<span class="max-w-[140px] truncate text-[10px]">{pod.name}</span>
							<span class="tabular-nums text-[9px] text-muted-foreground">{pod.ready}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/snippet}
