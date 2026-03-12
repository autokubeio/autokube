<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import {
		Activity,
		Cpu,
		HardDrive,
		Server,
		Box,
		AlertCircle,
		CheckCircle2,
		XCircle,
		Maximize2,
		Layers
	} from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import { DEFAULT_LABELS, COLOR_BADGE, COLOR_DOT } from '$lib/components/label-picker.svelte';
	import type { ClusterInfo } from '$lib/stores/cluster.svelte';

	/**
	 * Tile size tiers (determined by grid w×h):
	 *   Glance   (1×1) — status dot, name, one headline metric
	 *   Compact  (1×2) — name, status, CPU/Memory/Disk bars
	 *   Detailed (2×2) — full metrics + sparkline charts
	 *   Full     (2×3+)— everything incl. events list
	 */
	export type TileSize = 'glance' | 'compact' | 'detailed' | 'full';

	interface Props {
		cluster: ClusterInfo;
		/** Width in grid units (1 = ¼ page, 2 = ½ page in a 4-col grid) */
		gridW?: number;
		/** Height in grid units (1=120px, 2≈250px, 4≈510px) */
		gridH?: number;
		onExpand?: (cluster: ClusterInfo) => void;
		recentEvents?: Array<{
			type: string;
			reason: string;
			message: string;
			lastSeen: string;
		}>;
		/** When true the card appears faded / disabled (label filter mismatch). */
		dimmed?: boolean;
	}

	let { cluster, gridW = 1, gridH = 1, onExpand, recentEvents = [], dimmed = false }: Props = $props();

	// 4 tile types driven purely by w×h snap steps:
	//   Glance   w=1 h=1   (~120px,  ¼ wide)
	//   Compact  w=1 h=2   (~250px,  ¼ wide)
	//   Detailed w=1 h=4   (~510px,  ¼ wide)
	//   Full     w=2 h=4   (~510px,  ½ wide)
	const tileSize = $derived<TileSize>((() => {
		if (gridW >= 2 && gridH >= 4) return 'full';
		if (gridH >= 4) return 'detailed';
		if (gridH >= 2) return 'compact';
		return 'glance';
	})());

	const isOffline = $derived(cluster.status === 'disconnected');
	const isWarning = $derived(cluster.status === 'warning');

	// Calculate percentages
	const cpuPercent = $derived(
		cluster.cpuCapacity > 0 ? Math.round((cluster.cpuUsage / cluster.cpuCapacity) * 100) : 0
	);
	const memoryPercent = $derived(
		cluster.memoryCapacity > 0
			? Math.round((cluster.memoryUsage / cluster.memoryCapacity) * 100)
			: 0
	);
	const diskPercent = $derived(
		cluster.diskCapacity > 0 ? Math.round((cluster.diskUsage / cluster.diskCapacity) * 100) : 0
	);

	function formatMemory(bytes: number): string {
		const gb = bytes / (1024 * 1024 * 1024);
		return gb > 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
	}

	function formatCpu(millicores: number): string {
		return (millicores / 1000).toFixed(2);
	}

	function barColor(pct: number, base: string): string {
		if (pct > 80) return 'bg-destructive';
		if (pct > 60) return 'bg-yellow-500';
		return base;
	}

	// Chart data for sparklines (sample data — replace with historical in production)
	const cpuChartData = $derived(
		Array.from({ length: 20 }, () => Math.max(0, cpuPercent + Math.random() * 10 - 5))
	);
	const memoryChartData = $derived(
		Array.from({ length: 20 }, () => Math.max(0, memoryPercent + Math.random() * 10 - 5))
	);

	function sparklinePath(data: number[], width = 100, height = 40): string {
		if (data.length === 0) return '';
		const max = Math.max(...data, 100);
		const min = Math.min(...data, 0);
		const range = max - min || 1;
		const step = width / (data.length - 1 || 1);
		const points = data.map((value, i) => {
			const x = i * step;
			const y = height - ((value - min) / range) * height;
			return `${x},${y}`;
		});
		return `M ${points.join(' L ')}`;
	}
</script>

<div class={cn('h-full transition-opacity duration-200', dimmed && 'opacity-35 saturate-50 pointer-events-none select-none')}>
<!-- ───────── GLANCE  (1×1 @ 120px) ───────── -->
{#if tileSize === 'glance'}
	<div
		class={cn(
			'group/card relative flex h-full flex-col justify-between rounded-xl border bg-card px-3 py-2.5 transition-all hover:shadow-lg overflow-hidden',
			isOffline && 'border-destructive/50 bg-destructive/5',
			isWarning && 'border-yellow-500/50 bg-yellow-500/5'
		)}
	>
		<!-- ── Row 1: identity ── -->
		<div class="flex items-center justify-between gap-2 min-w-0">
			<div class="flex items-center gap-1.5 min-w-0">
				<span class={cn(
					'inline-block size-2 shrink-0 rounded-full ring-2',
					isOffline ? 'bg-destructive ring-destructive/25' : isWarning ? 'bg-yellow-500 ring-yellow-500/25' : 'bg-green-500 ring-green-500/25'
				)}></span>
				<span class="truncate text-sm font-semibold">{cluster.name}</span>
				{#if cluster.version}
					<span class="shrink-0 truncate text-[11px] text-muted-foreground">{cluster.version}</span>
				{/if}
			</div>
			<span class={cn(
				'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none',
				isOffline ? 'bg-destructive/15 text-destructive' :
				isWarning ? 'bg-yellow-500/15 text-yellow-500' :
				'bg-green-500/15 text-green-600 dark:text-green-400'
			)}>
				{isOffline ? 'Offline' : isWarning ? 'Warning' : 'Healthy'}
			</span>
		</div>

		{#if isOffline}
			<div class="flex flex-1 items-center justify-center gap-1.5 text-destructive/60">
				<XCircle class="size-4" />
				<span class="text-xs">Cannot connect to cluster</span>
			</div>
		{:else}
			<!-- ── Row 2: metrics ── -->
			<div class="flex flex-1 items-center gap-3">
				<!-- CPU + MEM stacked vertically, bars fill full width -->
				<div class="flex min-w-0 flex-1 flex-col gap-2">
					<!-- CPU -->
					<div class="flex flex-col gap-1">
						<div class="flex items-baseline justify-between gap-1">
							<span class="text-[11px] font-semibold text-muted-foreground">CPU</span>
							<span class={cn('text-[11px] font-bold tabular-nums',
								cpuPercent > 80 ? 'text-destructive' : cpuPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{cpuPercent}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500',
								cpuPercent > 80 ? 'bg-destructive' : cpuPercent > 60 ? 'bg-yellow-500' : 'bg-blue-500'
							)} style="width: {Math.max(cpuPercent, cpuPercent > 0 ? 2 : 0)}%"></div>
						</div>
					</div>
					<!-- MEM -->
					<div class="flex flex-col gap-1">
						<div class="flex items-baseline justify-between gap-1">
							<span class="text-[11px] font-semibold text-muted-foreground">MEM</span>
							<span class={cn('text-[11px] font-bold tabular-nums',
								memoryPercent > 80 ? 'text-destructive' : memoryPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{memoryPercent}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500',
								memoryPercent > 80 ? 'bg-destructive' : memoryPercent > 60 ? 'bg-yellow-500' : 'bg-purple-500'
							)} style="width: {Math.max(memoryPercent, memoryPercent > 0 ? 2 : 0)}%"></div>
						</div>
					</div>
				</div>

				<div class="h-10 w-px shrink-0 bg-border/60"></div>

				<!-- Nodes + Pods -->
				<div class="flex shrink-0 items-center gap-4">
					<div class="flex flex-col items-center">
						<span class="text-[10px] font-medium text-muted-foreground">Nodes</span>
						<span class="text-lg font-bold leading-tight tabular-nums">{cluster.nodes}</span>
					</div>
					<div class="flex flex-col items-center">
						<span class="text-[10px] font-medium text-muted-foreground">Pods</span>
						<span class="text-lg font-bold leading-tight tabular-nums">{cluster.runningPods}<span class="text-[10px] font-normal text-muted-foreground">/{cluster.pods}</span></span>
					</div>
				</div>
			</div>
		{/if}
	</div>
<!-- ───────── COMPACT / STANDARD  (1×2 @ 250px) ───────── -->
{:else if tileSize === 'compact'}
	<div
		class={cn(
			'group/card flex h-full flex-col gap-2.5 rounded-xl border bg-card px-3 py-3 transition-all hover:shadow-lg overflow-hidden',
			isOffline && 'border-destructive/50 bg-destructive/5',
			isWarning && 'border-yellow-500/50 bg-yellow-500/5'
		)}
	>
		<!-- ── Header ── -->
		<div class="flex items-center gap-2 min-w-0">
			<span class={cn(
				'inline-block size-2 shrink-0 rounded-full ring-2',
				isOffline ? 'bg-destructive ring-destructive/25' : isWarning ? 'bg-yellow-500 ring-yellow-500/25' : 'bg-green-500 ring-green-500/25'
			)}></span>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold leading-tight">{cluster.name}</p>
				<p class="truncate text-[11px] text-muted-foreground">{cluster.version} · {cluster.region}</p>
			</div>
			<span class={cn(
				'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none',
				isOffline ? 'bg-destructive/15 text-destructive' :
				isWarning ? 'bg-yellow-500/15 text-yellow-500' :
				'bg-green-500/15 text-green-600 dark:text-green-400'
			)}>
				{isOffline ? 'Offline' : isWarning ? 'Warn' : 'OK'}
			</span>
		</div>

		<!-- ── Labels ── -->
		{#if cluster.labels.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each cluster.labels.slice(0, 3) as label (label)}
					{@const preset = DEFAULT_LABELS.find((d) => d.name === label)}
					{@const color = preset?.color ?? 'blue'}
					<span class={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none', COLOR_BADGE[color] ?? COLOR_BADGE.blue)}>
						<span class={cn('inline-block size-1.5 rounded-full', COLOR_DOT[color] ?? COLOR_DOT.blue)}></span>
						{label}
					</span>
				{/each}
				{#if cluster.labels.length > 3}
					<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">+{cluster.labels.length - 3}</span>
				{/if}
			</div>
		{/if}

		{#if isOffline}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 text-destructive/60">
				<XCircle class="size-8" />
				<p class="text-sm font-medium text-destructive">Cluster Offline</p>
			</div>
		{:else}
			<!-- ── Stats row ── -->
			<div class="grid grid-cols-3 gap-1.5 text-center">
				{#each [
					{ label: 'NODES', value: cluster.nodes,        sub: '' },
					{ label: 'PODS',  value: cluster.runningPods,  sub: `/${cluster.pods}` },
					{ label: 'NS',    value: cluster.namespaces,   sub: '' }
				] as s}
					<div class="flex flex-col rounded-lg bg-muted/40 py-1.5">
						<span class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</span>
						<span class="text-lg font-bold leading-tight tabular-nums">{s.value}<span class="text-[10px] font-normal text-muted-foreground">{s.sub}</span></span>
					</div>
				{/each}
			</div>

			<!-- ── Metric rows ── -->
			<div class="flex flex-1 flex-col justify-around gap-1">
				{#each [
					{ label: 'CPU',  pct: cpuPercent,    color: 'bg-blue-500'   },
					{ label: 'MEM',  pct: memoryPercent, color: 'bg-purple-500' },
					{ label: 'Disk', pct: diskPercent,   color: 'bg-orange-500' }
				] as m}
					<div class="flex flex-col gap-1">
						<div class="flex items-baseline justify-between">
							<span class="text-[11px] font-semibold">{m.label}</span>
							<span class={cn('text-[11px] font-bold tabular-nums',
								m.pct > 80 ? 'text-destructive' : m.pct > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{m.pct}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div
								class={cn('h-full rounded-full transition-all duration-500', barColor(m.pct, m.color))}
								style="width: {Math.max(m.pct, m.pct > 0 ? 2 : 0)}%"
							></div>
						</div>
					</div>
				{/each}
			</div>

			<!-- ── Sparkline footer ── -->
			<div class="h-8 w-full pb-1 opacity-70">
				<svg viewBox="0 0 200 32" class="h-full w-full" preserveAspectRatio="none">
					<defs>
						<linearGradient id="cG-{cluster.id}" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stop-color="rgb(59 130 246)" stop-opacity="0.3" />
							<stop offset="100%" stop-color="rgb(59 130 246)" stop-opacity="0" />
						</linearGradient>
						<linearGradient id="mG-{cluster.id}" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stop-color="rgb(168 85 247)" stop-opacity="0.2" />
							<stop offset="100%" stop-color="rgb(168 85 247)" stop-opacity="0" />
						</linearGradient>
					</defs>
					<path d="{sparklinePath(memoryChartData, 200, 32)} L 200,32 L 0,32 Z" fill="url(#mG-{cluster.id})" />
					<path d="{sparklinePath(cpuChartData, 200, 32)} L 200,32 L 0,32 Z" fill="url(#cG-{cluster.id})" />
					<path d={sparklinePath(memoryChartData, 200, 32)} fill="none" stroke="rgb(168 85 247)" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-opacity="0.7" />
					<path d={sparklinePath(cpuChartData, 200, 32)} fill="none" stroke="rgb(59 130 246)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
				</svg>
			</div>
		{/if}
	</div>

<!-- ───────── DETAILED  (1×4 @ ~510px tall) ───────── -->
{:else if tileSize === 'detailed'}
	<div
		class={cn(
			'group/card flex h-full flex-col gap-0 rounded-xl border bg-card overflow-hidden transition-all hover:shadow-lg',
			isOffline && 'border-destructive/50 bg-destructive/5',
			isWarning && 'border-yellow-500/50 bg-yellow-500/5'
		)}
	>
		<!-- ── Header bar ── -->
		<div class={cn(
			'flex items-center gap-2.5 border-b px-4 py-3',
			isOffline ? 'border-destructive/20' : 'border-border/60'
		)}>
			<span class={cn(
				'inline-block size-2 shrink-0 rounded-full ring-2',
				isOffline ? 'bg-destructive ring-destructive/25' : isWarning ? 'bg-yellow-500 ring-yellow-500/25' : 'bg-green-500 ring-green-500/25'
			)}></span>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-bold leading-tight">{cluster.name}</p>
				<p class="truncate text-[11px] text-muted-foreground">{cluster.version} · {cluster.region}</p>
			</div>
			<span class={cn(
				'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none',
				isOffline ? 'bg-destructive/15 text-destructive' :
				isWarning ? 'bg-yellow-500/15 text-yellow-500' :
				'bg-green-500/15 text-green-600 dark:text-green-400'
			)}>
				{isOffline ? 'Offline' : cluster.health}
			</span>
		</div>

		{#if cluster.labels.length > 0}
			<div class="flex flex-wrap gap-1 px-4 py-1.5 border-b border-border/40">
				{#each cluster.labels as label (label)}
					{@const preset = DEFAULT_LABELS.find((d) => d.name === label)}
					{@const color = preset?.color ?? 'blue'}
					<span class={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none', COLOR_BADGE[color] ?? COLOR_BADGE.blue)}>
						<span class={cn('inline-block size-1.5 rounded-full', COLOR_DOT[color] ?? COLOR_DOT.blue)}></span>
						{label}
					</span>
				{/each}
			</div>
		{/if}

		{#if isOffline}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 text-destructive/60">
				<XCircle class="size-12" />
				<p class="text-sm font-medium text-destructive">Cluster Offline</p>
				<p class="text-xs text-muted-foreground">Check your connection settings.</p>
			</div>
		{:else}
			<div class="flex flex-1 flex-col overflow-y-auto px-4 py-2.5 gap-3">

				<!-- ── Pods ── -->
				<div class="space-y-1">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pods</p>
					<div class="flex items-center gap-2">
						<Box class="size-3.5 shrink-0 text-muted-foreground" />
						<span class="text-base font-bold tabular-nums">{cluster.runningPods}</span>
						<span class="text-xs text-muted-foreground">running / {cluster.pods} total</span>
					</div>
				</div>

				<!-- ── Nodes ── -->
				<div class="space-y-1">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nodes</p>
					<div class="flex items-center gap-2">
						<Server class="size-3.5 shrink-0 text-muted-foreground" />
						<span class="text-base font-bold tabular-nums">{cluster.nodes}</span>
						<span class="text-xs text-muted-foreground">nodes ready</span>
					</div>
				</div>

				<div class="h-px bg-border/60"></div>

				<!-- ── Resources ── -->
				<div class="space-y-2.5">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Resources</p>

					<!-- CPU -->
					<div class="space-y-1">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5">
								<Cpu class="size-3.5 text-blue-500" />
								<span class="font-semibold">CPU</span>
							</div>
							<span class={cn('font-bold tabular-nums',
								cpuPercent > 80 ? 'text-destructive' : cpuPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{cpuPercent}% <span class="font-normal text-muted-foreground">({formatCpu(cluster.cpuUsage)} / {formatCpu(cluster.cpuCapacity)})</span></span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500', barColor(cpuPercent, 'bg-blue-500'))} style="width: {cpuPercent}%"></div>
						</div>
						{#if cluster.metricsAvailable}
							<div class="h-8 w-full opacity-70">
								<svg viewBox="0 0 200 32" class="h-full w-full" preserveAspectRatio="none">
									<defs>
										<linearGradient id="cpuGd-{cluster.id}" x1="0" x2="0" y1="0" y2="1">
											<stop offset="0%" stop-color="rgb(59 130 246)" stop-opacity="0.35" />
											<stop offset="100%" stop-color="rgb(59 130 246)" stop-opacity="0" />
										</linearGradient>
									</defs>
									<path d="{sparklinePath(cpuChartData, 200, 32)} L 200,32 L 0,32 Z" fill="url(#cpuGd-{cluster.id})" />
									<path d={sparklinePath(cpuChartData, 200, 32)} fill="none" stroke="rgb(59 130 246)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
								</svg>
							</div>
						{/if}
					</div>

					<!-- Memory -->
					<div class="space-y-1">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5">
								<Activity class="size-3.5 text-purple-500" />
								<span class="font-semibold">Memory</span>
							</div>
							<span class={cn('font-bold tabular-nums',
								memoryPercent > 80 ? 'text-destructive' : memoryPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{memoryPercent}% <span class="font-normal text-muted-foreground">({formatMemory(cluster.memoryUsage)} / {formatMemory(cluster.memoryCapacity)})</span></span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500', barColor(memoryPercent, 'bg-purple-500'))} style="width: {memoryPercent}%"></div>
						</div>
						{#if cluster.metricsAvailable}
							<div class="h-8 w-full opacity-70">
								<svg viewBox="0 0 200 32" class="h-full w-full" preserveAspectRatio="none">
									<defs>
										<linearGradient id="memGd-{cluster.id}" x1="0" x2="0" y1="0" y2="1">
											<stop offset="0%" stop-color="rgb(168 85 247)" stop-opacity="0.35" />
											<stop offset="100%" stop-color="rgb(168 85 247)" stop-opacity="0" />
										</linearGradient>
									</defs>
									<path d="{sparklinePath(memoryChartData, 200, 32)} L 200,32 L 0,32 Z" fill="url(#memGd-{cluster.id})" />
									<path d={sparklinePath(memoryChartData, 200, 32)} fill="none" stroke="rgb(168 85 247)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
								</svg>
							</div>
						{/if}
					</div>

					<!-- Disk -->
					<div class="space-y-1">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5">
								<HardDrive class="size-3.5 text-orange-500" />
								<span class="font-semibold">Disk</span>
							</div>
							<span class={cn('font-bold tabular-nums',
								diskPercent > 80 ? 'text-destructive' : diskPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{diskPercent}% <span class="font-normal text-muted-foreground">({formatMemory(cluster.diskUsage)} / {formatMemory(cluster.diskCapacity)})</span></span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500', barColor(diskPercent, 'bg-orange-500'))} style="width: {diskPercent}%"></div>
						</div>
					</div>
				</div>

				<div class="h-px bg-border/60"></div>

				<!-- ── Workloads ── -->
				<div class="space-y-1">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workloads</p>
					{#each [
						{ label: 'Namespaces', value: cluster.namespaces, icon: Layers, color: 'text-blue-400'   },
						{ label: 'Pods',       value: cluster.pods,       icon: Box,    color: 'text-green-400'  },
						{ label: 'Nodes',      value: cluster.nodes,      icon: Server, color: 'text-purple-400' }
					] as w}
						<div class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-muted/40 transition-colors">
							<w.icon class={cn('size-3.5 shrink-0', w.color)} />
							<span class="flex-1 text-xs text-muted-foreground">{w.label}</span>
							<span class="text-xs font-bold tabular-nums">{w.value}</span>
						</div>
					{/each}
				</div>

			</div>
		{/if}
	</div>

<!-- ───────── FULL  (2×4 @ ~510px tall, ½ wide) ───────── -->
{:else}
	<div
		class={cn(
			'group/card flex h-full flex-col gap-0 rounded-xl border bg-card overflow-hidden transition-all hover:shadow-lg',
			isOffline && 'border-destructive/50 bg-destructive/5',
			isWarning && 'border-yellow-500/50 bg-yellow-500/5'
		)}
	>
		<!-- ── Top header bar ── -->
		<div class={cn(
			'flex items-center gap-3 border-b px-4 py-3',
			isOffline ? 'border-destructive/20' : 'border-border/60'
		)}>
			<span class={cn(
				'inline-block size-2.5 shrink-0 rounded-full ring-2',
				isOffline ? 'bg-destructive ring-destructive/25' : isWarning ? 'bg-yellow-500 ring-yellow-500/25' : 'bg-green-500 ring-green-500/25'
			)}></span>
			<div class="min-w-0 flex-1">
				<p class="truncate text-base font-bold leading-tight">{cluster.name}</p>
				<p class="truncate text-[11px] text-muted-foreground">{cluster.version} · {cluster.region}</p>
			</div>
			<span class={cn(
				'shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold leading-none',
				isOffline ? 'bg-destructive/15 text-destructive' :
				isWarning ? 'bg-yellow-500/15 text-yellow-500' :
				'bg-green-500/15 text-green-600 dark:text-green-400'
			)}>
				{isOffline ? 'Offline' : cluster.health}
			</span>
		</div>

		{#if cluster.labels.length > 0}
			<div class="flex flex-wrap gap-1 px-4 py-1.5 border-b border-border/40">
				{#each cluster.labels as label (label)}
					{@const preset = DEFAULT_LABELS.find((d) => d.name === label)}
					{@const color = preset?.color ?? 'blue'}
					<span class={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none', COLOR_BADGE[color] ?? COLOR_BADGE.blue)}>
						<span class={cn('inline-block size-1.5 rounded-full', COLOR_DOT[color] ?? COLOR_DOT.blue)}></span>
						{label}
					</span>
				{/each}
			</div>
		{/if}

		{#if isOffline}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 text-destructive/60">
				<XCircle class="size-14" />
				<div class="text-center">
					<p class="text-sm font-medium text-destructive">Cluster Offline</p>
					<p class="mt-0.5 text-xs text-muted-foreground">Unable to connect. Check your settings.</p>
				</div>
			</div>
		{:else}
			<!-- ── Two-panel body ── -->
			<div class="flex min-h-0 flex-1 gap-0">

				<!-- ══ LEFT PANEL: Resources ══ -->
				<div class="flex w-1/2 flex-col gap-3 border-r border-border/60 px-4 py-3">

					<!-- Pods + Nodes summary -->
					<div class="space-y-2">
						<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pods</p>
						<div class="flex items-center gap-1.5">
							<Box class="size-3.5 text-muted-foreground shrink-0" />
							<span class="text-xl font-bold tabular-nums">{cluster.runningPods}</span>
							<span class="text-xs text-muted-foreground">/ {cluster.pods} total</span>
						</div>
					</div>

					<div class="space-y-2">
						<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nodes</p>
						<div class="flex items-center gap-1.5">
							<Server class="size-3.5 text-muted-foreground shrink-0" />
							<span class="text-xl font-bold tabular-nums">{cluster.nodes}</span>
							<span class="text-xs text-muted-foreground">nodes</span>
						</div>
					</div>

					<div class="h-px bg-border/60"></div>
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Resources</p>

					<!-- CPU -->
					<div class="space-y-1.5">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5">
								<Cpu class="size-3.5 text-blue-500" />
								<span class="font-semibold">CPU</span>
							</div>
							<span class={cn('font-bold tabular-nums',
								cpuPercent > 80 ? 'text-destructive' : cpuPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{cpuPercent}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500', barColor(cpuPercent, 'bg-blue-500'))} style="width: {cpuPercent}%"></div>
						</div>
						<p class="text-[10px] text-muted-foreground">{formatCpu(cluster.cpuUsage)} / {formatCpu(cluster.cpuCapacity)} cores</p>
						{#if cluster.metricsAvailable}
							<div class="h-10 w-full opacity-80">
								<svg viewBox="0 0 200 40" class="h-full w-full" preserveAspectRatio="none">
									<defs>
										<linearGradient id="cpuGf-{cluster.id}" x1="0" x2="0" y1="0" y2="1">
											<stop offset="0%" stop-color="rgb(59 130 246)" stop-opacity="0.35" />
											<stop offset="100%" stop-color="rgb(59 130 246)" stop-opacity="0" />
										</linearGradient>
									</defs>
									<path d="{sparklinePath(cpuChartData, 200, 40)} L 200,40 L 0,40 Z" fill="url(#cpuGf-{cluster.id})" />
									<path d={sparklinePath(cpuChartData, 200, 40)} fill="none" stroke="rgb(59 130 246)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
								</svg>
							</div>
						{/if}
					</div>

					<!-- Memory -->
					<div class="space-y-1.5">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5">
								<Activity class="size-3.5 text-purple-500" />
								<span class="font-semibold">Memory</span>
							</div>
							<span class={cn('font-bold tabular-nums',
								memoryPercent > 80 ? 'text-destructive' : memoryPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{memoryPercent}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500', barColor(memoryPercent, 'bg-purple-500'))} style="width: {memoryPercent}%"></div>
						</div>
						<p class="text-[10px] text-muted-foreground">{formatMemory(cluster.memoryUsage)} / {formatMemory(cluster.memoryCapacity)}</p>
						{#if cluster.metricsAvailable}
							<div class="h-10 w-full opacity-80">
								<svg viewBox="0 0 200 40" class="h-full w-full" preserveAspectRatio="none">
									<defs>
										<linearGradient id="memGf-{cluster.id}" x1="0" x2="0" y1="0" y2="1">
											<stop offset="0%" stop-color="rgb(168 85 247)" stop-opacity="0.35" />
											<stop offset="100%" stop-color="rgb(168 85 247)" stop-opacity="0" />
										</linearGradient>
									</defs>
									<path d="{sparklinePath(memoryChartData, 200, 40)} L 200,40 L 0,40 Z" fill="url(#memGf-{cluster.id})" />
									<path d={sparklinePath(memoryChartData, 200, 40)} fill="none" stroke="rgb(168 85 247)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
								</svg>
							</div>
						{/if}
					</div>

					<!-- Disk -->
					<div class="space-y-1.5">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-1.5">
								<HardDrive class="size-3.5 text-orange-500" />
								<span class="font-semibold">Disk</span>
							</div>
							<span class={cn('font-bold tabular-nums',
								diskPercent > 80 ? 'text-destructive' : diskPercent > 60 ? 'text-yellow-500' : 'text-foreground'
							)}>{diskPercent}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
							<div class={cn('h-full rounded-full transition-all duration-500', barColor(diskPercent, 'bg-orange-500'))} style="width: {diskPercent}%"></div>
						</div>
						<p class="text-[10px] text-muted-foreground">{formatMemory(cluster.diskUsage)} / {formatMemory(cluster.diskCapacity)}</p>
					</div>
				</div>

				<!-- ══ RIGHT PANEL: Workloads + Events ══ -->
				<div class="flex w-1/2 flex-col gap-3 px-4 py-3 min-h-0">

					<!-- Workloads summary -->
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workloads</p>
					<div class="space-y-1">
						{#each [
							{ label: 'Namespaces', value: cluster.namespaces, icon: Layers,   color: 'text-blue-400'   },
							{ label: 'Pods',       value: cluster.pods,       icon: Box,      color: 'text-green-400'  },
							{ label: 'Nodes',      value: cluster.nodes,      icon: Server,   color: 'text-purple-400' }
						] as w}
							<div class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-muted/40 transition-colors">
								<w.icon class={cn('size-3.5 shrink-0', w.color)} />
								<span class="flex-1 text-xs text-muted-foreground">{w.label}</span>
								<span class="text-xs font-bold tabular-nums">{w.value}</span>
							</div>
						{/each}
					</div>

					<div class="h-px bg-border/60"></div>

					<!-- Recent Events -->
					<div class="flex items-center justify-between">
						<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Events</p>
						<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
							{recentEvents.length}
						</span>
					</div>

					{#if recentEvents.length === 0}
						<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">No recent events</div>
					{:else}
						<div class="flex flex-1 flex-col gap-1 overflow-y-auto min-h-0">
							{#each recentEvents as event}
								{@const isWarn = event.type === 'Warning'}
								{@const relTime = (() => {
									if (!event.lastSeen) return '';
									const d = new Date(event.lastSeen);
									if (isNaN(d.getTime())) return '';
									const s = Math.floor((Date.now() - d.getTime()) / 1000);
									if (s < 60) return 'now';
									if (s < 3600) return `${Math.floor(s/60)}m`;
									if (s < 86400) return `${Math.floor(s/3600)}h`;
									return `${Math.floor(s/86400)}d`;
								})()}
								<div class={cn(
									'flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
									isWarn ? 'bg-yellow-500/8 hover:bg-yellow-500/12' : 'hover:bg-muted/50'
								)}>
									<span class={cn(
										'mt-0.5 size-1.5 shrink-0 rounded-full',
										isWarn ? 'bg-yellow-500' : 'bg-blue-400'
									)}></span>
									<div class="min-w-0 flex-1">
										<div class="flex items-baseline justify-between gap-1">
											<span class={cn('truncate font-semibold', isWarn ? 'text-yellow-500' : '')}>{event.reason}</span>
											<span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">{relTime}</span>
										</div>
										<p class="line-clamp-1 text-muted-foreground">{event.message}</p>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

			</div>
		{/if}
	</div>
{/if}
</div>
