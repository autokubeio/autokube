<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { ref = $bindable(null), class: className, ...restProps }: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn(
		'scrollbar-hide inline-flex h-9 w-full items-center justify-start overflow-x-auto rounded-lg bg-muted p-[3px] text-muted-foreground sm:w-fit sm:justify-center',
		className
	)}
	{...restProps}
/>
