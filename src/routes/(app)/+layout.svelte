<script lang="ts">
	import '../layout.css';
	import type { LayoutData } from './$types';
	import favicon from '$lib/assets/favicon.svg';
	import { SidebarProvider, SidebarInset, SidebarTrigger } from '$lib/components/ui/sidebar';
	import { Separator } from '$lib/components/ui/separator';
	import { toast } from 'svelte-sonner';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import CommandPalette from '$lib/components/command-palette.svelte';
	import ClusterStatusBar from '$lib/components/cluster-status-bar.svelte';
	import { ModeWatcher, toggleMode } from 'mode-watcher';
	import { Sun, Moon, Search, Brain } from 'lucide-svelte';
	import AiClusterChat from '$lib/components/ai-cluster-chat.svelte';
	import { page } from '$app/state';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { menuCategories, bottomItems } from '$lib/nav-data';
	import { mode } from 'mode-watcher';
	import { onMount, onDestroy } from 'svelte';

	let { children, data }: { children: any; data: LayoutData } = $props();

	const cluster = $derived(clusterStore.active);
	const allClusters = $derived(clusterStore.all);

	// Apply all saved settings on mount
	onMount(async () => {
		settingsStore.applyAll(mode.current);
		// Fetch cluster data and start real-time status polling
		await clusterStore.fetchClusters();
		clusterStore.startPolling();
	});

	onDestroy(() => {
		clusterStore.stopPolling();
	});

	// Re-apply theme class when mode changes
	$effect(() => {
		settingsStore.applyAll(mode.current);
	});

	function selectCluster(c: typeof cluster) {
		if (c) {
			clusterStore.setActive(c);
			toast.success(`Switched to "${c.name}"`, {
				description: c.status === 'connected' ? `${c.version} · ${c.health}` : 'Connecting...'
			});
		}
	}

	// Ctrl+Number to switch clusters (Ctrl+1 = first, Ctrl+2 = second, etc.)
	function handleKeydown(e: KeyboardEvent) {
		if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
		const num = parseInt(e.key);
		if (num >= 1 && num <= 9 && num <= allClusters.length) {
			e.preventDefault();
			selectCluster(allClusters[num - 1]);
		}
	}

	let commandPalette: ReturnType<typeof CommandPalette>;
	let showAiChat = $state(false);

	const breadcrumbs = $derived(() => {
		const path = page.url.pathname;
		const crumbs: { label: string; href?: string }[] = [{ label: 'AutoKube', href: '/' }];

		if (path === '/') {
			crumbs.push({ label: 'Dashboard' });
			return crumbs;
		}

		// Check if path matches a category item
		for (const cat of menuCategories) {
			const item = cat.items.find((i) => i.href === path);
			if (item) {
				crumbs.push({ label: cat.label });
				crumbs.push({ label: item.label });
				return crumbs;
			}
		}

		// Check system / bottom items
		const bottomItem = bottomItems.find((i) => i.href === path);
		if (bottomItem) {
			crumbs.push({ label: bottomItem.label });
			return crumbs;
		}

		// Fallback: capitalize path segments
		const segments = path.split('/').filter(Boolean);
		for (const seg of segments) {
			crumbs.push({ label: seg.charAt(0).toUpperCase() + seg.slice(1) });
		}
		return crumbs;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<ModeWatcher />
<SidebarProvider>
	<AppSidebar authEnabled={data.authEnabled} user={data.user} />
	<SidebarInset>
		<header
			class="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-9"
		>
			<div class="flex min-w-0 items-center gap-2">
				<SidebarTrigger class="-ml-1 shrink-0" />
				<Separator orientation="vertical" class="mr-2 h-4! shrink-0" />
				<Breadcrumb.Root class="min-w-0">
					<Breadcrumb.List class="flex-nowrap">
						{#each breadcrumbs() as crumb, i}
							{@const isLast = i === breadcrumbs().length - 1}
							{@const isFirst = i === 0}

							{#if isFirst && !isLast}
								<!-- Desktop: show as link; Mobile: collapse to ellipsis -->
								<Breadcrumb.Item class="hidden sm:flex">
									<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
								</Breadcrumb.Item>
								<Breadcrumb.Item class="sm:hidden">
									<Breadcrumb.Ellipsis />
								</Breadcrumb.Item>
								<Breadcrumb.Separator />
							{:else if !isFirst && !isLast}
								<!-- Middle items: desktop only -->
								<Breadcrumb.Item class="hidden sm:flex">
									<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
								</Breadcrumb.Item>
								<Breadcrumb.Separator class="hidden sm:flex" />
							{:else}
								<!-- Current page: always visible, truncate if needed -->
								<Breadcrumb.Item>
									<Breadcrumb.Page class="max-w-30 truncate sm:max-w-none"
										>{crumb.label}</Breadcrumb.Page
									>
								</Breadcrumb.Item>
							{/if}
						{/each}
					</Breadcrumb.List>
				</Breadcrumb.Root>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<!-- Mobile: icon-only -->
				<Button
					variant="outline"
					size="icon"
					class="size-7 sm:hidden"
					onclick={() => commandPalette.toggle()}
				>
					<Search class="size-3.5" />
				</Button>
				<!-- Desktop: full search bar -->
				<Button
					variant="outline"
					class="hidden h-7 w-52 justify-start gap-2 text-xs text-muted-foreground sm:inline-flex"
					onclick={() => commandPalette.toggle()}
				>
					<Search class="size-3.5" />
					<span>Search...</span>
					<kbd
						class="pointer-events-none ml-auto inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none"
					>
						<span class="text-xs">⌘</span>K
					</kbd>
				</Button>
				<Button
					variant="ghost"
					size="icon"
					class="size-7 text-violet-400 hover:text-violet-300"
					title="AI Assistant"
					disabled={!cluster}
					onclick={() => (showAiChat = true)}
				>
					<Brain class="size-4" />
					<span class="sr-only">AI Assistant</span>
				</Button>
				<Button variant="ghost" size="icon" onclick={toggleMode} class="size-7">
					<Sun class="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
					<Moon
						class="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
					/>
					<span class="sr-only">Toggle theme</span>
				</Button>
			</div>
		</header>
		{#if cluster}
			<ClusterStatusBar {cluster} {allClusters} onSelectCluster={selectCluster} />
		{/if}
		<div class="flex flex-1 flex-col gap-4 overflow-auto p-4">
			{@render children()}
		</div>
	</SidebarInset>
</SidebarProvider>

<CommandPalette bind:this={commandPalette} />
<AiClusterChat bind:open={showAiChat} cluster={cluster} onClose={() => (showAiChat = false)} />
