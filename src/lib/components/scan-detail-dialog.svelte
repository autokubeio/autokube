<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import {
		Shield,
		ExternalLink,
		Package,
		AlertTriangle,
		AlertCircle,
		Info,
		ChevronDown,
		ChevronUp,
		Copy
	} from 'lucide-svelte';
	import { cn } from '$lib/utils';
	import { imageScansStore } from '$lib/stores/image-scans.svelte';
	import type { ImageScanWithVulns } from '$lib/stores/image-scans.svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		scanId: number | null;
	}

	let { open = $bindable(false), scanId }: Props = $props();
	let scan = $state<ImageScanWithVulns | null>(null);
	let loading = $state(false);
	let severityFilter = $state<string>('all');
	let expandedVuln = $state<string | null>(null);

	const filteredVulns = $derived.by(() => {
		if (!scan?.vulnerabilities) return [];
		if (severityFilter === 'all') return scan.vulnerabilities;
		return scan.vulnerabilities.filter(
			(v) => v.severity.toUpperCase() === severityFilter.toUpperCase()
		);
	});

	$effect(() => {
		if (open && scanId) {
			loadScan(scanId);
		} else {
			scan = null;
			severityFilter = 'all';
			expandedVuln = null;
		}
	});

	async function loadScan(id: number) {
		loading = true;
		try {
			scan = await imageScansStore.fetchScan(id);
		} finally {
			loading = false;
		}
	}

	function severityColor(severity: string): string {
		switch (severity.toUpperCase()) {
			case 'CRITICAL': return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30';
			case 'HIGH': return 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30';
			case 'MEDIUM': return 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30';
			case 'LOW': return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
			default: return 'bg-muted text-muted-foreground border-border';
		}
	}

	function severityIcon(severity: string) {
		switch (severity.toUpperCase()) {
			case 'CRITICAL': return AlertCircle;
			case 'HIGH': return AlertTriangle;
			default: return Info;
		}
	}

	function toggleVuln(vulnId: string) {
		expandedVuln = expandedVuln === vulnId ? null : vulnId;
	}

	async function copyVulnId(id: string) {
		await navigator.clipboard.writeText(id);
		toast.success('Copied to clipboard');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Shield class="size-5" />
				Scan Results
			</Dialog.Title>
			{#if scan}
				<Dialog.Description>
					{scan.image}{scan.tag ? `:${scan.tag}` : ''}
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if loading}
			<div class="space-y-3 py-4">
				<Skeleton class="h-16 w-full rounded-lg" />
				<Skeleton class="h-8 w-48 rounded-md" />
				<Skeleton class="h-40 w-full rounded-lg" />
			</div>
		{:else if scan}
			<!-- Summary Cards -->
			{#if scan.parsedSummary}
				{@const s = scan.parsedSummary}
				<div class="grid grid-cols-5 gap-2 rounded-lg border p-3">
					<div class="text-center">
						<div class="text-2xl font-bold text-red-500">{s.critical}</div>
						<div class="text-[10px] font-medium text-muted-foreground">CRITICAL</div>
					</div>
					<div class="text-center">
						<div class="text-2xl font-bold text-orange-500">{s.high}</div>
						<div class="text-[10px] font-medium text-muted-foreground">HIGH</div>
					</div>
					<div class="text-center">
						<div class="text-2xl font-bold text-yellow-500">{s.medium}</div>
						<div class="text-[10px] font-medium text-muted-foreground">MEDIUM</div>
					</div>
					<div class="text-center">
						<div class="text-2xl font-bold text-blue-500">{s.low}</div>
						<div class="text-[10px] font-medium text-muted-foreground">LOW</div>
					</div>
					<div class="text-center">
						<div class="text-2xl font-bold text-muted-foreground">{s.unknown}</div>
						<div class="text-[10px] font-medium text-muted-foreground">UNKNOWN</div>
					</div>
				</div>
			{/if}

			<!-- Severity Filter Tabs -->
			<Tabs.Root bind:value={severityFilter}>
				<Tabs.List class="w-full">
					<Tabs.Trigger value="all">
						All ({scan.vulnerabilities?.length ?? 0})
					</Tabs.Trigger>
					<Tabs.Trigger value="CRITICAL">
						Critical ({scan.parsedSummary?.critical ?? 0})
					</Tabs.Trigger>
					<Tabs.Trigger value="HIGH">
						High ({scan.parsedSummary?.high ?? 0})
					</Tabs.Trigger>
					<Tabs.Trigger value="MEDIUM">
						Medium ({scan.parsedSummary?.medium ?? 0})
					</Tabs.Trigger>
					<Tabs.Trigger value="LOW">
						Low ({scan.parsedSummary?.low ?? 0})
					</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>

			<!-- Vulnerability List -->
			<div class="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
				{#if filteredVulns.length === 0}
					<div class="flex flex-col items-center gap-2 py-8 text-muted-foreground">
						<Shield class="size-8" />
						<p class="text-sm">No vulnerabilities found{severityFilter !== 'all' ? ` at ${severityFilter} severity` : ''}</p>
					</div>
				{:else}
					{#each filteredVulns as vuln (vuln.id)}
						{@const SevIcon = severityIcon(vuln.severity)}
						<button
							type="button"
							class="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
							onclick={() => toggleVuln(String(vuln.id))}
						>
							<div class="flex items-start gap-2">
								<Badge class={cn('shrink-0 text-[10px]', severityColor(vuln.severity))}>
									<SevIcon class="mr-0.5 size-3" />
									{vuln.severity}
								</Badge>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span
											role="button"
											tabindex="0"
											class="font-mono text-xs font-semibold hover:underline cursor-pointer"
											onclick={(e) => { e.stopPropagation(); copyVulnId(vuln.vulnerabilityId); }}
											onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); copyVulnId(vuln.vulnerabilityId); } }}
											title="Copy CVE ID"
										>
											{vuln.vulnerabilityId}
										</span>
										<Copy class="size-3 text-muted-foreground" />
									</div>
									{#if vuln.title}
										<p class="mt-0.5 text-xs text-muted-foreground line-clamp-1">{vuln.title}</p>
									{/if}
								</div>
								<div class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
									<span class="flex items-center gap-1">
										<Package class="size-3" />
										{vuln.pkgName}
									</span>
									{#if vuln.score}
										<Badge variant="outline" class="text-[10px]">
											CVSS {vuln.score.toFixed(1)}
										</Badge>
									{/if}
									{#if expandedVuln === String(vuln.id)}
										<ChevronUp class="size-4" />
									{:else}
										<ChevronDown class="size-4" />
									{/if}
								</div>
							</div>

							{#if expandedVuln === String(vuln.id)}
								<div class="mt-3 space-y-2 border-t pt-3 text-xs" onclick={(e) => e.stopPropagation()}>
									{#if vuln.description}
										<p class="text-muted-foreground">{vuln.description}</p>
									{/if}
									<div class="grid grid-cols-2 gap-2">
										<div>
											<span class="font-medium">Installed:</span>
											<span class="ml-1 font-mono text-muted-foreground">{vuln.installedVersion ?? 'N/A'}</span>
										</div>
										<div>
											<span class="font-medium">Fixed in:</span>
											{#if vuln.fixedVersion}
												<span class="ml-1 font-mono text-green-600 dark:text-green-400">{vuln.fixedVersion}</span>
											{:else}
												<span class="ml-1 text-muted-foreground">No fix available</span>
											{/if}
										</div>
									</div>
									{#if vuln.primaryUrl}
										<a
											href={vuln.primaryUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 text-primary hover:underline"
										>
											<ExternalLink class="size-3" />
											View Advisory
										</a>
									{/if}
								</div>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		{:else}
			<div class="py-8 text-center text-sm text-muted-foreground">
				Scan not found
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
