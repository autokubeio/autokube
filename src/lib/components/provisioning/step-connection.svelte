<script lang="ts">
	import type { WizardData } from './provisioning-wizard.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';
	import { FileText, Zap, KeyRound } from 'lucide-svelte';

	const { data = $bindable() }: { data: WizardData } = $props();

	const CONNECTION_TYPES = [
		{
			id: 'kubeconfig' as const,
			label: 'Kubeconfig',
			Icon: FileText,
			description:
				'Auto-download the kubeconfig after provisioning. Best for full cluster control.'
		},
		{
			id: 'agent' as const,
			label: 'Agent (In-Cluster)',
			Icon: Zap,
			description: 'Install the AutoKube agent inside the cluster. Works through firewalls.'
		},
		{
			id: 'bearer-token' as const,
			label: 'Bearer Token',
			Icon: KeyRound,
			description: 'Connect using the K8s API server URL and a service account token.'
		}
	];
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-sm font-semibold mb-1">Post-Provision Connection</h3>
		<p class="text-xs text-muted-foreground">
			Choose how AutoKube should connect to and manage this cluster after it finishes
			provisioning.
		</p>
	</div>

	<!-- Connection Type Cards -->
	<div class="space-y-2.5">
		{#each CONNECTION_TYPES as type}
			<button
				type="button"
				onclick={() => (data.connectionType = type.id)}
				class={cn(
					'w-full flex items-start gap-3 rounded-lg border p-4 text-left transition-all cursor-pointer',
					data.connectionType === type.id
						? 'border-primary bg-primary/5'
						: 'border-border bg-card hover:border-primary/40'
				)}
			>
				<span
					class={cn(
						'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border',
						data.connectionType === type.id
							? 'border-primary/30 bg-primary/10 text-primary'
							: 'border-border bg-muted text-muted-foreground'
					)}
				>
					<type.Icon class="size-4" />
				</span>
				<div class="flex-1">
					<div class="flex items-center gap-2">
						<p class="text-sm font-medium">{type.label}</p>
						{#if data.connectionType === type.id}
							<span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary border border-primary/20">
								Selected
							</span>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground mt-0.5">{type.description}</p>
				</div>
			</button>
		{/each}
	</div>

	<!-- Detail Fields for Bearer Token -->
	{#if data.connectionType === 'bearer-token'}
		<div class="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
			<p class="text-xs text-muted-foreground">
				These values will be pre-filled after provisioning if known, or you can enter them once
				provisioning completes.
			</p>
			<div class="space-y-1.5">
				<Label class="text-xs">API Server URL</Label>
				<Input
					placeholder="https://api.my-cluster.example.com:6443"
					bind:value={data.apiServer}
					class="text-sm font-mono"
				/>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">Bearer Token</Label>
				<Input
					type="password"
					placeholder="eyJhbGciOi..."
					bind:value={data.bearerToken}
					class="text-sm font-mono"
				/>
			</div>
		</div>
	{/if}

	{#if data.connectionType === 'agent'}
		<div class="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
			<p class="text-xs font-medium text-primary">Agent installation</p>
			<p class="text-xs text-muted-foreground mt-0.5">
				After provisioning, AutoKube will generate a Helm install command for the in-cluster agent.
				You'll see it in the cluster detail page.
			</p>
		</div>
	{/if}
</div>
