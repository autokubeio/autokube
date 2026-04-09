<script lang="ts">
	import type { WizardData, FirewallRule } from './provisioning-wizard.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Button } from '$lib/components/ui/button';
	import { Plus, Trash2, Shield, Network, Info } from 'lucide-svelte';

	const { data = $bindable() }: { data: WizardData } = $props();

	const NETWORK_ZONES = [
		{ value: 'eu-central', label: 'EU Central' },
		{ value: 'us-east', label: 'US East' },
		{ value: 'us-west', label: 'US West' },
		{ value: 'ap-southeast', label: 'AP Southeast' }
	];

	const CNI_PLUGINS = [
		{ value: 'flannel', label: 'Flannel (default, lightweight)' },
		{ value: 'calico', label: 'Calico (advanced network policies)' },
		{ value: 'cilium', label: 'Cilium (eBPF, high performance)' },
		{ value: 'none', label: 'None (manual)' }
	];

	function addRule() {
		data.firewallRules = [
			...data.firewallRules,
			{
				id: crypto.randomUUID(),
				port: '',
				protocol: 'tcp',
				direction: 'inbound',
				description: '',
				sourceIps: '0.0.0.0/0'
			}
		];
	}

	function removeRule(id: string) {
		data.firewallRules = data.firewallRules.filter((r) => r.id !== id);
	}
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-sm font-semibold mb-1">Networking & Firewall</h3>
		<p class="text-xs text-muted-foreground">Configure the cluster network, CNI plugin, and firewall rules.</p>
	</div>

	<!-- Network Settings -->
	<div class="rounded-lg border border-border bg-card p-4 space-y-3">
		<div class="flex items-center gap-2 mb-1">
			<Network class="size-4 text-muted-foreground" />
			<h4 class="text-sm font-medium">Network Settings</h4>
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1.5">
				<Label class="text-xs">Network Zone</Label>
				<Select.Root type="single" bind:value={data.networkZone}>
					<Select.Trigger class="h-9 text-sm">{NETWORK_ZONES.find((z) => z.value === data.networkZone)?.label ?? data.networkZone}</Select.Trigger>
					<Select.Content>
						{#each NETWORK_ZONES as z}
							<Select.Item value={z.value}>{z.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-1.5">
				<Label class="text-xs">CNI Plugin</Label>
				<Select.Root type="single" bind:value={data.cniPlugin}>
					<Select.Trigger class="h-9 text-sm">{CNI_PLUGINS.find((c) => c.value === data.cniPlugin)?.label ?? data.cniPlugin}</Select.Trigger>
					<Select.Content>
						{#each CNI_PLUGINS as p}
							<Select.Item value={p.value}>{p.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<div class="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
			<div>
				<p class="text-xs font-medium">Private Network</p>
				<p class="text-xs text-muted-foreground">Route inter-node traffic through a private network.</p>
			</div>
			<Switch bind:checked={data.usePrivateNetwork} />
		</div>

		<div class="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
			<div>
				<p class="text-xs font-medium">Create Load Balancer</p>
				<p class="text-xs text-muted-foreground">Provision a cloud load balancer for the API server (HA).</p>
			</div>
			<Switch bind:checked={data.createLoadBalancer} />
		</div>
	</div>

	<!-- Firewall Rules -->
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Shield class="size-4 text-muted-foreground" />
				<h4 class="text-sm font-medium">Firewall Rules</h4>
			</div>
			<Button variant="outline" size="sm" onclick={addRule} class="h-7 px-2 text-xs gap-1">
				<Plus class="size-3" />
				Add Rule
			</Button>
		</div>

		<!-- Legend -->
		<div class="grid grid-cols-[1fr_80px_80px_100px_80px_1fr_auto] gap-2 px-1">
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Description</span>
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Port</span>
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Protocol</span>
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Direction</span>
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide col-span-2">Source IPs</span>
			<span></span>
		</div>

		{#if data.firewallRules.length === 0}
			<div class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-center">
				<Shield class="size-5 text-muted-foreground mx-auto mb-2" />
				<p class="text-xs text-muted-foreground">No firewall rules defined. All ports will be blocked by default.</p>
			</div>
		{:else}
			<div class="space-y-2">
				{#each data.firewallRules as rule (rule.id)}
					<div class="grid grid-cols-[1fr_80px_80px_100px_80px_1fr_auto] gap-2 items-center">
						<Input
							placeholder="Description"
							value={rule.description}
							oninput={(e) => { rule.description = e.currentTarget.value; }}
							class="h-8 text-xs"
						/>
						<Input
							placeholder="Port"
							value={rule.port}
							oninput={(e) => { rule.port = e.currentTarget.value; }}
							class="h-8 text-xs font-mono"
						/>
						<Select.Root
							type="single"
							value={rule.protocol}
							onValueChange={(v) => { if (v) rule.protocol = v as 'tcp' | 'udp' | 'icmp'; }}
						>
							<Select.Trigger class="h-8 text-xs">{rule.protocol}</Select.Trigger>
							<Select.Content>
								<Select.Item value="tcp">TCP</Select.Item>
								<Select.Item value="udp">UDP</Select.Item>
								<Select.Item value="icmp">ICMP</Select.Item>
							</Select.Content>
						</Select.Root>
						<Select.Root
							type="single"
							value={rule.direction}
							onValueChange={(v) => { if (v) rule.direction = v as 'inbound' | 'outbound'; }}
						>
							<Select.Trigger class="h-8 text-xs">{rule.direction}</Select.Trigger>
							<Select.Content>
								<Select.Item value="inbound">Inbound</Select.Item>
								<Select.Item value="outbound">Outbound</Select.Item>
							</Select.Content>
						</Select.Root>
						<Input
							placeholder="0.0.0.0/0"
							value={rule.sourceIps}
							oninput={(e) => { rule.sourceIps = e.currentTarget.value; }}
							class="h-8 text-xs font-mono col-span-2"
						/>
						<button
							type="button"
							onclick={() => removeRule(rule.id)}
							class="text-muted-foreground hover:text-red-500 transition-colors justify-self-center"
						>
							<Trash2 class="size-3.5" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
