<script lang="ts">
	import AccessRestricted from '$lib/components/access-restricted.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { cn } from '$lib/utils';
	import { onMount } from 'svelte';
	import { Bot, Plus, Pencil, Trash2, Eye, EyeOff, Star, StarOff, Loader2, Sparkles } from 'lucide-svelte';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';

	// ── Types ───────────────────────────────────────────────────────
	interface SafeProvider {
		id: number;
		name: string;
		provider: string;
		model: string;
		baseUrl: string | null;
		enabled: boolean;
		isDefault: boolean;
		hasApiKey: boolean;
		createdAt: string;
		updatedAt: string;
	}

	const PROVIDER_OPTIONS = [
		{ value: 'openai', label: 'OpenAI' },
		{ value: 'anthropic', label: 'Anthropic' },
		{ value: 'openrouter', label: 'OpenRouter' },
		{ value: 'custom', label: 'Custom / Local' }
	];

	const MODEL_PRESETS: Record<string, string[]> = {
		openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
		anthropic: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5'],
		openrouter: ['openai/gpt-4o', 'anthropic/claude-opus-4-5', 'google/gemini-2.5-pro'],
		custom: []
	};

	// ── State ────────────────────────────────────────────────────────
	let providers = $state<SafeProvider[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Dialog
	let dialogOpen = $state(false);
	let editingId = $state<number | null>(null);
	let saving = $state(false);
	let dialogError = $state('');

	// Form fields
	let formName = $state('');
	let formProvider = $state('openai');
	let formModel = $state('gpt-4o');
	let formApiKey = $state('');
	let formBaseUrl = $state('');
	let formEnabled = $state(true);
	let formIsDefault = $state(false);
	let showApiKey = $state(false);

	// Delete

	// ── Derived ──────────────────────────────────────────────────────
	const isEditMode = $derived(editingId !== null);
	const needsBaseUrl = $derived(formProvider === 'openrouter' || formProvider === 'custom');
	const modelPresets = $derived(MODEL_PRESETS[formProvider] ?? []);
	const providerLabel = $derived(PROVIDER_OPTIONS.find((p) => p.value === formProvider)?.label ?? formProvider);

	// ── Helpers ──────────────────────────────────────────────────────
	function providerLabel2(p: string): string {
		return PROVIDER_OPTIONS.find((o) => o.value === p)?.label ?? p;
	}

	function providerIcon(p: string): string {
		switch (p) {
			case 'openai': return 'text-emerald-500';
			case 'anthropic': return 'text-orange-500';
			case 'openrouter': return 'text-violet-500';
			default: return 'text-sky-500';
		}
	}

	function providerBadge(p: string): string {
		switch (p) {
			case 'openai': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
			case 'anthropic': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
			case 'openrouter': return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
			default: return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
		}
	}

	// ── API ──────────────────────────────────────────────────────────
	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/ai/providers');
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Failed to load providers');
			providers = data.providers;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load';
		} finally {
			loading = false;
		}
	}

	function openNew() {
		editingId = null;
		formName = '';
		formProvider = 'openai';
		formModel = 'gpt-4o';
		formApiKey = '';
		formBaseUrl = '';
		formEnabled = true;
		formIsDefault = providers.length === 0;
		showApiKey = false;
		dialogError = '';
		dialogOpen = true;
	}

	function openEdit(p: SafeProvider) {
		editingId = p.id;
		formName = p.name;
		formProvider = p.provider;
		formModel = p.model;
		formApiKey = '';
		formBaseUrl = p.baseUrl ?? '';
		formEnabled = p.enabled;
		formIsDefault = p.isDefault;
		showApiKey = false;
		dialogError = '';
		dialogOpen = true;
	}

	async function handleSave() {
		if (!formName.trim()) { dialogError = 'Name is required'; return; }
		if (!formModel.trim()) { dialogError = 'Model is required'; return; }
		if (!isEditMode && !formApiKey.trim()) { dialogError = 'API key is required'; return; }

		saving = true;
		dialogError = '';

		const body: Record<string, unknown> = {
			name: formName.trim(),
			provider: formProvider,
			model: formModel.trim(),
			baseUrl: formBaseUrl.trim() || null,
			enabled: formEnabled,
			isDefault: formIsDefault
		};
		if (formApiKey.trim()) body.apiKey = formApiKey.trim();

		try {
			const url = isEditMode ? `/api/ai/providers/${editingId}` : '/api/ai/providers';
			const method = isEditMode ? 'PATCH' : 'POST';
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Save failed');
			dialogOpen = false;
			await load();
		} catch (err) {
			dialogError = err instanceof Error ? err.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	async function handleToggleEnabled(p: SafeProvider) {
		try {
			const res = await fetch(`/api/ai/providers/${p.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !p.enabled })
			});
			if (res.ok) await load();
		} catch (e) { console.error('[AI] toggle failed', e); }
	}

	async function handleSetDefault(p: SafeProvider) {
		try {
			const res = await fetch(`/api/ai/providers/${p.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isDefault: true })
			});
			if (res.ok) await load();
		} catch (e) { console.error('[AI] set-default failed', e); }
	}

	async function handleDelete(id: number) {
		try {
			const res = await fetch(`/api/ai/providers/${id}`, { method: 'DELETE' });
			if (res.ok) await load();
		} catch (e) { console.error('[AI] delete failed', e); }
	}

	// ── Lifecycle ────────────────────────────────────────────────────
	onMount(load);

	interface Props { canAccess?: boolean; }
	let { canAccess = true }: Props = $props();
</script>

{#if !canAccess}
<AccessRestricted message="You don't have permission to manage AI settings. Contact your administrator." />
{:else}
<!-- Header -->
<div class="flex items-start justify-between">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold">AI Providers</h2>
			<Badge variant="secondary" class="text-xs">{providers.length}</Badge>
		</div>
		<p class="mt-0.5 text-sm text-muted-foreground">
			Configure AI providers for the assistant. API keys are stored encrypted.
		</p>
	</div>
	<Button size="sm" class="gap-1.5 text-xs" onclick={openNew}>
		<Plus class="size-3" />
		Add Provider
	</Button>
</div>

<!-- Provider list -->
<div class="mt-4 space-y-2">
	{#if loading && providers.length === 0}
		<div class="flex items-center justify-center py-12">
			<Loader2 class="size-4 animate-spin text-muted-foreground" />
		</div>
	{:else if error}
		<p class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
			{error}
		</p>
	{:else if providers.length === 0}
		<div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12">
			<Bot class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No AI providers configured</p>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openNew}>
				<Plus class="size-3" /> Add your first provider
			</Button>
		</div>
	{:else}
		{#each providers as p (p.id)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<!-- Icon -->
				<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
					<Sparkles class={cn('size-4', providerIcon(p.provider))} />
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-sm font-medium">{p.name}</span>
						<Badge variant="outline" class={cn('text-[10px]', providerBadge(p.provider))}>
							{providerLabel2(p.provider)}
						</Badge>
						{#if p.isDefault}
							<Badge variant="outline" class="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
								<span class="mr-1 inline-block size-1.5 rounded-full bg-amber-400"></span>
								Default
							</Badge>
						{/if}
						{#if p.enabled}
							<Badge variant="outline" class="text-[10px]">
								<span class="mr-1 inline-block size-1.5 rounded-full bg-green-500"></span>
								Enabled
							</Badge>
						{:else}
							<Badge variant="outline" class="text-[10px] text-muted-foreground">
								<span class="mr-1 inline-block size-1.5 rounded-full bg-muted-foreground"></span>
								Disabled
							</Badge>
						{/if}
					</div>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{p.model}</p>
				</div>

				<!-- Actions -->
				<div class="flex shrink-0 items-center gap-1">
					<Switch
						checked={p.enabled}
						onCheckedChange={() => handleToggleEnabled(p)}
						aria-label="Toggle provider"
					/>
					{#if !p.isDefault}
						<Button
							variant="ghost"
							size="icon"
							class="size-7 text-muted-foreground hover:text-amber-400"
							title="Set as default"
							onclick={() => handleSetDefault(p)}
						>
							<StarOff class="size-3.5" />
						</Button>
					{:else}
						<Button variant="ghost" size="icon" class="size-7 text-amber-400 cursor-default" disabled>
							<Star class="size-3.5" />
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						onclick={() => openEdit(p)}
					>
						<Pencil class="size-3.5" />
					</Button>
					<ConfirmDelete
						title={p.name}
						description="Remove this AI provider? This cannot be undone."
						onConfirm={() => handleDelete(p.id)}
					>
						<Button
							variant="ghost"
							size="icon"
							class="size-7 text-muted-foreground hover:text-destructive"
						>
							<Trash2 class="size-3.5" />
						</Button>
					</ConfirmDelete>
				</div>
			</div>
		{/each}
	{/if}
</div>

<!-- Add / Edit Dialog -->
<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{isEditMode ? 'Edit' : 'Add'} AI Provider</Dialog.Title>
			<Dialog.Description>
				{isEditMode ? 'Update provider configuration.' : 'Configure a new AI provider. The API key is encrypted before storage.'}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Name -->
			<div class="space-y-1.5">
				<Label for="ai-name">Name <span class="text-destructive">*</span></Label>
				<Input id="ai-name" placeholder="e.g. My OpenAI" bind:value={formName} />
			</div>

			<!-- Provider -->
			<div class="space-y-1.5">
				<Label>Provider</Label>
				<Select.Root type="single" bind:value={formProvider}>
					<Select.Trigger class="w-full">
						{providerLabel}
					</Select.Trigger>
					<Select.Content>
						{#each PROVIDER_OPTIONS as opt (opt.value)}
							<Select.Item value={opt.value}>{opt.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Model -->
			<div class="space-y-1.5">
				<Label for="ai-model">Model <span class="text-destructive">*</span></Label>
				{#if modelPresets.length > 0}
					<div class="flex gap-2">
						<Input id="ai-model" placeholder="gpt-4o" bind:value={formModel} class="flex-1" />
						<Select.Root type="single" onValueChange={(v: string) => { if (v) formModel = v; }}>
							<Select.Trigger class="w-32 shrink-0 text-xs">Presets</Select.Trigger>
							<Select.Content>
								{#each modelPresets as m (m)}
									<Select.Item value={m}>{m}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				{:else}
					<Input id="ai-model" placeholder="llama-3.2" bind:value={formModel} />
				{/if}
			</div>

			<!-- API Key -->
			<div class="space-y-1.5">
				<Label for="ai-key">
					API Key
					{#if isEditMode}
						<span class="text-xs text-muted-foreground">(leave blank to keep current)</span>
					{:else}
						<span class="text-destructive">*</span>
					{/if}
				</Label>
				<div class="relative">
					<Input
						id="ai-key"
						type={showApiKey ? 'text' : 'password'}
						placeholder={isEditMode ? '••••••••' : 'sk-…'}
						bind:value={formApiKey}
						class="pr-10"
					/>
					<button
						type="button"
						class="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
						onclick={() => (showApiKey = !showApiKey)}
					>
						{#if showApiKey}
							<EyeOff class="size-4" />
						{:else}
							<Eye class="size-4" />
						{/if}
					</button>
				</div>
			</div>

			<!-- Base URL (conditional) -->
			{#if needsBaseUrl}
				<div class="space-y-1.5">
					<Label for="ai-base-url">Base URL</Label>
					<Input
						id="ai-base-url"
						placeholder={formProvider === 'openrouter' ? 'https://openrouter.ai/api' : 'http://localhost:11434'}
						bind:value={formBaseUrl}
					/>
				</div>
			{/if}

			<!-- Toggles -->
			<div class="flex items-center justify-between rounded-md border px-3 py-2.5">
				<div>
					<p class="text-sm font-medium">Set as Default</p>
					<p class="text-xs text-muted-foreground">Used when no provider is specified</p>
				</div>
				<Switch bind:checked={formIsDefault} />
			</div>

			<div class="flex items-center justify-between rounded-md border px-3 py-2.5">
				<div>
					<p class="text-sm font-medium">Enabled</p>
					<p class="text-xs text-muted-foreground">Allow this provider to be used for the assistant</p>
				</div>
				<Switch bind:checked={formEnabled} />
			</div>

			{#if dialogError}
				<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{dialogError}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button onclick={handleSave} disabled={saving}>
				{#if saving}
					<Loader2 class="mr-2 size-4 animate-spin" />
				{/if}
				{isEditMode ? 'Save Changes' : 'Add Provider'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
{/if}
