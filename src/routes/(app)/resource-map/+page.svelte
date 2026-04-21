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
		CircleAlert,
		Search,
		ArrowRight,
		ChevronRight,
		X,
		LayoutGrid,
		ChartGantt,
		Shield,
		Radio
	} from 'lucide-svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { useResourceWatch } from '$lib/hooks/use-resource-watch.svelte';

	// ── Types ────────────────────────────────────────────────────────────────

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

	// ── State ────────────────────────────────────────────────────────────────

	const activeCluster = $derived(clusterStore.active);

	// Live resource arrays — updated in real-time by SSE watches
	let pods = $state<DiagramPod[]>([]);
	let deployments = $state<DiagramDeployment[]>([]);
	let replicaSets = $state<DiagramReplicaSet[]>([]);
	let daemonSets = $state<DiagramDaemonSet[]>([]);
	let statefulSets = $state<DiagramStatefulSet[]>([]);
	let services = $state<DiagramService[]>([]);
	let ingresses = $state<DiagramIngress[]>([]);
	let cronJobs = $state<DiagramCronJob[]>([]);

	let connecting = $state(true);
	let liveError = $state<string | null>(null);
	let searchQuery = $state('');
	let reconnectKey = $state(0);

	// URL-driven state
	const viewMode = $derived((page.url.searchParams.get('view') as 'overview' | 'detail') || 'overview');
	const detailNs = $derived(page.url.searchParams.get('ns') || null);

	// Drawer state
	let selectedResource = $state<{ kind: string; name: string; namespace: string; data: any } | null>(null);

	// ── Resource icons ───────────────────────────────────────────────────────

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

	// ── Transform: raw K8s object → diagram type ────────────────────────────

	// SSE delivers already-transformed flat objects (not raw K8s objects).
	// Read from the flat structure that each transformer in +server.ts produces.

	function toPod(r: any): DiagramPod {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			phase: r.phase ?? 'Unknown',
			ready: r.ready ?? '0/0',
			restarts: r.restarts ?? 0,
			nodeName: r.node,
			labels: r.labels ?? {},
			ownerKind: r.ownerKind,
			ownerName: r.ownerName,
			uid: r.uid
		};
	}

	function toDeployment(r: any): DiagramDeployment {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			replicas: r.replicas ?? 0,
			readyReplicas: r.readyReplicas ?? 0,
			availableReplicas: r.availableReplicas ?? 0,
			labels: r.labels ?? {},
			selector: r.selector ?? {},
			uid: r.uid
		};
	}

	function toReplicaSet(r: any): DiagramReplicaSet {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			replicas: r.desired ?? 0,
			readyReplicas: r.ready ?? 0,
			ownerKind: r.ownerKind,
			ownerName: r.ownerName,
			uid: r.uid
		};
	}

	function toDaemonSet(r: any): DiagramDaemonSet {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			desired: r.desired ?? 0,
			ready: r.ready ?? 0,
			available: r.available ?? 0,
			uid: r.uid
		};
	}

	function toStatefulSet(r: any): DiagramStatefulSet {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			replicas: r.replicas ?? 0,
			readyReplicas: r.readyReplicas ?? 0,
			uid: r.uid
		};
	}

	function toService(r: any): DiagramService {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			type: r.type ?? 'ClusterIP',
			clusterIP: r.clusterIP,
			ports: (r.ports ?? []).map((p: any) => ({
				port: p.port,
				targetPort: p.targetPort,
				protocol: p.protocol
			})),
			selector: r.selector ?? {},
			uid: r.uid
		};
	}

	function toIngress(r: any): DiagramIngress {
		// transformIngress returns r.paths[]{path,pathType,host,backend:{service,port}}
		const backends = (r.paths ?? []).map((p: any) => ({
			path: p.path,
			serviceName: p.backend?.service,
			servicePort: typeof p.backend?.port === 'number' ? p.backend.port : undefined
		}));
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			hosts: r.hosts ?? [],
			backends,
			tls: (r.tls ?? []).length > 0,
			uid: r.uid
		};
	}

	function toCronJob(r: any): DiagramCronJob {
		return {
			name: r.name ?? '',
			namespace: r.namespace ?? 'default',
			schedule: r.schedule ?? '',
			suspended: r.suspend ?? false,
			uid: r.uid
		};
	}

	// ── Key helpers ──────────────────────────────────────────────────────────

	function rkey(ns: string, name: string) {
		return `${ns}/${name}`;
	}

	// ── Derived: namespace groups from live arrays ───────────────────────────

	const namespaceGroups = $derived.by(() => {
		const nsMap = new Map<string, NamespaceGroup>();

		function getNs(ns: string): NamespaceGroup {
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

		for (const p of pods) getNs(p.namespace).pods.push(p);
		for (const d of deployments) getNs(d.namespace).deployments.push(d);
		for (const r of replicaSets) getNs(r.namespace).replicaSets.push(r);
		for (const d of daemonSets) getNs(d.namespace).daemonSets.push(d);
		for (const s of statefulSets) getNs(s.namespace).statefulSets.push(s);
		for (const s of services) getNs(s.namespace).services.push(s);
		for (const i of ingresses) getNs(i.namespace).ingresses.push(i);
		for (const c of cronJobs) getNs(c.namespace).cronJobs.push(c);

		let groups = [...nsMap.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			groups = groups.filter(
				(g) =>
					g.namespace.toLowerCase().includes(q) ||
					g.pods.some((p) => p.name.toLowerCase().includes(q)) ||
					g.deployments.some((d) => d.name.toLowerCase().includes(q)) ||
					g.services.some((s) => s.name.toLowerCase().includes(q))
			);
		}

		return groups;
	});

	const detailGroup = $derived(namespaceGroups.find((g) => g.namespace === detailNs) ?? null);
	const namespaces = $derived(namespaceGroups.map((g) => g.namespace));

	// ── Stats ────────────────────────────────────────────────────────────────

	const totalPods = $derived(pods.length);
	const runningPods = $derived(pods.filter((p) => p.phase === 'Running').length);
	const totalDeployments = $derived(deployments.length);
	const totalServices = $derived(services.length);
	const totalNamespaces = $derived(namespaceGroups.length);

	// ── SSE watch setup ──────────────────────────────────────────────────────

	$effect(() => {
		const cluster = activeCluster;
		void reconnectKey; // read to make $effect reactive to reconnectKey changes
		if (!cluster) return;

		// Clear all state on cluster change / reconnect
		pods = [];
		deployments = [];
		replicaSets = [];
		daemonSets = [];
		statefulSets = [];
		services = [];
		ingresses = [];
		cronJobs = [];
		connecting = true;
		liveError = null;

		let gotFirst = false;
		function onFirst() {
			if (!gotFirst) {
				gotFirst = true;
				connecting = false;
			}
		}

		const cid = cluster.id;

		// Generic watch factory for any resource type backed by an array
		function makeWatch<T extends { name: string; namespace: string }>(
			type: string,
			transform: (raw: any) => T,
			getter: () => T[],
			setter: (v: T[]) => void,
			signalFirst = false
		) {
			return useResourceWatch<any>({
				clusterId: cid,
				resourceType: type,
				onAdded(raw) {
					const item = transform(raw);
					const k = rkey(item.namespace, item.name);
					setter([...getter().filter((x) => rkey(x.namespace, x.name) !== k), item]);
					if (signalFirst) onFirst();
				},
				onModified(raw) {
					const item = transform(raw);
					const k = rkey(item.namespace, item.name);
					setter(getter().map((x) => (rkey(x.namespace, x.name) === k ? item : x)));
				},
				onDeleted(raw) {
					const k = rkey(raw.metadata?.namespace ?? '', raw.metadata?.name ?? '');
					setter(getter().filter((x) => rkey(x.namespace, x.name) !== k));
				},
				onError() {
					liveError = `Watch connection lost for ${type}`;
				}
			});
		}

		const ws = [
			makeWatch('pods', toPod, () => pods, (v) => { pods = v; }, true),
			makeWatch('deployments', toDeployment, () => deployments, (v) => { deployments = v; }, true),
			makeWatch('services', toService, () => services, (v) => { services = v; }, true),
			makeWatch('daemonsets', toDaemonSet, () => daemonSets, (v) => { daemonSets = v; }),
			makeWatch('statefulsets', toStatefulSet, () => statefulSets, (v) => { statefulSets = v; }),
			makeWatch('ingresses', toIngress, () => ingresses, (v) => { ingresses = v; }),
			makeWatch('cronjobs', toCronJob, () => cronJobs, (v) => { cronJobs = v; }),
			makeWatch('replicasets', toReplicaSet, () => replicaSets, (v) => { replicaSets = v; })
		];

		ws.forEach((w) => w.subscribe());
		return () => ws.forEach((w) => w.unsubscribe());
	});

	function reconnect() {
		reconnectKey++;
	}

	// ── Status helpers ───────────────────────────────────────────────────────

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

	function nsHealth(g: NamespaceGroup): 'healthy' | 'degraded' | 'unhealthy' | 'idle' {
		if (g.pods.length === 0) return 'idle';
		if (g.pods.some((p) => p.phase === 'Failed')) return 'unhealthy';
		if (g.pods.some((p) => p.phase === 'Pending')) return 'degraded';
		return 'healthy';
	}

	function podDistribution(podList: DiagramPod[]) {
		const running = podList.filter((p) => p.phase === 'Running').length;
		const pending = podList.filter((p) => p.phase === 'Pending').length;
		const failed = podList.filter((p) => p.phase === 'Failed').length;
		const other = podList.length - running - pending - failed;
		return { running, pending, failed, other, total: podList.length };
	}

	// ── Relationship helpers ─────────────────────────────────────────────────

	function podsForDeployment(dep: DiagramDeployment, group: NamespaceGroup): DiagramPod[] {
		// Try via ReplicaSet owner chain first
		const viaRs = group.pods.filter(
			(p) =>
				p.ownerKind === 'ReplicaSet' &&
				group.replicaSets.some((r) => r.name === p.ownerName && r.ownerName === dep.name)
		);
		if (viaRs.length > 0) return viaRs;
		// Fall back to direct label selector match
		if (!dep.selector || Object.keys(dep.selector).length === 0) return [];
		return group.pods.filter(
			(p) =>
				p.ownerKind === 'ReplicaSet' &&
				Object.entries(dep.selector).every(([k, v]) => p.labels[k] === v)
		);
	}

	function servicesForLabels(labels: Record<string, string>, group: NamespaceGroup): DiagramService[] {
		if (!labels || Object.keys(labels).length === 0) return [];
		return group.services.filter((svc) => {
			if (!svc.selector || Object.keys(svc.selector).length === 0) return false;
			return Object.entries(svc.selector).every(([k, v]) => labels[k] === v);
		});
	}

	function linkedServiceNames(group: NamespaceGroup): Set<string> {
		const linked = new Set<string>();
		for (const dep of group.deployments) {
			for (const svc of servicesForLabels(dep.selector, group)) linked.add(svc.name);
		}
		return linked;
	}

	// ── URL helpers ──────────────────────────────────────────────────────────

	function updateUrl(params: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(params)) {
			if (value === null) url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		goto(url.pathname + url.search, { replaceState: false, noScroll: true });
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

	function selectResource(kind: string, name: string, namespace: string, data: any) {
		selectedResource = { kind, name, namespace, data };
	}

	function closeResource() {
		selectedResource = null;
	}

	function truncate(str: string, len: number): string {
		return str.length > len ? str.slice(0, len) + '…' : str;
	}
</script>

<svelte:head>
	<title>Resource Map - AutoKube</title>
</svelte:head>

{#snippet NsCard(group: NamespaceGroup)}
	{@const health = nsHealth(group)}
	{@const dist = podDistribution(group.pods)}
	{@const workloads = group.deployments.length + group.daemonSets.length + group.statefulSets.length}
	<button
		class={cn(
			'group flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-md',
			health === 'unhealthy' ? 'border-red-500/40 hover:border-red-500/60' :
			health === 'degraded'  ? 'border-amber-500/40 hover:border-amber-500/60' :
			'border-border hover:border-border/80'
		)}
		onclick={() => openDetail(group.namespace)}
	>
		<!-- Card header -->
		<div class={cn(
			'flex items-center gap-2.5 px-4 py-3',
			health === 'unhealthy' ? 'bg-red-500/5' :
			health === 'degraded'  ? 'bg-amber-500/5' :
			'bg-muted/20'
		)}>
			<span class={cn('size-2 shrink-0 rounded-full ring-2', healthDot(health),
				health === 'unhealthy' ? 'ring-red-500/20' :
				health === 'degraded'  ? 'ring-amber-500/20' :
				health === 'healthy'   ? 'ring-emerald-500/20' :
				'ring-zinc-500/20'
			)}></span>
			<code class="flex-1 truncate font-mono text-sm font-semibold">{group.namespace}</code>
			<span class={cn(
				'shrink-0 font-mono text-xs tabular-nums',
				dist.failed > 0  ? 'text-red-400' :
				dist.pending > 0 ? 'text-amber-400' :
				dist.total === 0 ? 'text-muted-foreground/30' :
				'text-emerald-400'
			)}>{dist.running}/{dist.total}</span>
		</div>

		<!-- Pod visualization -->
		<div class="min-h-12 px-4 py-3">
			{#if dist.total === 0}
				<p class="text-xs text-muted-foreground/30 italic">no pods</p>
			{:else if dist.total <= 40}
				<div class="flex flex-wrap gap-1">
					{#each group.pods as pod}
						<span
							class={cn('size-2.5 shrink-0 rounded-sm transition-transform group-hover:scale-105', podStatusColor(pod.phase))}
							title="{pod.name} · {pod.phase}"
						></span>
					{/each}
				</div>
			{:else}
				<div class="space-y-1.5">
					<div class="flex h-3 overflow-hidden rounded-md bg-muted">
						{#if dist.running > 0}<div class="bg-emerald-500 transition-all" style="width:{(dist.running / dist.total) * 100}%"></div>{/if}
						{#if dist.pending > 0}<div class="bg-amber-500 transition-all" style="width:{(dist.pending / dist.total) * 100}%"></div>{/if}
						{#if dist.failed > 0}<div class="bg-red-500 transition-all" style="width:{(dist.failed / dist.total) * 100}%"></div>{/if}
						{#if dist.other > 0}<div class="bg-zinc-600 transition-all" style="width:{(dist.other / dist.total) * 100}%"></div>{/if}
					</div>
					<div class="flex flex-wrap gap-x-3 gap-y-0.5">
						{#if dist.running > 0}<span class="text-[10px] text-emerald-400">{dist.running} running</span>{/if}
						{#if dist.pending > 0}<span class="text-[10px] text-amber-400">{dist.pending} pending</span>{/if}
						{#if dist.failed > 0}<span class="text-[10px] text-red-400">{dist.failed} failed</span>{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Footer: resource counts -->
		<div class="flex items-center gap-3 border-t px-4 py-2.5">
			{#if workloads > 0}
				<span class="flex items-center gap-1 text-[11px] text-muted-foreground">
					<Layers class="size-3 shrink-0 text-violet-400" />
					{workloads}
				</span>
			{/if}
			{#if group.services.length > 0}
				<span class="flex items-center gap-1 text-[11px] text-muted-foreground">
					<Network class="size-3 shrink-0 text-emerald-400" />
					{group.services.length}
				</span>
			{/if}
			{#if group.ingresses.length > 0}
				<span class="flex items-center gap-1 text-[11px] text-muted-foreground">
					<Globe class="size-3 shrink-0 text-amber-400" />
					{group.ingresses.length}
				</span>
			{/if}
			{#if group.cronJobs.length > 0}
				<span class="flex items-center gap-1 text-[11px] text-muted-foreground">
					<Calendar class="size-3 shrink-0 text-rose-400" />
					{group.cronJobs.length}
				</span>
			{/if}
			{#if workloads === 0 && group.services.length === 0 && group.ingresses.length === 0}
				<span class="text-[11px] text-muted-foreground/30 italic">no workloads</span>
			{/if}
			<ChevronRight class="ml-auto size-3.5 text-muted-foreground/20 transition-colors group-hover:text-muted-foreground/60" />
		</div>
	</button>
{/snippet}

<div class="space-y-4">
	<!-- ━━━ Header ━━━ -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<!-- Title + live stats -->
		<div class="flex items-center gap-3">
			{#if viewMode === 'detail' && detailNs}
				<button
					class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => switchView('overview')}
				>
					<ChevronRight class="size-3.5 rotate-180" />
					Resource Map
				</button>
				<span class="text-muted-foreground/40">/</span>
				<code class="text-sm font-semibold">{detailNs}</code>
			{:else}
				<h1 class="text-lg font-semibold tracking-tight">Resource Map</h1>
				{#if !connecting && pods.length > 0}
					<div class="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
						<span class="inline-flex items-center gap-1.5">
							<span class="size-1.5 rounded-full bg-emerald-500"></span>
							{runningPods}/{totalPods} pods
						</span>
						<span class="text-muted-foreground/30">·</span>
						<span>{totalDeployments} deploys</span>
						<span class="text-muted-foreground/30">·</span>
						<span>{totalServices} services</span>
						<span class="text-muted-foreground/30">·</span>
						<span>{totalNamespaces} ns</span>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Controls -->
		<div class="flex items-center gap-2">
			<!-- Live indicator -->
			{#if !connecting}
				<div class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium text-emerald-400">
					<span class="relative flex size-1.5">
						<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
						<span class="relative inline-flex size-1.5 rounded-full bg-emerald-500"></span>
					</span>
					Live
				</div>
			{/if}

			{#if viewMode === 'overview'}
				<div class="relative">
					<Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						class="h-8 w-44 rounded-md border bg-transparent pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
						placeholder="Search namespaces..."
						bind:value={searchQuery}
					/>
				</div>
			{:else}
				<Select.Root
					type="single"
					value={detailNs ?? ''}
					onValueChange={(v: string) => { if (v) updateUrl({ ns: v }); }}
				>
					<Select.Trigger class="h-8 w-44 text-xs">{detailNs || 'Select namespace'}</Select.Trigger>
					<Select.Content>
						{#each namespaces as ns}<Select.Item value={ns}>{ns}</Select.Item>{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- View toggle -->
			<div class="flex items-center rounded-md border bg-muted/40 p-0.5">
				<button
					class={cn('inline-flex size-7 items-center justify-center rounded transition-colors', viewMode === 'overview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
					title="Overview"
					onclick={() => switchView('overview')}
				><LayoutGrid class="size-3.5" /></button>
				<button
					class={cn('inline-flex size-7 items-center justify-center rounded transition-colors', viewMode === 'detail' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
					title="Detail view"
					onclick={() => switchView('detail')}
				><ChartGantt class="size-3.5" /></button>
			</div>

			<Button variant="outline" size="sm" class="h-8 gap-1.5 text-xs" onclick={reconnect} disabled={connecting}>
				<RefreshCw class={cn('size-3', connecting && 'animate-spin')} />
				{connecting ? 'Connecting…' : 'Reconnect'}
			</Button>
		</div>
	</div>

	<!-- ━━━ Main content ━━━ -->

	{#if !activeCluster}
		<div class="flex items-center justify-center py-24">
			<div class="flex flex-col items-center gap-3 text-center">
				<Server class="size-12 text-muted-foreground/50" />
				<p class="text-lg font-medium">No cluster selected</p>
				<p class="text-sm text-muted-foreground">Select a cluster from the status bar to view resources</p>
			</div>
		</div>

	{:else if liveError}
		<div class="flex items-center justify-center py-24">
			<div class="flex flex-col items-center gap-3 text-center">
				<CircleAlert class="size-12 text-destructive/50" />
				<p class="text-lg font-medium">Connection lost</p>
				<p class="text-sm text-muted-foreground">{liveError}</p>
				<Button variant="outline" size="sm" onclick={reconnect}>Reconnect</Button>
			</div>
		</div>

	{:else if connecting}
		<!-- Skeleton cards while SSE connects -->
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each { length: 8 } as _}
				<div class="animate-pulse rounded-xl border bg-card">
					<div class="flex items-center gap-2.5 border-b px-4 py-3">
						<span class="size-2.5 rounded-full bg-muted"></span>
						<span class="h-3 w-28 rounded bg-muted"></span>
						<span class="ml-auto h-3 w-10 rounded bg-muted"></span>
					</div>
					<div class="flex flex-wrap gap-1 px-4 py-3">
						{#each { length: 12 } as _}
							<span class="size-2.5 rounded-sm bg-muted"></span>
						{/each}
					</div>
					<div class="flex gap-3 border-t px-4 py-2.5">
						<span class="h-2.5 w-12 rounded bg-muted"></span>
						<span class="h-2.5 w-10 rounded bg-muted"></span>
					</div>
				</div>
			{/each}
		</div>

	{:else if namespaceGroups.length === 0}
		<div class="flex items-center justify-center py-24">
			<div class="flex flex-col items-center gap-3 text-center">
				<Box class="size-12 text-muted-foreground/50" />
				<p class="text-lg font-medium">No resources found</p>
				<p class="text-sm text-muted-foreground">
					{searchQuery ? 'Try adjusting your search' : 'This cluster appears to be empty'}
				</p>
			</div>
		</div>

	<!-- ━━━ OVERVIEW ━━━ -->
	{:else if viewMode === 'overview'}
		{@const issueGroups = [
			...namespaceGroups.filter((g) => nsHealth(g) === 'unhealthy'),
			...namespaceGroups.filter((g) => nsHealth(g) === 'degraded')
		].sort((a, b) => a.namespace.localeCompare(b.namespace))}
		{@const okGroups = [
			...namespaceGroups.filter((g) => nsHealth(g) === 'healthy'),
			...namespaceGroups.filter((g) => nsHealth(g) === 'idle')
		].sort((a, b) => a.namespace.localeCompare(b.namespace))}

		<div class="space-y-4">
			<!-- Issues section -->
			{#if issueGroups.length > 0}
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<CircleAlert class="size-3.5 shrink-0 text-red-400" />
						<span class="text-xs font-semibold text-red-400">
							{issueGroups.length} namespace{issueGroups.length !== 1 ? 's' : ''} with issues
						</span>
					</div>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each issueGroups as group (group.namespace)}
							{@render NsCard(group)}
						{/each}
					</div>
				</div>
				<div class="flex items-center gap-3">
					<div class="h-px flex-1 bg-border"></div>
					<span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
						Healthy &amp; Idle — {okGroups.length}
					</span>
					<div class="h-px flex-1 bg-border"></div>
				</div>
			{/if}

			<!-- Healthy / Idle grid -->
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{#each okGroups as group (group.namespace)}
					{@render NsCard(group)}
				{/each}
			</div>
		</div>

	<!-- ━━━ DETAIL MODE ━━━ -->
	{:else if viewMode === 'detail' && detailGroup}
		{@const dGroup = detailGroup}
		{@const dHealth = nsHealth(dGroup)}
		{@const dDist = podDistribution(dGroup.pods)}
		{@const allLinkedSvcs = linkedServiceNames(dGroup)}
		{@const standaloneSvcs = dGroup.services.filter((s) => !allLinkedSvcs.has(s.name))}
		<div class="space-y-6">
			<!-- Namespace stats -->
			<div class="flex flex-wrap items-center gap-3">
				<span class={cn('size-3 rounded-full', healthDot(dHealth))}></span>
				<span class="text-sm capitalize text-muted-foreground">{dHealth}</span>
				<Separator orientation="vertical" class="h-4" />
				<span class="text-sm tabular-nums text-muted-foreground">{dDist.running}/{dDist.total} pods running</span>
				<Separator orientation="vertical" class="h-4" />
				<span class="text-sm text-muted-foreground">{dGroup.deployments.length} deployments · {dGroup.services.length} services</span>
			</div>

			<!-- Ingresses -->
			{#if dGroup.ingresses.length > 0}
				<section>
					<div class="mb-3 flex items-center gap-2">
						<Globe class="size-4 text-amber-400" />
						<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingresses</h2>
						<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">{dGroup.ingresses.length}</Badge>
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
													class="truncate text-xs text-amber-400/70 underline decoration-amber-400/30 hover:text-amber-300"
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
												<Badge variant="outline" class="border-amber-700/30 px-1.5 py-0 text-[10px] text-amber-400/80">
													→ {b.serviceName}:{b.servicePort}
												</Badge>
											{/each}
										</div>
									{/if}
								</div>
								{#if ing.tls}<Shield class="size-3.5 shrink-0 text-amber-400/60" />{/if}
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Workloads -->
			{#if dGroup.deployments.length > 0 || dGroup.daemonSets.length > 0 || dGroup.statefulSets.length > 0}
				<section>
					<div class="mb-3 flex items-center gap-2">
						<Layers class="size-4 text-violet-400" />
						<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workloads</h2>
						<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">
							{dGroup.deployments.length + dGroup.daemonSets.length + dGroup.statefulSets.length}
						</Badge>
					</div>
					<div class="space-y-3">
						{#each dGroup.deployments as dep (dep.name)}
							{@const depPods = podsForDeployment(dep, dGroup)}
							{@const depSvcs = servicesForLabels(dep.selector, dGroup)}
							{@const depHealth = healthStatus(dep.readyReplicas, dep.replicas)}
							{@render WorkloadRow({ kind: 'Deployment', name: dep.name, icon: Layers, iconColor: 'text-violet-400', bgColor: 'bg-violet-500/8', borderColor: 'border-violet-500/20', hoverColor: 'hover:bg-violet-500/15', health: depHealth, readyText: `${dep.readyReplicas}/${dep.replicas}`, pods: depPods, services: depSvcs, data: dep, namespace: dGroup.namespace })}
						{/each}
						{#each dGroup.daemonSets as ds (ds.name)}
							{@const dsPods = dGroup.pods.filter((p) => p.ownerKind === 'DaemonSet' && p.ownerName === ds.name)}
							{@const dsHealth = healthStatus(ds.ready, ds.desired)}
							{@render WorkloadRow({ kind: 'DaemonSet', name: ds.name, icon: Server, iconColor: 'text-fuchsia-400', bgColor: 'bg-fuchsia-500/8', borderColor: 'border-fuchsia-500/20', hoverColor: 'hover:bg-fuchsia-500/15', health: dsHealth, readyText: `${ds.ready}/${ds.desired}`, pods: dsPods, services: [], data: ds, namespace: dGroup.namespace })}
						{/each}
						{#each dGroup.statefulSets as ss (ss.name)}
							{@const ssPods = dGroup.pods.filter((p) => p.ownerKind === 'StatefulSet' && p.ownerName === ss.name)}
							{@const ssHealth = healthStatus(ss.readyReplicas, ss.replicas)}
							{@render WorkloadRow({ kind: 'StatefulSet', name: ss.name, icon: Database, iconColor: 'text-purple-400', bgColor: 'bg-purple-500/8', borderColor: 'border-purple-500/20', hoverColor: 'hover:bg-purple-500/15', health: ssHealth, readyText: `${ss.readyReplicas}/${ss.replicas}`, pods: ssPods, services: [], data: ss, namespace: dGroup.namespace })}
						{/each}
					</div>
				</section>
			{/if}

			<!-- CronJobs -->
			{#if dGroup.cronJobs.length > 0}
				<section>
					<div class="mb-3 flex items-center gap-2">
						<Calendar class="size-4 text-rose-400" />
						<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CronJobs</h2>
						<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">{dGroup.cronJobs.length}</Badge>
					</div>
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each dGroup.cronJobs as cj (cj.name)}
							<button
								class="flex items-start gap-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-left transition-colors hover:bg-rose-500/10"
								onclick={() => selectResource('CronJob', cj.name, dGroup.namespace, cj)}
							>
								<Calendar class="mt-0.5 size-4 shrink-0 text-rose-400" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-rose-300">{cj.name}</p>
									<p class="mt-0.5 font-mono text-xs text-muted-foreground">{cj.schedule}</p>
								</div>
								{#if cj.suspended}
									<Badge variant="outline" class="border-zinc-600/40 px-1.5 py-0 text-[10px] text-zinc-400">Paused</Badge>
								{/if}
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Standalone Services -->
			{#if standaloneSvcs.length > 0}
				<section>
					<div class="mb-3 flex items-center gap-2">
						<Network class="size-4 text-emerald-400" />
						<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Services</h2>
						<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">{standaloneSvcs.length}</Badge>
					</div>
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{#each standaloneSvcs as svc (svc.name)}
							<button
								class="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-left transition-colors hover:bg-emerald-500/10"
								onclick={() => selectResource('Service', svc.name, dGroup.namespace, svc)}
							>
								<Network class="mt-0.5 size-4 shrink-0 text-emerald-400" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-emerald-300">{svc.name}</p>
									<p class="mt-0.5 text-xs text-muted-foreground">{svc.type} · {svc.ports.map((p) => p.port).join(', ')}</p>
								</div>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Standalone Pods -->
			{#if dGroup.pods.some((p) => !p.ownerKind)}
				<section>
					<div class="mb-3 flex items-center gap-2">
						<Box class="size-4 text-sky-400" />
						<h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Standalone Pods</h2>
					</div>
					<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{#each dGroup.pods.filter((p) => !p.ownerKind) as pod (pod.name)}
							<button
								class="flex items-center gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-left transition-colors hover:bg-sky-500/10"
								onclick={() => selectResource('Pod', pod.name, dGroup.namespace, pod)}
							>
								<span class={cn('size-2 rounded-full', podStatusColor(pod.phase))}></span>
								<span class="flex-1 truncate text-xs text-sky-300">{truncate(pod.name, 36)}</span>
								<span class="tabular-nums text-[10px] text-muted-foreground">{pod.ready}</span>
							</button>
						{/each}
					</div>
				</section>
			{/if}
		</div>

	{:else if viewMode === 'detail' && !detailGroup}
		<div class="flex items-center justify-center py-24">
			<div class="flex flex-col items-center gap-3 text-center">
				<Box class="size-12 text-muted-foreground/50" />
				<p class="text-lg font-medium">Select a namespace</p>
				<p class="text-sm text-muted-foreground">Choose a namespace from the dropdown to see its resources</p>
			</div>
		</div>
	{/if}
</div>

<!-- ━━━ Resource Detail Drawer ━━━ -->
{#if selectedResource}
	{@const DrawerIcon = RESOURCE_ICONS[selectedResource.kind.toLowerCase()] || Box}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex justify-end" onclick={closeResource} onkeydown={(e) => e.key === 'Escape' && closeResource()}>
		<div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]"></div>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="relative z-10 flex w-105 max-w-[90vw] flex-col border-l bg-card shadow-2xl animate-in slide-in-from-right" onclick={(e: MouseEvent) => e.stopPropagation()}>
			<div class="flex items-center gap-3 border-b px-5 py-4">
				<DrawerIcon class="size-5 shrink-0 text-muted-foreground" />
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-semibold">{selectedResource.name}</p>
					<p class="text-xs text-muted-foreground">{selectedResource.kind} · {selectedResource.namespace}</p>
				</div>
				<button class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" onclick={closeResource}>
					<X class="size-4" />
				</button>
			</div>
			<div class="flex-1 space-y-3 overflow-y-auto p-5">
				{#if selectedResource.kind === 'Pod'}
					{@const pod = selectedResource.data as DiagramPod}
					{@render DetailRow({ label: 'Status', value: pod.phase })}
					{@render DetailRow({ label: 'Ready', value: pod.ready })}
					{@render DetailRow({ label: 'Restarts', value: String(pod.restarts) })}
					{#if pod.nodeName}{@render DetailRow({ label: 'Node', value: pod.nodeName })}{/if}
					{#if pod.ownerKind}{@render DetailRow({ label: 'Owner', value: `${pod.ownerKind}/${pod.ownerName}` })}{/if}
					{#if Object.keys(pod.labels).length > 0}
						{@render LabelSection({ title: 'Labels', entries: Object.entries(pod.labels).slice(0, 10) })}
					{/if}
				{:else if selectedResource.kind === 'Deployment'}
					{@const dep = selectedResource.data as DiagramDeployment}
					{@render DetailRow({ label: 'Replicas', value: `${dep.readyReplicas}/${dep.replicas} ready` })}
					{@render DetailRow({ label: 'Available', value: String(dep.availableReplicas) })}
					{#if Object.keys(dep.selector).length > 0}
						{@render LabelSection({ title: 'Selector', entries: Object.entries(dep.selector) })}
					{/if}
				{:else if selectedResource.kind === 'Service'}
					{@const svc = selectedResource.data as DiagramService}
					{@render DetailRow({ label: 'Type', value: svc.type })}
					{#if svc.clusterIP}{@render DetailRow({ label: 'Cluster IP', value: svc.clusterIP })}{/if}
					{#if svc.ports.length > 0}
						<div>
							<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ports</p>
							<div class="space-y-1.5">
								{#each svc.ports as port}
									<div class="flex items-center gap-2 text-xs">
										<Badge variant="outline" class="px-1.5 py-0 text-[10px]">{port.port}</Badge>
										<ArrowRight class="size-3 text-muted-foreground" />
										<Badge variant="outline" class="px-1.5 py-0 text-[10px]">{port.targetPort}</Badge>
										<span class="text-[10px] text-muted-foreground">{port.protocol || 'TCP'}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if Object.keys(svc.selector).length > 0}
						{@render LabelSection({ title: 'Selector', entries: Object.entries(svc.selector) })}
					{/if}
				{:else if selectedResource.kind === 'Ingress'}
					{@const ing = selectedResource.data as DiagramIngress}
					{@render DetailRow({ label: 'TLS', value: ing.tls ? 'Yes' : 'No' })}
					{#if ing.hosts.length > 0}
						<div>
							<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Hosts</p>
							<div class="flex flex-wrap gap-1.5">
								{#each ing.hosts as host}
									<a href="{ing.tls ? 'https' : 'http'}://{host}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] underline decoration-muted-foreground/30 hover:bg-secondary/80">
										{host}<Globe class="size-2.5 text-muted-foreground" />
									</a>
								{/each}
							</div>
						</div>
					{/if}
				{:else if selectedResource.kind === 'DaemonSet'}
					{@const ds = selectedResource.data as DiagramDaemonSet}
					{@render DetailRow({ label: 'Desired', value: String(ds.desired) })}
					{@render DetailRow({ label: 'Ready', value: String(ds.ready) })}
					{@render DetailRow({ label: 'Available', value: String(ds.available) })}
				{:else if selectedResource.kind === 'StatefulSet'}
					{@const ss = selectedResource.data as DiagramStatefulSet}
					{@render DetailRow({ label: 'Replicas', value: `${ss.readyReplicas}/${ss.replicas} ready` })}
				{:else if selectedResource.kind === 'CronJob'}
					{@const cj = selectedResource.data as DiagramCronJob}
					{@render DetailRow({ label: 'Schedule', value: cj.schedule })}
					{@render DetailRow({ label: 'Suspended', value: cj.suspended ? 'Yes' : 'No' })}
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
		<p class="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{props.title}</p>
		<div class="flex flex-wrap gap-1">
			{#each props.entries as [k, v]}
				<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">{k}={truncate(v, 20)}</Badge>
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
		<div class="flex items-stretch">
			{#if props.services.length > 0}
				<div class="flex min-w-45 flex-col justify-center gap-1 border-r border-dashed border-border/50 px-3 py-2.5">
					{#each props.services as svc}
						<button
							class="flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-emerald-500/10"
							onclick={() => selectResource('Service', svc.name, props.namespace, svc)}
						>
							<Network class="size-3 shrink-0 text-emerald-400" />
							<span class="truncate text-[11px] text-emerald-300">{truncate(svc.name, 22)}</span>
							<span class="ml-auto text-[10px] text-muted-foreground">{svc.ports.map((p) => p.port).join(',')}</span>
						</button>
					{/each}
				</div>
				<div class="flex items-center px-1">
					<ArrowRight class="size-3.5 text-muted-foreground/50" />
				</div>
			{/if}

			<button
				class={cn('flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors', props.bgColor, props.hoverColor)}
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
						props.health === 'healthy' ? 'border-emerald-500/30 text-emerald-400' :
						props.health === 'degraded' ? 'border-amber-500/30 text-amber-400' :
						props.health === 'unhealthy' ? 'border-red-500/30 text-red-400' :
						'border-zinc-500/30 text-zinc-400'
					)}
				>{props.readyText}</Badge>
			</button>

			{#if props.pods.length > 0}
				<div class="flex items-center px-1">
					<ArrowRight class="size-3.5 text-muted-foreground/50" />
				</div>
				<div class="flex items-center gap-1 px-3 py-2.5">
					<div class="flex max-w-50 flex-wrap gap-1">
						{#each props.pods.slice(0, 20) as pod}
							<button
								class={cn('size-3 rounded-sm transition-all hover:scale-150', podStatusColor(pod.phase))}
								title="{pod.name} ({pod.phase})"
								onclick={() => selectResource('Pod', pod.name, props.namespace, pod)}
							></button>
						{/each}
						{#if props.pods.length > 20}
							<span class="ml-1 text-[10px] text-muted-foreground">+{props.pods.length - 20}</span>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		{#if props.pods.length > 0 && props.pods.length <= 8}
			<div class="border-t border-dashed border-border/30 bg-black/10 px-3 py-2">
				<div class="flex flex-wrap gap-1.5">
					{#each props.pods as pod (pod.name)}
						<button
							class="flex items-center gap-1.5 rounded-md border border-border/30 bg-background/30 px-2 py-1 text-left transition-colors hover:bg-background/50"
							onclick={() => selectResource('Pod', pod.name, props.namespace, pod)}
						>
							<span class={cn('size-1.5 rounded-full', podStatusColor(pod.phase))}></span>
							<span class="max-w-35 truncate text-[10px]">{pod.name}</span>
							<span class="tabular-nums text-[9px] text-muted-foreground">{pod.ready}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/snippet}
