<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import ProvisioningLogs from './provisioning-logs.svelte';
	import { ScrollText } from 'lucide-svelte';

	let {
		open = $bindable(false),
		clusterId,
		clusterName = ''
	}: {
		open?: boolean;
		clusterId: number;
		clusterName?: string;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex flex-col max-h-[85vh] sm:max-w-4xl overflow-hidden p-0 gap-0">
		<Dialog.Header class="px-5 py-4 border-b border-border shrink-0">
			<Dialog.Title class="flex items-center gap-2 text-base">
				<ScrollText class="size-4" />
				Provisioning Logs — {clusterName}
			</Dialog.Title>
			<Dialog.Description>
				Real-time and historical provisioning output for this cluster.
			</Dialog.Description>
		</Dialog.Header>
		<div style="--log-height: 500px">
			<ProvisioningLogs {clusterId} {clusterName} />
		</div>
	</Dialog.Content>
</Dialog.Root>
