<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { cn } from '$lib/utils';
	import {
		RefreshCw,
		Copy,
		Check,
		Globe,
		Bug,
		FileText,
		Shield,
		Box,
		GitBranch,
		GitCommitHorizontal,
		Server,
		Code,
		Cpu,
		Database,
		MemoryStick
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	interface HealthData {
		build: { branch: string; commit: string; buildDate: string };
		uptime: { ms: number };
		runtime: {
			sveltekit: string;
			bunVersion: string;
			platform: string;
			arch: string;
			kernel: string;
			memory: { rss: number };
		};
		database: { type: string; schemaVersion: string; schemaDate: string };
	}

	let health = $state<HealthData | null>(null);
	let loading = $state(false);
	let copiedField = $state<string | null>(null);

	async function fetchHealth() {
		loading = true;
		try {
			const res = await fetch('/api/health');
			health = await res.json();
		} catch {
			/* ignore */
		} finally {
			loading = false;
		}
	}

	function formatUptime(ms: number): string {
		const s = Math.floor(ms / 1000);
		const h = Math.floor(s / 3600)
			.toString()
			.padStart(2, '0');
		const m = Math.floor((s % 3600) / 60)
			.toString()
			.padStart(2, '0');
		const sec = (s % 60).toString().padStart(2, '0');
		return `${h}:${m}:${sec}`;
	}

	function formatBytes(bytes: number): string {
		return (bytes / 1024 / 1024).toFixed(1) + ' MB';
	}

	async function copyToClipboard(text: string, field: string) {
		await navigator.clipboard.writeText(text);
		copiedField = field;
		setTimeout(() => (copiedField = null), 2000);
	}

	const links = [
		{ label: 'Official Website', href: 'https://autokube.io', icon: Globe },
		{ label: 'Report Issues', href: 'https://github.com/autokubeio/autokube/issues', icon: Bug },
		{ label: 'License Terms', href: 'https://autokube.io/license', icon: FileText },
		{ label: 'Privacy Policy', href: 'https://autokube.io/privacy', icon: Shield }
	];

	onMount(() => {
		fetchHealth();
	});
</script>

<div class="space-y-5">
	{#if health}
		<!-- Hero Header -->
		<div
			class="relative overflow-hidden rounded-xl border bg-linear-to-br from-primary/5 via-background to-primary/10 p-6"
		>
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-4">
					<div
						class="flex size-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20"
					>
						<Box class="size-6 text-primary" />
					</div>
					<div>
						<h2 class="text-xl font-bold tracking-tight">AutoKube</h2>
						<p class="text-sm text-muted-foreground">Kubernetes Management Platform</p>
						<div class="mt-2 flex flex-wrap items-center gap-2">
							<Badge variant="secondary" class="gap-1 font-mono text-xs">
								<GitBranch class="size-3" />
								{health.build.branch}
							</Badge>
							<Badge variant="outline" class="gap-1 font-mono text-xs">
								<GitCommitHorizontal class="size-3" />
								{health.build.commit.slice(0, 7)}
								<button
									class="ml-0.5 text-muted-foreground transition-colors hover:text-foreground"
									onclick={() => copyToClipboard(health!.build.commit, 'commit')}
								>
									{#if copiedField === 'commit'}<Check class="size-2.5" />{:else}<Copy
											class="size-2.5"
										/>{/if}
								</button>
							</Badge>
							<Badge
								variant="outline"
								class="gap-1 border-green-500/30 text-xs text-green-600 dark:text-green-400"
							>
								<span class="size-1.5 animate-pulse rounded-full bg-green-500"></span>
								Running
							</Badge>
						</div>
					</div>
				</div>
				<Button variant="ghost" size="icon" class="size-8" onclick={fetchHealth} disabled={loading}>
					<RefreshCw class={cn('size-3.5', loading && 'animate-spin')} />
				</Button>
			</div>
			<Separator class="my-4" />
			<div class="grid grid-cols-3 gap-4">
				<div>
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Built</p>
					<p class="mt-1 text-sm font-semibold">{health.build.buildDate}</p>
				</div>
				<div>
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Uptime</p>
					<p class="mt-1 font-mono text-sm font-semibold">{formatUptime(health.uptime.ms)}</p>
				</div>
				<div>
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Memory</p>
					<p class="mt-1 font-mono text-sm font-semibold">
						{formatBytes(health.runtime.memory.rss)}
					</p>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-5">
			<!-- Runtime -->
			<Card.Root>
				<Card.Header class="pb-3">
					<Card.Title class="flex items-center gap-2 text-sm font-medium">
						<Server class="size-4 text-muted-foreground" />
						Runtime
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-0 divide-y py-0">
					{@const runtimeRows = [
						{ label: 'Bun', value: health.runtime.bunVersion, icon: Box },
						{ label: 'SvelteKit', value: health.runtime.sveltekit, icon: Code },
						{
							label: 'Platform',
							value: `${health.runtime.platform} / ${health.runtime.arch}`,
							icon: Cpu
						},
						{ label: 'Kernel', value: health.runtime.kernel, icon: Server }
					]}
					{#each runtimeRows as row}
						<div class="flex items-center justify-between py-2.5">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<row.icon class="size-3.5" />
								{row.label}
							</div>
							<span class="font-mono text-sm font-medium">{row.value}</span>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>

			<!-- Database -->
			<Card.Root>
				<Card.Header class="pb-3">
					<Card.Title class="flex items-center gap-2 text-sm font-medium">
						<Database class="size-4 text-muted-foreground" />
						Database
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-0 divide-y py-0">
					<div class="flex items-center justify-between py-2.5">
						<span class="text-sm text-muted-foreground">Type</span>
						<Badge variant="secondary" class="font-mono text-xs">{health.database.type}</Badge>
					</div>
					<div class="flex items-center justify-between py-2.5">
						<span class="text-sm text-muted-foreground">Schema</span>
						<span class="font-mono text-sm font-medium">{health.database.schemaVersion}</span>
					</div>
					<div class="flex items-center justify-between py-2.5">
						<span class="text-sm text-muted-foreground">Migrated</span>
						<span class="font-mono text-sm font-medium">{health.database.schemaDate}</span>
					</div>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Links -->
		<div class="grid grid-cols-4 gap-3">
			{#each links as link}
				<a
					href={link.href}
					target="_blank"
					rel="noopener noreferrer"
					class="group flex flex-col items-center gap-2 rounded-lg border px-4 py-4 text-center transition-colors hover:border-primary/20 hover:bg-muted/50"
				>
					<div
						class="flex size-8 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary/10"
					>
						<link.icon
							class="size-4 text-muted-foreground transition-colors group-hover:text-primary"
						/>
					</div>
					<span class="text-xs font-medium">{link.label}</span>
				</a>
			{/each}
		</div>
	{:else}
		<div class="flex flex-col items-center justify-center gap-3 py-16">
			<RefreshCw class="size-5 animate-spin text-muted-foreground" />
			<p class="text-sm text-muted-foreground">Loading system information…</p>
		</div>
	{/if}
</div>
