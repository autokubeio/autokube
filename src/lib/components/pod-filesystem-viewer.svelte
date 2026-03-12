<!--
  Pod Filesystem Viewer — bottom drawer to browse container filesystems.

  Features
  ─────────
  • Slide-up drawer from the bottom (drag-handle to resize)
  • Container selector for multi-container pods
  • Breadcrumb navigation
  • Tree listing with file type, permissions, size, owner, symlink targets
  • Search/filter over current directory entries
  • Download individual files
  • Error and loading states

  Usage
  ─────
  <PodFilesystemViewer
    bind:open
    clusterId={activeCluster.id}
    pod={selectedPod}
    onClose={() => (selectedPod = null)}
  />
-->

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import {
		X,
		GripHorizontal,
		FolderOpen,
		Folder,
		FileText,
		Link2,
		Download,
		RefreshCw,
		AlertCircle,
		Loader2,
		Search,
		ChevronRight,
		Home,
		HardDrive,
		Zap
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	// ── Types ─────────────────────────────────────────────────────────────────

	export type FilesystemEntry = {
		name: string;
		type: 'd' | 'f' | 'l' | 'b' | 'c' | 'p' | 's' | '?';
		permissions: string;
		size: number;
		owner: string;
		group: string;
		symlink: string;
	};

	export type FilesystemPod = {
		name: string;
		namespace: string;
		containers: Array<{ name: string; image: string; ready: boolean; state: string }>;
	};

	type Props = {
		open?: boolean;
		clusterId: number;
		pod: FilesystemPod | null;
		onClose?: () => void;
	};

	// ── Props ─────────────────────────────────────────────────────────────────

	let { open = $bindable(false), clusterId, pod, onClose }: Props = $props();

	// ── Constants ─────────────────────────────────────────────────────────────

	const MIN_HEIGHT = 220;
	const MAX_HEIGHT_RATIO = 0.85;
	const DEFAULT_HEIGHT = 400;

	// ── State ─────────────────────────────────────────────────────────────────

	let panelEl = $state<HTMLElement>();
	let panelHeight = $state(DEFAULT_HEIGHT);
	let isDragging = $state(false);

	let selectedContainer = $state('');
	let currentPath = $state('/');
	let entries = $state<FilesystemEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let searchQuery = $state('');
	let downloadingPath = $state<string | null>(null);

	// ── Derived ───────────────────────────────────────────────────────────────

	const isOpen = $derived(open && !!pod);

	const containers = $derived(pod?.containers ?? []);

	const breadcrumbs = $derived.by(() => {
		const parts = currentPath.split('/').filter(Boolean);
		const crumbs: { label: string; path: string }[] = [{ label: '/', path: '/' }];
		let acc = '';
		for (const p of parts) {
			acc += '/' + p;
			crumbs.push({ label: p, path: acc });
		}
		return crumbs;
	});

	const filteredEntries = $derived.by(() => {
		if (!searchQuery.trim()) return entries;
		const q = searchQuery.toLowerCase();
		return entries.filter(
			(e) =>
				e.name.toLowerCase().includes(q) ||
				e.symlink.toLowerCase().includes(q) ||
				e.owner.toLowerCase().includes(q)
		);
	});

	// ── Effects ───────────────────────────────────────────────────────────────

	$effect(() => {
		if (isOpen && pod) {
			// Set default container when pod changes
			if (containers.length > 0 && !containers.find((c) => c.name === selectedContainer)) {
				selectedContainer = containers[0].name;
			}
			fetchDirectory(currentPath);
		}
	});

	$effect(() => {
		// Re-fetch when container is manually changed
		if (isOpen && selectedContainer) {
			fetchDirectory(currentPath);
		}
	});

	onDestroy(() => {
		// nothing to cleanup
	});

	// ── Fetch ─────────────────────────────────────────────────────────────────

	async function fetchDirectory(path: string) {
		if (!pod || !selectedContainer) return;
		loading = true;
		error = null;
		try {
			const params = new URLSearchParams({
				cluster: String(clusterId),
				namespace: pod.namespace,
				pod: pod.name,
				container: selectedContainer,
				path
			});
			const res = await fetch(`/api/pods/filesystem?${params}`);
			const data = await res.json();
			if (data.success) {
				entries = data.entries ?? [];
				currentPath = data.path ?? path;
				searchQuery = '';
			} else {
				error = data.error ?? 'Failed to list directory';
				entries = [];
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to list directory';
			entries = [];
		} finally {
			loading = false;
		}
	}

	function navigate(path: string) {
		fetchDirectory(path);
	}

	function navigateInto(entry: FilesystemEntry) {
		if (entry.type !== 'd') return;
		const newPath = (currentPath === '/' ? '' : currentPath) + '/' + entry.name;
		navigate(newPath.replace(/\/+/g, '/'));
	}

	function navigateUp() {
		if (currentPath === '/') return;
		const parts = currentPath.split('/').filter(Boolean);
		parts.pop();
		navigate(parts.length === 0 ? '/' : '/' + parts.join('/'));
	}

	async function downloadFile(entry: FilesystemEntry) {
		if (!pod || !selectedContainer) return;
		const filePath = ((currentPath === '/' ? '' : currentPath) + '/' + entry.name).replace(/\/+/g, '/');
		downloadingPath = filePath;
		try {
			const params = new URLSearchParams({
				cluster: String(clusterId),
				namespace: pod.namespace,
				pod: pod.name,
				container: selectedContainer,
				path: filePath
			});
			const res = await fetch(`/api/pods/filesystem/download?${params}`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				// Symlink points to a directory — navigate into it instead
				if (data.error === 'IS_DIRECTORY') {
					navigate(filePath);
					return;
				}
				throw new Error(data.error ?? `Download failed: ${res.status}`);
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = entry.name;
			a.click();
			URL.revokeObjectURL(url);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Download failed');
		} finally {
			downloadingPath = null;
		}
	}

	function handleClose() {
		open = false;
		onClose?.();
	}

	// ── Drag-to-resize ────────────────────────────────────────────────────────

	function onHandlePointerDown(e: PointerEvent) {
		isDragging = true;
		const startY = e.clientY;
		const startH = panelHeight;

		function onMove(me: PointerEvent) {
			const delta = startY - me.clientY;
			const maxH = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
			panelHeight = Math.max(MIN_HEIGHT, Math.min(maxH, startH + delta));
		}

		function onUp() {
			requestAnimationFrame(() => (isDragging = false));
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
		}

		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'K', 'M', 'G', 'T'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const val = bytes / Math.pow(1024, i);
		return (i === 0 ? val.toString() : val.toFixed(1)) + ' ' + units[i];
	}

	function isExecutable(entry: FilesystemEntry): boolean {
		return /x/.test(entry.permissions.slice(1, 4));
	}

	type IconDef = { component: typeof Folder; class: string };

	function getEntryIcon(entry: FilesystemEntry): IconDef {
		if (entry.type === 'd') return { component: Folder, class: 'text-blue-400' };
		if (entry.type === 'l') return { component: Link2, class: 'text-purple-400' };
		if (entry.type === 'f' && isExecutable(entry)) return { component: Zap, class: 'text-green-400' };
		return { component: FileText, class: 'text-zinc-400' };
	}

</script>

<!-- ── Overlay ────────────────────────────────────────────────────────────── -->
{#if isOpen}
	<div class="pointer-events-none fixed inset-0 z-40"
		style="background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.2) 100%)">
	</div>
{/if}

<!-- ── Panel ──────────────────────────────────────────────────────────────── -->
<div
	bind:this={panelEl}
	class={cn(
		'fixed bottom-0 left-0 right-0 z-50 flex flex-col',
		'border-t border-zinc-700/60 bg-zinc-950 shadow-2xl shadow-black/60',
		'transition-transform duration-300 ease-out',
		isOpen ? 'translate-y-0' : 'translate-y-full'
	)}
	style="height: {panelHeight}px"
>
	<!-- ── Drag handle ──────────────────────────────────────────────────── -->
	<div
		class={cn(
			'flex h-5 shrink-0 cursor-ns-resize items-center justify-center',
			'border-b border-zinc-700/40 bg-zinc-900/80 hover:bg-zinc-800/80',
			isDragging && 'bg-zinc-800/80'
		)}
		onpointerdown={onHandlePointerDown}
		role="separator"
		aria-orientation="horizontal"
		aria-label="Drag to resize filesystem panel"
	>
		<GripHorizontal class="size-3.5 text-zinc-500" />
	</div>

	<!-- ── Header ──────────────────────────────────────────────────────── -->
	<div class="flex shrink-0 items-center gap-2 border-b border-zinc-700/40 bg-zinc-900/60 px-3 py-1.5">
		<HardDrive class="size-3.5 shrink-0 text-zinc-400" />
			<span class="max-w-45 truncate font-mono text-xs font-semibold text-zinc-200">
			{pod?.name ?? ''}
		</span>
		<Badge
			variant="outline"
			class="h-4 shrink-0 border-zinc-600 px-1 py-0 font-mono text-[10px] text-zinc-400"
		>
			{pod?.namespace ?? ''}
		</Badge>

		<!-- Container selector -->
		{#if containers.length > 1}
			<Select.Root
				type="single"
				value={selectedContainer}
				onValueChange={(v: string) => { if (v) selectedContainer = v; }}
			>
				<Select.Trigger
					size="sm"
					class="h-6! min-w-25 max-w-40 rounded-sm! border-zinc-700! bg-zinc-800! px-2! py-0! text-[11px]! text-zinc-300! shadow-none! hover:bg-zinc-700!"
				>
					{selectedContainer || 'container'}
				</Select.Trigger>
				<Select.Content class="border-zinc-700! bg-zinc-900! text-zinc-300!">
					{#each containers as c (c.name)}
						<Select.Item
							value={c.name}
							class="text-xs! text-zinc-300! data-highlighted:bg-zinc-800! data-highlighted:text-zinc-100!"
						>
							{c.name}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{:else if containers.length === 1}
			<span class="font-mono text-[11px] text-zinc-500">{selectedContainer}</span>
		{/if}

		<div class="flex-1"></div>

		<!-- Search -->
		<div class="relative">
			<Search class="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
			<Input
				placeholder="Filter entries…"
				bind:value={searchQuery}
				class="h-6 w-40 rounded-sm border-zinc-700 bg-zinc-800 pl-7 text-[11px] text-zinc-300 placeholder:text-zinc-600 focus-visible:ring-zinc-600"
			/>
		</div>

		<!-- Refresh -->
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={() => fetchDirectory(currentPath)}
						disabled={loading}
					>
						<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Refresh</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>

		<!-- Close -->
		<Button
			variant="ghost"
			size="icon"
			class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
			onclick={handleClose}
		>
			<X class="size-3" />
		</Button>
	</div>

	<!-- ── Breadcrumb ───────────────────────────────────────────────────── -->
	<div class="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-1">
		{#each breadcrumbs as crumb, i (crumb.path)}
			{#if i > 0}
				<ChevronRight class="size-3 shrink-0 text-zinc-600" />
			{/if}
			{#if i === 0}
				<button
					class={cn(
						'flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] transition-colors',
						currentPath === '/'
							? 'text-zinc-200'
							: 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
					)}
					onclick={() => navigate('/')}
				>
					<Home class="size-2.5" />
				</button>
			{:else}
				<button
					class={cn(
						'rounded px-1 py-0.5 font-mono text-[11px] transition-colors whitespace-nowrap',
						i === breadcrumbs.length - 1
							? 'text-zinc-200'
							: 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
					)}
					onclick={() => navigate(crumb.path)}
				>
					{crumb.label}
				</button>
			{/if}
		{/each}

		{#if !loading && filteredEntries.length > 0}
			<span class="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
				{filteredEntries.length}{filteredEntries.length !== entries.length ? `/${entries.length}` : ''} entries
			</span>
		{/if}
	</div>

	<!-- ── Content ──────────────────────────────────────────────────────── -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if loading}
			<div class="flex h-full items-center justify-center gap-2 text-zinc-500">
				<Loader2 class="size-4 animate-spin" />
				<span class="text-xs">Loading…</span>
			</div>
		{:else if error}
			<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
				<AlertCircle class="size-8 text-red-400/60" />
				<div>
					<p class="text-sm font-medium text-zinc-300">Failed to list directory</p>
					<p class="mt-1 max-w-md text-xs text-zinc-500">{error}</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					class="h-7 border-zinc-700 bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700"
					onclick={() => fetchDirectory(currentPath)}
				>
					<RefreshCw class="mr-1.5 size-3" /> Retry
				</Button>
			</div>
		{:else if filteredEntries.length === 0 && !searchQuery}
			<div class="flex h-full items-center justify-center">
				<p class="text-xs text-zinc-600">Directory is empty</p>
			</div>
		{:else if filteredEntries.length === 0}
			<div class="flex h-full items-center justify-center">
				<p class="text-xs text-zinc-600">No entries match "<span class="text-zinc-400">{searchQuery}</span>"</p>
			</div>
		{:else}
			<!-- File table -->
			<table class="w-full border-collapse text-[11px]">
				<thead class="sticky top-0 z-10 bg-zinc-900/90">
					<tr class="border-b border-zinc-800/60 text-zinc-500">
						<th class="px-3 py-1 text-left font-medium">Name</th>
						<th class="hidden px-2 py-1 text-left font-medium sm:table-cell">Permissions</th>
						<th class="px-2 py-1 text-right font-medium">Size</th>
						<th class="hidden px-2 py-1 text-left font-medium md:table-cell">Owner</th>
						<th class="w-8 px-2 py-1"></th>
					</tr>
				</thead>
				<tbody>
					<!-- ".." row for navigation up -->
					{#if currentPath !== '/'}
						<tr
							class="cursor-pointer border-b border-zinc-800/30 hover:bg-zinc-800/30"
							onclick={navigateUp}
						>
							<td class="px-3 py-1" colspan="5">
								<div class="flex items-center gap-2 text-zinc-500 hover:text-zinc-300">
									<FolderOpen class="size-3.5 text-blue-400/60" />
									<span class="font-mono">..</span>
								</div>
							</td>
						</tr>
					{/if}

					{#each filteredEntries as entry (entry.name)}
						{@const icon = getEntryIcon(entry)}
						{@const isDir = entry.type === 'd'}
						{@const isDownloading = downloadingPath === (currentPath === '/' ? '' : currentPath) + '/' + entry.name}
						<tr
							class={cn(
								'border-b border-zinc-800/30 transition-colors',
								isDir ? 'cursor-pointer hover:bg-zinc-800/30' : 'hover:bg-zinc-800/20'
							)}
							onclick={isDir ? () => navigateInto(entry) : undefined}
						>
							<!-- Name -->
							<td class="py-1 pl-3 pr-1">
								<div class="flex min-w-0 items-center gap-2">
									<icon.component class={cn('size-3.5 shrink-0', icon.class)} />
									<span class={cn('truncate font-mono', isDir ? 'text-zinc-200' : 'text-zinc-300')}>
										{entry.name}
									</span>
									{#if entry.symlink}
										<span class="shrink-0 text-zinc-600">→ {entry.symlink}</span>
									{/if}
								</div>
							</td>
							<!-- Permissions -->
							<td class="hidden px-2 py-1 sm:table-cell">
								<span class="font-mono text-zinc-500">{entry.permissions}</span>
							</td>
							<!-- Size -->
							<td class="px-2 py-1 text-right">
								{#if entry.type === 'f'}
									<span class="font-mono text-zinc-500">{formatSize(entry.size)}</span>
								{:else}
									<span class="text-zinc-700">—</span>
								{/if}
							</td>
							<!-- Owner -->
							<td class="hidden px-2 py-1 md:table-cell">
								<span class="text-zinc-600">{entry.owner}{entry.group && entry.group !== entry.owner ? ':' + entry.group : ''}</span>
							</td>
							<!-- Download -->
							<td class="px-2 py-1 text-right">
								{#if entry.type === 'f' || entry.type === 'l'}
									<Tooltip.Provider>
										<Tooltip.Root>
											<Tooltip.Trigger>
												<Button
													variant="ghost"
													size="icon"
													class="h-5 w-5 text-zinc-600 hover:text-zinc-300"
													onclick={(e) => { e.stopPropagation(); downloadFile(entry); }}
													disabled={!!downloadingPath}
												>
													{#if isDownloading}
														<Loader2 class="size-3 animate-spin" />
													{:else}
														<Download class="size-3" />
													{/if}
												</Button>
											</Tooltip.Trigger>
											<Tooltip.Content>Download</Tooltip.Content>
										</Tooltip.Root>
									</Tooltip.Provider>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<!-- ── Footer / status bar ──────────────────────────────────────────── -->
	<div class="flex shrink-0 items-center gap-3 border-t border-zinc-800/60 bg-zinc-900/60 px-3 py-1">
		<span class="font-mono text-[10px] text-zinc-600">{currentPath}</span>
		{#if downloadingPath}
			<span class="flex items-center gap-1 text-[10px] text-zinc-500">
				<Loader2 class="size-3 animate-spin" />
				Downloading…
			</span>
		{/if}
	</div>
</div>
