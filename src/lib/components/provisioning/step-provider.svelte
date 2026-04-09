<script lang="ts">
	import type { WizardData } from './provisioning-wizard.svelte';
	import { Label } from '$lib/components/ui/label';
	import { cn } from '$lib/utils';
	import { onMount } from 'svelte';
	import { Eye, EyeOff, Key, AlertTriangle } from 'lucide-svelte';
	import { Input } from '$lib/components/ui/input';

	const { data = $bindable() }: { data: WizardData } = $props();

	const PROVIDERS = [
		{
			id: 'hetzner',
			name: 'Hetzner Cloud',
			description: 'Fast and affordable cloud servers in Europe and the US.',
			logoColor: 'text-red-500',
			available: true
		},
		{
			id: 'aws',
			name: 'Amazon AWS',
			description: 'The world\'s most comprehensive cloud platform.',
			logoColor: 'text-orange-400',
			available: false
		},
		{
			id: 'gcp',
			name: 'Google Cloud',
			description: 'The most performant network for data analytics workloads.',
			logoColor: 'text-blue-500',
			available: false
		},
		{
			id: 'digitalocean',
			name: 'DigitalOcean',
			description: 'Simple cloud infrastructure for developers.',
			logoColor: 'text-blue-400',
			available: false
		}
	];

	let showToken = $state(false);
	let savedToken = $state(false);
	let overrideToken = $state(false);

	async function checkToken(provider: string) {
		savedToken = false;
		try {
			const res = await fetch('/api/settings/providers');
			if (res.ok) {
				const d = await res.json();
				savedToken = d.tokens?.[provider] ?? false;
			}
		} catch { /* ignore */ }
	}

	onMount(() => checkToken(data.provider));

	$effect(() => {
		if (data.provider) checkToken(data.provider);
	});
</script>

<div class="space-y-5">
	<div>
		<h3 class="text-sm font-semibold mb-1">Select Cloud Provider</h3>
		<p class="text-xs text-muted-foreground">Choose the cloud provider where your K3s cluster will be deployed.</p>
	</div>

	<div class="grid grid-cols-2 gap-3">
		{#each PROVIDERS as provider}
			<button
				type="button"
				disabled={!provider.available}
				onclick={() => { if (provider.available) data.provider = provider.id; }}
				class={cn(
					'relative flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-all',
					provider.available ? 'cursor-pointer hover:border-primary/60' : 'cursor-not-allowed opacity-40',
					data.provider === provider.id
						? 'border-primary bg-primary/5'
						: 'border-border bg-card'
				)}
			>
				{#if !provider.available}
					<span class="absolute right-2 top-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
						Soon
					</span>
				{/if}
				{#if data.provider === provider.id}
					<span class="absolute right-2 top-2 size-2 rounded-full bg-primary"></span>
				{/if}
				<span class="text-sm font-medium">{provider.name}</span>
				<span class="text-xs text-muted-foreground">{provider.description}</span>
			</button>
		{/each}
	</div>

	<!-- Provider API Token -->
	{#if data.provider}
		<div class="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
			<div class="flex items-center gap-2">
				<Key class="size-4 text-muted-foreground" />
				<Label class="text-sm font-medium">
					{PROVIDERS.find((p) => p.id === data.provider)?.name ?? data.provider} API Token
				</Label>
			</div>

			{#if savedToken && !overrideToken}
				<!-- Token is configured — show ready state -->
				<div class="flex items-center justify-between rounded-md border border-emerald-500/25 bg-emerald-500/8 px-3 py-2.5 mt-1">
					<div class="flex items-center gap-2">
						<span class="size-2 rounded-full bg-emerald-500 shrink-0"></span>
						<span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Token configured in Settings</span>
					</div>
					<button
						type="button"
						class="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0 ml-3"
						onclick={() => { overrideToken = true; }}
					>
						Use different token
					</button>
				</div>
			{:else}
				<!-- No token saved, or user wants to override -->
				{#if savedToken && overrideToken}
					<p class="text-xs text-muted-foreground mt-1">
						Enter a token to use for this cluster only, or
						<button type="button" class="underline text-primary" onclick={() => { overrideToken = false; data.providerToken = ''; }}>
							use saved token
						</button>.
					</p>
				{:else}
					<p class="text-xs text-muted-foreground mt-1">
						Enter your API token, or save it globally in
						<a href="/settings#provisioning" class="underline text-primary">Settings → Provisioning</a>.
					</p>
				{/if}
				<div class="relative mt-2">
					<Input
						type={showToken ? 'text' : 'password'}
						placeholder="Enter API token..."
						bind:value={data.providerToken}
						class="pr-9 font-mono text-xs"
					/>
					<button
						type="button"
						onclick={() => (showToken = !showToken)}
						class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
					>
						{#if showToken}
							<EyeOff class="size-3.5" />
						{:else}
							<Eye class="size-3.5" />
						{/if}
					</button>
				</div>
				{#if !savedToken && !data.providerToken}
					<div class="flex items-start gap-1.5 mt-1.5">
						<AlertTriangle class="size-3.5 text-amber-500 mt-0.5 shrink-0" />
						<p class="text-xs text-amber-600 dark:text-amber-400">No API token set. Provisioning will fail without one.</p>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
