<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';

	let { open = $bindable(false), value = $bindable(), ...restProps }: any = $props();
</script>

<SelectPrimitive.Root bind:open bind:value={value as any} {...restProps} />
