<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Tooltip from '$lib/components/ui/tooltip';

	let {
		label,
		usage,
		capacity,
		formatValue
	}: {
		label: string;
		usage: number;
		capacity: number;
		formatValue: (value: number) => string;
	} = $props();

	const percent = $derived(capacity > 0 ? Math.min((usage / capacity) * 100, 100) : 0);
	const color = $derived(
		percent >= 90
			? 'bg-red-500'
			: percent >= 70
				? 'bg-amber-500'
				: percent >= 50
					? 'bg-blue-500'
					: 'bg-emerald-500'
	);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<div class="flex items-center gap-1.5">
			<span class="text-[11px] font-medium">{label}</span>
			<div class="relative h-2 w-16 overflow-hidden rounded-full bg-muted-foreground/20">
				<div
					class={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-700', color)}
					style="width: {percent}%"
				></div>
			</div>
			<span class="min-w-[2ch] text-right font-mono text-[10px]">{Math.round(percent)}%</span>
		</div>
	</Tooltip.Trigger>
	<Tooltip.Content side="bottom" class="text-xs">
		<p class="font-medium">{label}</p>
		<p>{formatValue(usage)} / {formatValue(capacity)}</p>
	</Tooltip.Content>
</Tooltip.Root>
