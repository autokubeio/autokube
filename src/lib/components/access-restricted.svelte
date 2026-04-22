<script lang="ts">
	import { Lock } from 'lucide-svelte';

	interface Props {
		message?: string;
	}
	let { message = "You don't have permission to access this page. Contact your administrator." }: Props = $props();
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
	<div class="flex size-14 items-center justify-center rounded-full border bg-muted">
		<Lock class="size-6 text-muted-foreground" />
	</div>
	<div>
		<p class="text-base font-semibold">Access Restricted</p>
		<p class="mt-1.5 text-sm text-muted-foreground max-w-sm mx-auto">{message}</p>
	</div>
</div>
