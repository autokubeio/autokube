<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { ShieldCheck, Sparkles } from 'lucide-svelte';

	interface Props {
		title?: string;
		featureName?: string;
		description?: string;
		features?: string[];
		featureColumns?: 1 | 2;
		inline?: boolean;
		containerless?: boolean;
		ctaLabel?: string;
		ctaHref?: string;
	}

	let {
		title = 'Enterprise Feature',
		featureName,
		description,
		features = [
			'Advanced access controls',
			'Granular operational workflows',
			'Enterprise-grade governance',
			'Premium AutoKube capabilities'
		],
		featureColumns = 2,
		inline = false,
		containerless = false,
		ctaLabel = 'Get Business License',
		ctaHref = 'https://autokube.io/pricing'
	}: Props = $props();

	const bodyText = $derived.by(() => {
		if (description) {
			return description;
		}

		return featureName
			? `${featureName} is available with a Professional or Enterprise license.`
			: 'This feature is available with a Professional or Enterprise license.';
	});

	function goToLicense() {
		window.location.assign(ctaHref);
	}
</script>

{#if inline}
	<!-- Inline card for embedding inside other pages -->
	<div class:rounded-lg={!containerless} class:border={!containerless} class:border-dashed={!containerless} class:p-6={!containerless}>
		<div class="flex flex-col items-center gap-4 text-center">
			<div class="rounded-full bg-primary/10 p-3">
				<ShieldCheck class="size-8 text-primary" />
			</div>
			<div>
				<h3 class="text-base font-semibold">{title}</h3>
				<p class="mt-1 text-sm text-muted-foreground">{bodyText}</p>
			</div>
			{#if features.length > 0}
				<div class="w-full max-w-xl rounded-2xl border border-border/60 bg-muted/20 p-4 text-left">
					<div class="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						<Sparkles class="size-3.5 text-yellow-500" />
						<span>Included With Pro And Enterprise</span>
					</div>
					<div class:grid-cols-2={featureColumns === 2} class="grid gap-2">
						{#each features as feature (feature)}
							<div class="flex items-center gap-2 rounded-xl border bg-background/70 px-3 py-2 text-sm text-foreground/90 shadow-sm">
								<div class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
									<ShieldCheck class="size-3 text-primary" />
								</div>
								<span class="leading-5">{feature}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<Button size="sm" onclick={goToLicense} class="gap-1.5 text-xs">
				<ShieldCheck class="size-3.5" />
				{ctaLabel}
			</Button>
		</div>
	</div>
{:else}
	<!-- Full-page centered lock -->
	<section class="flex h-full min-h-full w-full flex-1 items-center justify-center p-8">
		<Card.Root class="w-full max-w-md">
			<Card.Header class="text-center">
				<div class="mb-4 flex justify-center">
					<div class="rounded-full bg-primary/10 p-4">
						<ShieldCheck class="size-12 text-primary" />
					</div>
				</div>
				<Card.Title class="text-2xl">{title}</Card.Title>
				<Card.Description class="mt-2">{bodyText}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if features.length > 0}
					<div class="rounded-2xl border border-border/60 bg-muted/20 p-4">
						<div class="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							<Sparkles class="size-4 text-yellow-500" />
							<span>Included With Pro And Enterprise</span>
						</div>
						<div class="grid gap-2">
							{#each features as feature (feature)}
								<div class="flex items-center gap-3 rounded-xl border bg-background/70 px-3 py-2.5 text-sm text-foreground/90 shadow-sm">
									<div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
										<ShieldCheck class="size-3.5 text-primary" />
									</div>
									<span>{feature}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</Card.Content>
			<Card.Footer class="flex justify-center">
				<Button onclick={goToLicense} class="w-full gap-2">
					<ShieldCheck class="size-4" />
					{ctaLabel}
				</Button>
			</Card.Footer>
		</Card.Root>
	</section>
{/if}
