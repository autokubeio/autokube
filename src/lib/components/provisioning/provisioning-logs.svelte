<script lang="ts">
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import { RefreshCw, Trash2, Download, ScrollText } from 'lucide-svelte';
	import { provisionedClustersStore, type ProvisioningLog } from '$lib/stores/provisioned-clusters.svelte';
	import { toast } from 'svelte-sonner';

	let { clusterId, clusterName = '' }: { clusterId: number; clusterName?: string } = $props();

	let logs = $state<ProvisioningLog[]>([]);
	let loading = $state(false);
	let clearing = $state(false);
	let logContainer = $state<HTMLDivElement | null>(null);
	let autoScroll = $state(true);

	const LEVEL_STYLES: Record<string, string> = {
		info: 'text-sky-400',
		success: 'text-emerald-400',
		warning: 'text-amber-400',
		error: 'text-red-400',
		k3s: 'text-violet-400'
	};

	const LEVEL_PREFIX: Record<string, string> = {
		info: '[INFO]  ',
		success: '[OK]    ',
		warning: '[WARN]  ',
		error: '[ERROR] ',
		k3s: '[K3S]   '
	};

	async function loadLogs() {
		loading = true;
		try {
			logs = await provisionedClustersStore.fetchLogs(clusterId);
		} catch {
			toast.error('Failed to load logs');
		} finally {
			loading = false;
			if (autoScroll) scrollToBottom();
		}
	}

	async function clearLogs() {
		clearing = true;
		try {
			await provisionedClustersStore.clearLogs(clusterId);
			logs = [];
			toast.success('Logs cleared');
		} catch {
			toast.error('Failed to clear logs');
		} finally {
			clearing = false;
		}
	}

	function scrollToBottom() {
		setTimeout(() => {
			if (logContainer) {
				logContainer.scrollTop = logContainer.scrollHeight;
			}
		}, 50);
	}

	function downloadLogs() {
		const content = logs
			.map((l) => `[${l.createdAt}] ${LEVEL_PREFIX[l.level] ?? ''}${l.message}`)
			.join('\n');
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${clusterName || 'cluster'}-provisioning-logs.txt`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function formatTime(ts: string | null): string {
		if (!ts) return '';
		return new Date(ts).toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		});
	}

	$effect(() => {
		if (clusterId) loadLogs();
	});
</script>

<div class="flex flex-col">
	<!-- Toolbar -->
	<div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/30">
		<div class="flex items-center gap-1.5">
			<ScrollText class="size-4 text-muted-foreground" />
			<span class="text-xs font-medium">Provisioning Logs</span>
			{#if logs.length > 0}
				<span class="rounded-full bg-muted border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
					{logs.length}
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-1">
			<label class="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
				<input
					type="checkbox"
					class="size-3"
					bind:checked={autoScroll}
				/>
				Auto-scroll
			</label>
			<Button
				variant="ghost"
				size="icon"
				class="h-6 w-6"
				onclick={loadLogs}
				disabled={loading}
				title="Refresh logs"
			>
				<RefreshCw class={cn('size-3', loading && 'animate-spin')} />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-6 w-6"
				onclick={downloadLogs}
				disabled={logs.length === 0}
				title="Download logs"
			>
				<Download class="size-3" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-6 w-6 hover:text-red-500"
				onclick={clearLogs}
				disabled={clearing || logs.length === 0}
				title="Clear logs"
			>
				<Trash2 class="size-3" />
			</Button>
		</div>
	</div>

	<!-- Log Output -->
	<div
		bind:this={logContainer}
		class="overflow-y-auto bg-zinc-950 font-mono text-xs p-3 space-y-0.5"
		style="height: var(--log-height, 420px);"
	>
		{#if loading && logs.length === 0}
			<div class="flex items-center gap-2 text-zinc-500">
				<RefreshCw class="size-3 animate-spin" />
				Loading logs...
			</div>
		{:else if logs.length === 0}
			<div class="text-zinc-600 italic">No log entries yet. They will appear here once provisioning starts.</div>
		{:else}
			{#each logs as log (log.id)}
				<div class="flex gap-2 leading-5">
					<span class="shrink-0 text-zinc-600 select-none">{formatTime(log.createdAt)}</span>
					<span class={cn('shrink-0 select-none', LEVEL_STYLES[log.level] ?? 'text-zinc-400')}>
						{LEVEL_PREFIX[log.level] ?? ''}
					</span>
					<span class="text-zinc-200 break-all">{log.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
