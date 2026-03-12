<script lang="ts">
	import './layout.css';
	import { ModeWatcher, mode } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';

	let { children }: { children: any } = $props();
</script>

<ModeWatcher />
<Toaster richColors position="bottom-right" theme={mode.current} />

{@render children?.()}
