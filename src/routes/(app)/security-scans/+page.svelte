<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		Shield,
		RefreshCw,
		Search,
		ShieldCheck,
		Loader2,
		Eye,
		Trash2,
		ChevronDown,
		Check,
		AlertTriangle,
		AlertCircle,
		Info,
		Clock,
		XCircle,
		Square,
		RotateCcw,
		X
	} from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import { imageScansStore, type ImageScanListItem } from '$lib/stores/image-scans.svelte';
	import { clusterStore } from '$lib/stores/cluster.svelte';
	import { DataTableView, type DataTableSortState } from '$lib/components/data-table-view';
	import { TableName, imageScansColumns } from '$lib/table-columns';
	import ScanDialog from '$lib/components/scan-dialog.svelte';
	import ScanDetailDialog from '$lib/components/scan-detail-dialog.svelte';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';
	import { toast } from 'svelte-sonner';

	// ── State ──────────────────────────────────────────────────

	let searchQuery = $state('');
	let statusFilter = $state<string>('');
	let severityFilter = $state<string>('');
	const groupByImage = true;
	let sortState = $state<DataTableSortState | undefined>(undefined);

	let showScanDialog = $state(false);
	let showDetailDialog = $state(false);
	let selectedScanId = $state<number | null>(null);
	let deleting = $state(false);

	// ── Multi-select state ────────────────────────────────────

	let selectedScanIds = $state(new Set<unknown>());
	let bulkDeleting = $state(false);
	let bulkScanning = $state(false);

	// ── Expandable row state ───────────────────────────────────

	let expandedKeys = $state(new Set<unknown>());
	let scanHistoryCache = $state<Record<string, { loading: boolean; history: ImageScanListItem[] }>>({});

	function historyKey(scan: ImageScanListItem): string {
		return `${scan.image}:${scan.tag ?? 'latest'}`;
	}

	async function handleExpandChange(key: unknown, expanded: boolean) {
		if (!expanded) return;
		const scan = filteredScans.find((s) => s.id === key);
		if (!scan || (scan.scanCount ?? 1) <= 1) return;
		const hKey = historyKey(scan);
		if (scanHistoryCache[hKey]?.history.length) return;
		scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: true, history: [] } };
		try {
			const history = await imageScansStore.fetchScanHistory(
				scan.image,
				scan.tag ?? 'latest',
				clusterStore.active?.id
			);
			scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history } };
		} catch {
			scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: [] } };
		}
	}

	/** Re-fetch history for a single scan and update the cache in place. */
	async function refreshHistoryForScan(scan: ImageScanListItem) {
		const hKey = historyKey(scan);
		// Keep existing entries visible while loading so the panel doesn't flash empty
		scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: true, history: scanHistoryCache[hKey]?.history ?? [] } };
		try {
			const history = await imageScansStore.fetchScanHistory(
				scan.image,
				scan.tag ?? 'latest',
				clusterStore.active?.id
			);
			scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history } };
		} catch {
			scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: [] } };
		}
	}

	// ── Derived ────────────────────────────────────────────────

	const filteredScans = $derived.by(() => {
		let result = imageScansStore.scans;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			result = result.filter(
				(s) =>
					s.image.toLowerCase().includes(q) ||
					s.tag?.toLowerCase().includes(q) ||
					s.resource?.toLowerCase().includes(q)
			);
		}
		if (sortState) {
			const { field, direction } = sortState;
			const dir = direction === 'asc' ? 1 : -1;
			result = [...result].sort((a, b) => {
				let av: unknown;
				let bv: unknown;
				if (field === 'critical' || field === 'high' || field === 'medium' || field === 'low') {
					av = a.parsedSummary?.[field as keyof typeof a.parsedSummary] ?? 0;
					bv = b.parsedSummary?.[field as keyof typeof b.parsedSummary] ?? 0;
				} else {
					av = a[field as keyof typeof a];
					bv = b[field as keyof typeof b];
				}
				if (av == null && bv == null) return 0;
				if (av == null) return 1;
				if (bv == null) return -1;
				if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
				return String(av).localeCompare(String(bv)) * dir;
			});
		}
		return result;
	});

	// Compute totals directly from the same rows visible in the table.
	// This guarantees the stat cards always match what the user sees,
	// regardless of cluster/filter/search — no separate API call needed.
	const vulnTotals = $derived.by(() => {
		let critical = 0, high = 0, medium = 0, low = 0;
		for (const s of filteredScans) {
			if (s.parsedSummary) {
				critical += s.parsedSummary.critical;
				high += s.parsedSummary.high;
				medium += s.parsedSummary.medium;
				low += s.parsedSummary.low;
			}
		}
		return { critical, high, medium, low };
	});

	// ── Helpers ────────────────────────────────────────────────

	function statusIcon(status: string) {
		switch (status) {
			case 'completed': return ShieldCheck;
			case 'scanning': return Loader2;
			case 'pending': return Clock;
			case 'failed': return XCircle;
			default: return Info;
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'completed': return 'text-green-600 dark:text-green-400';
			case 'scanning': return 'text-blue-600 dark:text-blue-400';
			case 'pending': return 'text-yellow-600 dark:text-yellow-400';
			case 'failed': return 'text-red-600 dark:text-red-400';
			default: return 'text-muted-foreground';
		}
	}


	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '—';
		try {
			return new Date(dateStr).toLocaleString();
		} catch {
			return dateStr;
		}
	}

	// ── Lifecycle / Derived ──────────────────────────────────

	// Derived primitive — prevents the $effect below from tracking the full
	// `active` object reference. The 30s polling reassigns `active` to a new
	// object with the SAME id, which would otherwise re-trigger the effect and
	// call fetchScans(true) → collapsing expanded rows.
	const activeClusterId = $derived(clusterStore.active?.id);
	const scanningEnabled = $derived(clusterStore.active?.scanEnabled === true);

	// True whenever any scan in the current list is still running.
	// Used to keep the polling effect alive until the DB reflects the final state.
	const hasActiveScans = $derived(
		imageScansStore.scans.some((s) => s.status === 'pending' || s.status === 'scanning')
	);

	// ── Handlers ───────────────────────────────────────────────

	async function fetchScans(resetExpanded = false) {
		if (resetExpanded) {
			expandedKeys = new Set();
			scanHistoryCache = {};
		}
		// Use the derived primitive (activeClusterId) instead of clusterStore.active?.id directly.
		// This prevents the $effect from tracking the full `active` object reference —
		// only the id value matters, and $derived won't propagate when id hasn't changed.
		await imageScansStore.fetchScans({
			clusterId: activeClusterId,
			status: statusFilter || undefined,
			severity: severityFilter || undefined,
			grouped: groupByImage
		});

		// After the main list refreshes, update history for any currently-open expanded rows
		// whose data may have changed (new rescan created, scan completed, etc.).
		if (!resetExpanded && expandedKeys.size > 0) {
			for (const key of expandedKeys) {
				const scan = imageScansStore.scans.find((s) => s.id === key);
				if (!scan) continue;
				const hKey = historyKey(scan);
				const cached = scanHistoryCache[hKey];
				if (!cached) continue;
				// Refresh if scanCount changed (new scan added) OR any entry is still active
				const countChanged = cached.history.length !== (scan.scanCount ?? 1);
				const hasActiveEntry = cached.history.some(
					(h) => h.status === 'pending' || h.status === 'scanning'
				);
				if (countChanged || hasActiveEntry) {
					refreshHistoryForScan(scan);
				}
			}
		}
	}

	function handleViewScan(scan: ImageScanListItem) {
		selectedScanId = scan.id;
		showDetailDialog = true;
	}

	async function handleDeleteScan(scanId: number) {
		deleting = true;
		try {
			await imageScansStore.deleteScan(scanId);
			toast.success('Scan deleted');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete scan');
		} finally {
			deleting = false;
		}
	}

	async function handleDeleteAllHistory(parentScan: ImageScanListItem) {
		deleting = true;
		const hKey = historyKey(parentScan);
		const entries = scanHistoryCache[hKey]?.history ?? [];
		try {
			await Promise.all(entries.map((e) => imageScansStore.deleteScan(e.id)));
			toast.success(`Deleted all ${entries.length} scans for ${parentScan.image}:${parentScan.tag ?? 'latest'}`);
			expandedKeys = new Set([...expandedKeys].filter((k) => k !== parentScan.id));
			scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: [] } };
			await fetchScans();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete all scans');
		} finally {
			deleting = false;
		}
	}

	async function handleDeleteHistoryEntry(entryId: number, parentScan: ImageScanListItem) {
		deleting = true;
		try {
			await imageScansStore.deleteScan(entryId);
			toast.success('Scan deleted');
			// Optimistically remove from cache
			const hKey = historyKey(parentScan);
			const remaining = (scanHistoryCache[hKey]?.history ?? []).filter((h) => h.id !== entryId);
			if (remaining.length === 0) {
				// No more history — close row and remove from parent list too
				expandedKeys = new Set([...expandedKeys].filter((k) => k !== parentScan.id));
				scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: [] } };
				await fetchScans();
			} else {
				scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: remaining } };
				// If the deleted entry was the latest (first), refresh parent row from cache
				if (remaining.length > 0) {
					await fetchScans();
				}
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete scan');
		} finally {
			deleting = false;
		}
	}

	function handleRefresh() {
		fetchScans(true);
		imageScansStore.fetchStats(clusterStore.active?.id);
	}

	async function handleScanAll(force: boolean = false) {
		const activeCluster = clusterStore.active;
		if (!activeCluster) {
			toast.error('No active cluster selected. Please select a cluster first.');
			return;
		}
		try {
			toast.info(`Scanning all container images in ${activeCluster.name}...`);
			const result = await imageScansStore.scanAllClusterImages(activeCluster.id, force);
			await fetchScans();
			imageScansStore.fetchStats(activeCluster.id);
			if (result.cancelled) {
				toast.info(`Scan cancelled. Completed ${result.total} images (${result.skipped} skipped).`);
			} else if (result.total === 0 && result.skipped > 0) {
				toast.info(`All ${result.skipped} images were scanned recently`, {
					action: {
						label: 'Rescan All',
						onClick: () => handleScanAll(true)
					},
					duration: 8000
				});
			} else if (result.skipped > 0) {
				toast.success(`Scanned ${result.total} images (${result.skipped} skipped — already scanned recently)`);
			} else if (result.total === 0 && result.message) {
				toast.info(result.message);
			} else {
				toast.success(`Scanned ${result.total} container images`);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to scan cluster images');
		}
	}

	async function handleCancelScan() {
		await imageScansStore.cancelScan();
		await fetchScans();
		toast.info('Scan cancellation requested');
	}

	async function handleResetScan(scanId: number) {
		try {
			await imageScansStore.resetScan(scanId);
			toast.success('Scan reset to failed — you can now rescan the image');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reset scan');
		}
	}

	async function handleRescanImage(scan: ImageScanListItem) {
		try {
			toast.info(`Re-scanning ${scan.image}:${scan.tag ?? 'latest'}…`);
			// Invalidate history cache for this image so it reloads with the new scan entry
			const hKey = historyKey(scan);
			scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: [] } };
			await imageScansStore.startScan(scan.image, {
				tag: scan.tag ?? undefined,
				clusterId: scan.clusterId ?? undefined,
				resource: scan.resource ?? undefined,
				resourceNamespace: scan.resourceNamespace ?? undefined
			});
			await fetchScans();
			toast.success(`Rescan completed for ${scan.image}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to start rescan');
		}
	}

	async function handleBulkDelete() {
		bulkDeleting = true;
		const scans = filteredScans.filter((s) => selectedScanIds.has(s.id));
		try {
			// For each selected image, delete ALL scan history entries (not just the latest).
			// When groupByImage=true, each visible row may have older scan records in the DB.
			// Deleting only the representative ID leaves history records which re-appear on next fetch.
			await Promise.all(
				scans.map(async (scan) => {
					const hKey = historyKey(scan);
					// Use cached history if available, otherwise fetch it
					let entries = scanHistoryCache[hKey]?.history ?? [];
					if (entries.length === 0 && (scan.scanCount ?? 1) > 1) {
						entries = await imageScansStore.fetchScanHistory(
							scan.image,
							scan.tag ?? 'latest',
							clusterStore.active?.id
						);
					}
					// Delete all history entries, or just the single scan if no history
					const toDelete = entries.length > 0 ? entries.map((e) => e.id) : [scan.id];
					await Promise.all(toDelete.map((id) => imageScansStore.deleteScan(id)));
				})
			);
			toast.success(`Deleted ${scans.length} image scan${scans.length > 1 ? 's' : ''}`);
			selectedScanIds = new Set();
			scanHistoryCache = {};
			await fetchScans();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to delete selected scans');
		} finally {
			bulkDeleting = false;
		}
	}

	async function handleBulkRescan() {
		bulkScanning = true;
		const scans = filteredScans.filter((s) => selectedScanIds.has(s.id));
		try {
			toast.info(`Re-scanning ${scans.length} image${scans.length > 1 ? 's' : ''}…`);
			// Invalidate history caches first
			for (const scan of scans) {
				const hKey = historyKey(scan);
				scanHistoryCache = { ...scanHistoryCache, [hKey]: { loading: false, history: [] } };
			}
			await Promise.all(
				scans.map((scan) =>
					imageScansStore.startScan(scan.image, {
						tag: scan.tag ?? undefined,
						clusterId: scan.clusterId ?? undefined,
						resource: scan.resource ?? undefined,
						resourceNamespace: scan.resourceNamespace ?? undefined
					})
				)
			);
			selectedScanIds = new Set();
			await fetchScans();
			toast.success(`Rescanned ${scans.length} image${scans.length > 1 ? 's' : ''}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to rescan selected images');
		} finally {
			bulkScanning = false;
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────

	onMount(() => {
		fetchScans();
		imageScansStore.fetchStatus();
		imageScansStore.fetchStats(clusterStore.active?.id);
	});

	$effect(() => {
		void [statusFilter, severityFilter, activeClusterId];
		fetchScans(true);
	});

	// ── Real-time SSE updates (like pods) ──────────────────────
	// Opens a persistent SSE connection to /api/image-scans/stream.
	// The server polls the DB every 2 s and fires a `change` event whenever
	// any scan is added, removed, or its status/summary changes.
	// On `change` → fetchScans() without resetting expanded rows.
	// The $effect re-runs when activeClusterId changes, closing the old
	// EventSource and opening a new one scoped to the new cluster.
	$effect(() => {
		const cid = activeClusterId; // reactive: reconnect when cluster changes
		if (typeof window === 'undefined') return;

		const url = cid != null
			? `/api/image-scans/stream?clusterId=${cid}`
			: '/api/image-scans/stream';

		const es = new EventSource(url);

		es.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data) as { type: string };
				if (data.type === 'change') {
					fetchScans(); // refresh list without collapsing expanded rows
				}
			} catch { /* ignore parse errors */ }
		};

		es.onerror = () => {
			// EventSource auto-reconnects — no manual retry needed
		};

		return () => es.close();
	});
</script>

<svelte:head>
	<title>Security Scans - AutoKube</title>
</svelte:head>

<section class="flex h-full min-h-0 flex-1 flex-col">
	<!-- Header -->
	<div class="mb-4 flex shrink-0 flex-wrap items-center gap-3">
		<div class="flex shrink-0 items-center gap-2">
			<Shield class="size-5 text-primary" />
			<h1 class="text-lg font-semibold">Security Scans</h1>
			<span class="text-xs text-muted-foreground">
				{imageScansStore.total}
				{imageScansStore.total === 1 ? 'scan' : 'scans'}
			</span>
			<Button
				variant="outline"
				size="sm"
				class="h-8 gap-1.5 text-xs"
				onclick={handleRefresh}
				disabled={imageScansStore.loading}
			>
				{#if imageScansStore.loading}
					<Loader2 class="size-3 animate-spin" />
				{:else}
					<RefreshCw class="size-3" />
				{/if}
				Refresh
			</Button>
		</div>

		<div class="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
			<!-- Status Filter -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class={cn('h-8 gap-1.5 text-xs', statusFilter && 'border-primary text-primary')}
						>
							<Shield class="size-3" />
							{statusFilter || 'Status'}
							<ChevronDown class="ml-0.5 size-3 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-40">
					<DropdownMenu.Item onclick={() => (statusFilter = '')}>
						<span class="text-xs">All</span>
						{#if !statusFilter}<Check class="ml-auto size-3" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each ['completed', 'scanning', 'pending', 'failed'] as s (s)}
						<DropdownMenu.Item onclick={() => (statusFilter = s)}>
							<span class="text-xs capitalize">{s}</span>
							{#if statusFilter === s}<Check class="ml-auto size-3" />{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- Severity Filter -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class={cn('h-8 gap-1.5 text-xs', severityFilter && 'border-primary text-primary')}
						>
							<AlertTriangle class="size-3" />
							{severityFilter || 'Severity'}
							<ChevronDown class="ml-0.5 size-3 text-muted-foreground" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-40">
					<DropdownMenu.Item onclick={() => (severityFilter = '')}>
						<span class="text-xs">All</span>
						{#if !severityFilter}<Check class="ml-auto size-3" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					{#each ['critical', 'high', 'medium', 'low'] as s (s)}
						<DropdownMenu.Item onclick={() => (severityFilter = s)}>
							<span class="text-xs capitalize">{s}</span>
							{#if severityFilter === s}<Check class="ml-auto size-3" />{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- Search -->
			<div class="relative">
				<Search class="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
				<Input
					placeholder="Search images…"
					class="h-8 w-48 pl-8 text-xs"
					bind:value={searchQuery}
				/>
			</div>

			<!-- Scan All / Stop Scan -->
			{#if imageScansStore.scanning}
				<Button
					size="sm"
					variant="destructive"
					class="h-8 gap-1.5 text-xs"
					onclick={handleCancelScan}
				>
					<Square class="size-3" />
					Stop Scan
				</Button>
			{:else}
				<Button
					size="sm"
					variant="outline"
					class="h-8 gap-1.5 text-xs"
					onclick={() => handleScanAll()}
					disabled={!clusterStore.active || !scanningEnabled}
					title={!scanningEnabled ? 'Enable scanning in cluster settings' : undefined}
				>
					<Shield class="size-3" />
					Scan All Images
				</Button>
			{/if}
			<Button
				size="sm"
				class="h-8 gap-1.5 text-xs"
				onclick={() => (showScanDialog = true)}
				disabled={!clusterStore.active || !scanningEnabled}
				title={!scanningEnabled ? 'Enable scanning in cluster settings' : undefined}
			>
				<ShieldCheck class="size-3" />
				New Scan
			</Button>
		</div>
	</div>

	<!-- Scanning Disabled Warning -->
	{#if clusterStore.active && !scanningEnabled}
		<div class="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-400">
			<AlertTriangle class="size-4 shrink-0" />
			<span>Scanning is disabled for this cluster. Enable <strong>Enable Scanning</strong> in cluster settings to scan images.</span>
		</div>
	{/if}

	<!-- Scanner Status Warning -->
	{#if imageScansStore.scannerStatus && !imageScansStore.scannerStatus.available}
		<div class="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-600 dark:text-yellow-400">
			<AlertTriangle class="size-4 shrink-0" />
			<span>No scanner available. Docker or Trivy CLI is required for vulnerability scanning. If Docker Desktop is running, scanning will work automatically.</span>
		</div>
	{/if}

	<!-- Vulnerability Stats Strip -->
	{#if (vulnTotals.critical + vulnTotals.high + vulnTotals.medium + vulnTotals.low) > 0}
		{@const v = vulnTotals}
		<div class="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-4">
			<div class="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3">
				<AlertCircle class="size-5 shrink-0 text-red-500" />
				<div>
					<div class="text-xl font-bold text-red-600 dark:text-red-400">{v.critical}</div>
					<div class="text-[10px] font-semibold tracking-wider text-red-500/80">CRITICAL</div>
				</div>
			</div>
			<div class="flex items-center gap-3 rounded-lg border border-orange-500/20 bg-orange-500/8 px-4 py-3">
				<AlertTriangle class="size-5 shrink-0 text-orange-500" />
				<div>
					<div class="text-xl font-bold text-orange-600 dark:text-orange-400">{v.high}</div>
					<div class="text-[10px] font-semibold tracking-wider text-orange-500/80">HIGH</div>
				</div>
			</div>
			<div class="flex items-center gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/8 px-4 py-3">
				<AlertTriangle class="size-5 shrink-0 text-yellow-500" />
				<div>
					<div class="text-xl font-bold text-yellow-600 dark:text-yellow-400">{v.medium}</div>
					<div class="text-[10px] font-semibold tracking-wider text-yellow-500/80">MEDIUM</div>
				</div>
			</div>
			<div class="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/8 px-4 py-3">
				<Info class="size-5 shrink-0 text-blue-500" />
				<div>
					<div class="text-xl font-bold text-blue-600 dark:text-blue-400">{v.low}</div>
					<div class="text-[10px] font-semibold tracking-wider text-blue-500/80">LOW</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Data Table -->
	{#if imageScansStore.loading && imageScansStore.scans.length === 0}
		<div class="space-y-2">
			<Skeleton class="h-10 w-full rounded-lg" />
			<Skeleton class="h-64 w-full rounded-lg" />
		</div>
	{:else if filteredScans.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-muted-foreground">
			<Shield class="size-10" />
			<p class="text-sm font-medium">No security scans yet</p>
			<p class="text-xs">Scan all container images from your active cluster to detect vulnerabilities.</p>
			<div class="flex gap-2 mt-2">
				<Button
					size="sm"
					class="gap-1.5"
					onclick={() => handleScanAll()}
					disabled={imageScansStore.scanning || !clusterStore.active || !scanningEnabled}
				>
					{#if imageScansStore.scanning}
						<Loader2 class="size-4 animate-spin" />
						Scanning...
					{:else}
						<ShieldCheck class="size-4" />
						Scan All Images
					{/if}
				</Button>
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5"
					onclick={() => (showScanDialog = true)}
					disabled={!clusterStore.active || !scanningEnabled}
				>
					Scan Single Image
				</Button>
			</div>
			{#if !clusterStore.active}
				<p class="text-[10px] text-yellow-600 dark:text-yellow-400">Select a cluster to scan all images</p>
			{:else if !scanningEnabled}
				<p class="text-[10px] text-yellow-600 dark:text-yellow-400">Enable scanning in cluster settings to scan images</p>
			{/if}
		</div>
	{:else}
		{#if selectedScanIds.size > 0}
			<div class="mb-2 flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1">
				<span class="text-[11px] font-medium text-muted-foreground">{selectedScanIds.size} selected</span>
				<Button
					size="sm"
					variant="ghost"
					class="h-5 gap-0.5 px-1.5 text-[11px] text-muted-foreground"
					onclick={() => (selectedScanIds = new Set())}
				>
					<X class="size-2.5" />
					Clear
				</Button>
				<div class="ml-auto flex gap-1.5">
					<Button
						size="sm"
						class="h-6 gap-1 px-2 text-[11px]"
						onclick={handleBulkRescan}
						disabled={bulkScanning || !scanningEnabled}
					>
						{#if bulkScanning}
							<Loader2 class="size-2.5 animate-spin" />
						{:else}
							<RefreshCw class="size-2.5" />
						{/if}
						Rescan Selected
					</Button>
					<ConfirmDelete
						title={`${selectedScanIds.size} selected scan${selectedScanIds.size > 1 ? 's' : ''}`}
						loading={bulkDeleting}
						onConfirm={handleBulkDelete}
					>
						<Button
							size="sm"
							variant="destructive"
							class="h-6 gap-1 px-2 text-[11px]"
							disabled={bulkDeleting}
						>
							{#if bulkDeleting}
								<Loader2 class="size-2.5 animate-spin" />
							{:else}
								<Trash2 class="size-2.5" />
							{/if}
							Delete Selected
						</Button>
					</ConfirmDelete>
				</div>
			</div>
		{/if}

		<DataTableView
			data={filteredScans}
			keyField="id"
			name={TableName.imagescans}
			columns={imageScansColumns}
			{sortState}
			onSortChange={(state) => (sortState = state)}
			loading={imageScansStore.loading}
			wrapperClass="border rounded-lg"
			selectable
			bind:selectedKeys={selectedScanIds}
			expandable
			bind:expandedKeys
			onExpandChange={handleExpandChange}
		>
			{#snippet cell(column, scan: ImageScanListItem)}
				{#if column.id === 'image'}
					<span class="truncate font-mono text-xs" title={scan.image}>{scan.image}</span>
				{:else if column.id === 'tag'}
					<Badge variant="outline" class="font-mono text-[10px] px-1.5">
						{scan.tag ?? 'latest'}
					</Badge>
				{:else if column.id === 'status'}
					{@const SIcon = statusIcon(scan.status)}
					<div class={cn('flex items-center gap-1.5 text-xs font-medium', statusColor(scan.status))}>
						<SIcon class={cn('size-3.5 shrink-0', scan.status === 'scanning' && 'animate-spin')} />
						<span class="capitalize">{scan.status}</span>
					</div>
				{:else if column.id === 'critical'}
					{@const val = scan.parsedSummary?.critical ?? 0}
					{#if val > 0}
						<span class="text-sm font-bold text-red-600 dark:text-red-400">{val}</span>
					{:else}
						<span class="text-xs text-muted-foreground/50">—</span>
					{/if}
				{:else if column.id === 'high'}
					{@const val = scan.parsedSummary?.high ?? 0}
					{#if val > 0}
						<span class="text-sm font-bold text-orange-600 dark:text-orange-400">{val}</span>
					{:else}
						<span class="text-xs text-muted-foreground/50">—</span>
					{/if}
				{:else if column.id === 'medium'}
					{@const val = scan.parsedSummary?.medium ?? 0}
					{#if val > 0}
						<span class="text-sm font-bold text-yellow-600 dark:text-yellow-400">{val}</span>
					{:else}
						<span class="text-xs text-muted-foreground/50">—</span>
					{/if}
				{:else if column.id === 'low'}
					{@const val = scan.parsedSummary?.low ?? 0}
					{#if val > 0}
						<span class="text-sm font-bold text-blue-600 dark:text-blue-400">{val}</span>
					{:else}
						<span class="text-xs text-muted-foreground/50">—</span>
					{/if}
				{:else if column.id === 'resource'}
					{#if scan.resource}
						<span class="truncate text-xs text-muted-foreground" title={scan.resource}>
							{scan.resource}
						</span>
					{:else}
						<span class="text-xs text-muted-foreground">—</span>
					{/if}
				{:else if column.id === 'actions'}
					<div class="flex items-center justify-end gap-0.5">
						{#if scan.status === 'scanning' || scan.status === 'pending'}
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:text-orange-500 hover:cursor-pointer"
								onclick={(e) => { e.stopPropagation(); handleResetScan(scan.id); }}
								title="Reset stuck scan"
							>
								<RotateCcw class="h-3.5 w-3.5" />
							</Button>
						{:else if scan.status === 'completed'}
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 text-muted-foreground hover:text-foreground hover:cursor-pointer"
								onclick={(e) => { e.stopPropagation(); handleViewScan(scan); }}
								title="View vulnerability details"
							>
								<Eye class="h-3.5 w-3.5" />
							</Button>
						{/if}					{#if scan.status === 'completed' || scan.status === 'failed'}
						<Button
							variant="ghost"
							size="icon"
							class="h-6 w-6 text-muted-foreground hover:text-primary hover:cursor-pointer"
							onclick={(e) => { e.stopPropagation(); handleRescanImage(scan); }}
							disabled={!scanningEnabled}
							title={scanningEnabled ? 'Re-scan this image' : 'Enable scanning in cluster settings'}
						>
							<RefreshCw class="h-3.5 w-3.5" />
						</Button>
					{/if}						<ConfirmDelete
							title={scan.image}
							loading={deleting}
							onConfirm={() => handleDeleteScan(scan.id)}
						>
							<Button
								variant="ghost"
								size="icon"
								disabled={deleting}
								class="h-6 w-6 text-muted-foreground hover:text-destructive hover:cursor-pointer"
								title="Delete scan"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</Button>
						</ConfirmDelete>
					</div>
				{/if}
			{/snippet}

			{#snippet expandedRow(scan: ImageScanListItem)}
				{@const hKey = historyKey(scan)}
				{@const cached = scanHistoryCache[hKey]}
				<div class="border-t bg-muted/20 px-4 py-3">
					{#if cached?.loading}
						<div class="flex items-center gap-2 py-3 text-xs text-muted-foreground">
							<Loader2 class="size-3 animate-spin" />
							Loading scan history…
						</div>
					{:else if cached?.history && cached.history.length > 1}
						<!-- History Header -->
						<div class="mb-3 flex items-center gap-2">
							<Shield class="size-3.5 text-muted-foreground" />
							<span class="text-xs font-semibold text-foreground">Scan History</span>
							<Badge variant="secondary" class="text-[10px] px-1.5">{cached.history.length} scans</Badge>
							<span class="text-xs text-muted-foreground font-mono">{scan.image}:{scan.tag ?? 'latest'}</span>
							<div class="ml-auto">
								<ConfirmDelete
									title={`all ${cached.history.length} scans for ${scan.image}:${scan.tag ?? 'latest'}`}
									loading={deleting}
									onConfirm={() => handleDeleteAllHistory(scan)}
								>
									<Button
										variant="ghost"
										size="sm"
										disabled={deleting}
										class="h-6 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
									>
										<Trash2 class="size-3" />
										Remove All
									</Button>
								</ConfirmDelete>
							</div>
						</div>
						<div class="overflow-auto rounded-lg border border-border/60 bg-background shadow-sm">
							<table class="w-full text-xs">
								<thead>
									<tr class="border-b bg-muted/40">
										<th class="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
										<th class="px-3 py-2 text-left font-medium text-muted-foreground">Scanner</th>
										<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
										<th class="px-3 py-2 text-center font-semibold text-red-500">C</th>
										<th class="px-3 py-2 text-center font-semibold text-orange-500">H</th>
										<th class="px-3 py-2 text-center font-semibold text-yellow-500">M</th>
										<th class="px-3 py-2 text-center font-semibold text-blue-500">L</th>
										<th class="px-3 py-2 text-left font-medium text-muted-foreground">Resource</th>
										<th class="px-3 py-2 text-right font-medium text-muted-foreground"></th>
									</tr>
								</thead>
								<tbody>
									{#each cached.history as entry, i (entry.id)}
										{@const SIcon = statusIcon(entry.status)}
										{@const isFailed = entry.status === 'failed'}
										{@const isFirst = i === 0}
										<tr class={cn(
											'border-b last:border-0 transition-colors',
											isFailed
												? 'bg-red-500/5 hover:bg-red-500/8'
												: isFirst
												? 'bg-primary/3 hover:bg-primary/6'
												: 'hover:bg-muted/40'
										)}>
											<td class="px-3 py-2 text-muted-foreground whitespace-nowrap">
											<div class="flex items-center gap-1.5">
												<Clock class="size-3 shrink-0 text-muted-foreground/60" />
												<span>{formatDate(entry.completedAt ?? entry.createdAt)}</span>
												{#if isFirst}<Badge variant="outline" class="ml-0.5 text-[9px] px-1 py-0 border-primary/40 text-primary">latest</Badge>{/if}
											</div>
											</td>
											<td class="px-3 py-2">
												{#if entry.scanner === 'grype+trivy' || entry.scanner === 'both'}
													<div class="flex gap-1">
														<Badge variant="outline" class="text-[9px] border-purple-400/50 text-purple-600 dark:text-purple-400 px-1">Grype</Badge>
														<Badge variant="outline" class="text-[9px] border-cyan-400/50 text-cyan-600 dark:text-cyan-400 px-1">Trivy</Badge>
													</div>
												{:else if entry.scanner === 'grype'}
													<Badge variant="outline" class="text-[9px] border-purple-400/50 text-purple-600 dark:text-purple-400 px-1">Grype</Badge>
												{:else if entry.scanner === 'trivy'}
													<Badge variant="outline" class="text-[9px] border-cyan-400/50 text-cyan-600 dark:text-cyan-400 px-1">Trivy</Badge>
												{:else}
													<span class="text-muted-foreground">—</span>
												{/if}
											</td>
											<td class="px-3 py-2">
												<div class={cn('flex items-center gap-1 font-medium', statusColor(entry.status))}>
													<SIcon class={cn('size-3 shrink-0', entry.status === 'scanning' && 'animate-spin')} />
													<span class="capitalize">{entry.status}</span>
												</div>
											</td>
											<td class="px-3 py-2 text-center">
												{#if (entry.parsedSummary?.critical ?? 0) > 0}
													<span class="font-bold text-red-600 dark:text-red-400">{entry.parsedSummary?.critical}</span>
												{:else}
													<span class="text-muted-foreground/40">—</span>
												{/if}
											</td>
											<td class="px-3 py-2 text-center">
												{#if (entry.parsedSummary?.high ?? 0) > 0}
													<span class="font-bold text-orange-600 dark:text-orange-400">{entry.parsedSummary?.high}</span>
												{:else}
													<span class="text-muted-foreground/40">—</span>
												{/if}
											</td>
											<td class="px-3 py-2 text-center">
												{#if (entry.parsedSummary?.medium ?? 0) > 0}
													<span class="font-bold text-yellow-600 dark:text-yellow-400">{entry.parsedSummary?.medium}</span>
												{:else}
													<span class="text-muted-foreground/40">—</span>
												{/if}
											</td>
											<td class="px-3 py-2 text-center">
												{#if (entry.parsedSummary?.low ?? 0) > 0}
													<span class="font-bold text-blue-600 dark:text-blue-400">{entry.parsedSummary?.low}</span>
												{:else}
													<span class="text-muted-foreground/40">—</span>
												{/if}
											</td>
											<td class="px-3 py-2 max-w-45 truncate text-muted-foreground" title={entry.resource ?? ''}>
												{entry.resource ?? '—'}
											</td>
											<td class="px-3 py-2 text-right">
												<div class="flex items-center justify-end gap-0.5">
													{#if entry.status === 'completed'}
														<Button
															variant="ghost"
															size="icon"
															class="h-5 w-5 text-muted-foreground hover:text-foreground hover:cursor-pointer"
															onclick={(e) => { e.stopPropagation(); handleViewScan(entry); }}
															title="View vulnerability details"
														>
															<Eye class="h-3 w-3" />
														</Button>
													{/if}
													<ConfirmDelete
														title={entry.image}
														loading={deleting}
														onConfirm={() => handleDeleteHistoryEntry(entry.id, scan)}
													>
														<Button
															variant="ghost"
															size="icon"
															disabled={deleting}
															class="h-5 w-5 text-muted-foreground hover:text-destructive hover:cursor-pointer"
															title="Delete scan"
														>
															<Trash2 class="h-3 w-3" />
														</Button>
													</ConfirmDelete>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{:else}
						<p class="py-2 text-xs text-muted-foreground">No previous scan history for this image.</p>
					{/if}
				</div>
			{/snippet}
		</DataTableView>
	{/if}
</section>

<!-- Dialogs -->
<ScanDialog bind:open={showScanDialog} onSuccess={handleRefresh} />
<ScanDetailDialog bind:open={showDetailDialog} scanId={selectedScanId} />
