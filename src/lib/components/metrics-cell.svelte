<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';

	interface Props {
		value: string | undefined;
		type: 'cpu' | 'memory' | 'disk';
		/** Total capacity for percentage calculation (e.g. "8" for 8 CPU cores, "32Gi" for 32GB memory). When provided, percentage is usage/capacity instead of hardcoded pod-level max. */
		capacity?: string;
		/** Usage % at which color turns yellow (warning). Defaults to 60. */
		warnThreshold?: number;
		/** Usage % at which color turns red (critical). Defaults to 80. */
		critThreshold?: number;
	}

	let { value, type, capacity, warnThreshold = 60, critThreshold = 80 }: Props = $props();

	// Parse metric value to number
	function parseMetric(val: string | undefined): { amount: number; unit: string } | null {
		if (!val || val === 'N/A') return null;

		// CPU: Parse millicores (e.g., "123m" -> 123)
		if (type === 'cpu') {
			const match = val.match(/^(\d+(?:\.\d+)?)m?$/);
			if (match) {
				const amount = parseFloat(match[1]);
				return { amount: val.endsWith('m') ? amount : amount * 1000, unit: 'm' };
			}
		}

		// Memory/Disk: Parse Ki/Mi/Gi or raw bytes (e.g., "256Mi" -> 256, "1.5Gi" -> 1536, "104857600" -> 100)
		if (type === 'memory' || type === 'disk') {
			const match = val.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi)$/);
			if (match) {
				const amount = parseFloat(match[1]);
				const unit = match[2];
				return {
					amount: unit === 'Gi' ? amount * 1024 : unit === 'Ki' ? amount / 1024 : amount,
					unit: 'Mi'
				};
			}
			// Raw number (bytes) — common for ephemeral-storage
			const raw = parseFloat(val);
			if (!isNaN(raw)) {
				return { amount: raw / (1024 * 1024), unit: 'Mi' };
			}
		}

		return null;
	}

	// Parse capacity string to a numeric max (in millicores for CPU, Mi for memory)
	function parseCapacity(cap: string | undefined): number | null {
		if (!cap) return null;

		if (type === 'cpu') {
			// CPU capacity: "4" = 4 cores = 4000m, "500m" = 500m
			if (cap.endsWith('m')) {
				return parseFloat(cap.slice(0, -1)) || null;
			}
			const cores = parseFloat(cap);
			return isNaN(cores) ? null : cores * 1000;
		} else {
			// Memory/Disk capacity: "32Gi" = 32768 Mi, "16384Mi" = 16384 Mi, "16384Ki" = 16 Mi
			if (cap.endsWith('Gi')) return (parseFloat(cap.slice(0, -2)) || 0) * 1024;
			if (cap.endsWith('Mi')) return parseFloat(cap.slice(0, -2)) || null;
			if (cap.endsWith('Ki')) return (parseFloat(cap.slice(0, -2)) || 0) / 1024;
			// Raw bytes
			const bytes = parseFloat(cap);
			return isNaN(bytes) ? null : bytes / (1024 * 1024);
		}
	}

	// Calculate percentage based on capacity or reasonable defaults
	function calculatePercentage(val: string | undefined): number {
		const parsed = parseMetric(val);
		if (!parsed) return 0;

		const cap = parseCapacity(capacity);

		if (type === 'cpu') {
			const max = cap ?? 1000; // Default: 1 core = 1000m
			return Math.min((parsed.amount / max) * 100, 100);
		} else {
			const max = cap ?? 1024; // Default: 1GB = 1024Mi
			return Math.min((parsed.amount / max) * 100, 100);
		}
	}

	// Get tooltip title based on type
	function getTypeLabel(): string {
		if (type === 'cpu') return 'CPU Usage';
		if (type === 'disk') return 'Disk Allocatable';
		return 'Memory Usage';
	}

	// Get color based on usage percentage
	function getColor(percentage: number): string {
		if (percentage < warnThreshold) return 'bg-green-500';
		if (percentage < critThreshold) return 'bg-yellow-500';
		return 'bg-red-500';
	}

	let percentage = $derived(calculatePercentage(value));
	let color = $derived(getColor(percentage));
	let displayValue = $derived(value && value !== 'N/A' ? value : 'N/A');
	let hasValue = $derived(!!value && value !== 'N/A');

	// Tooltip label for the capacity reference
	let capacityLabel = $derived.by(() => {
		if (capacity) return capacity;
		if (type === 'disk') return '100GB';
		return type === 'cpu' ? '1 core' : '1GB';
	});
</script>

{#if hasValue}
	<Tooltip.Provider>
		<Tooltip.Root>
			<Tooltip.Trigger class="w-full">
				<div class="flex w-full items-center gap-1.5 px-1">
					<!-- Progress bar -->
					<div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60">
						<div
							class={`h-full transition-all duration-300 ${color}`}
							style={`width: ${percentage}%`}
						></div>
					</div>
					<!-- Percentage text -->
					<span
						class="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums"
					>
						{percentage.toFixed(0)}%
					</span>
				</div>
			</Tooltip.Trigger>
			<Tooltip.Content class="min-w-32">
				<div class="space-y-0.5 text-xs">
					<div class="font-semibold whitespace-nowrap">
						{getTypeLabel()}
					</div>
					<div class="font-mono text-sm">{displayValue}</div>
					<div class="whitespace-nowrap text-muted-foreground">
						{percentage.toFixed(1)}% of {capacityLabel}
					</div>
				</div>
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
{:else}
	<div class="flex w-full items-center gap-1.5 px-1">
		<div class="h-1.5 min-w-0 flex-1 rounded-full bg-muted/40"></div>
		<span class="w-8 shrink-0 text-right text-xs text-muted-foreground/60 tabular-nums">N/A</span>
	</div>
{/if}
