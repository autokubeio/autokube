<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle,
		AlertDialogTrigger
	} from '$lib/components/ui/alert-dialog';
	import {
		Monitor,
		Building2,
		Calendar,
		Clock,
		Shield,
		CheckCircle2,
		Key,
		AlertTriangle,
		Loader2
	} from 'lucide-svelte';
	import { onMount } from 'svelte';

	// ── State ──────────────────────────────────────────────────────────────
	interface LicenseStatus {
		valid: boolean;
		active: boolean;
		isEnterprise: boolean;
		hostname: string;
		hostnameEnvSet: boolean;
		daysUntilExpiry?: number | null;
		stored?: {
			name: string;
			key: string;
			activatedAt: string;
		};
		payload?: {
			name: string;
			host: string;
			issued: string;
			expires: string | null;
			type: string;
		};
		error?: string;
	}

	let status = $state<LicenseStatus | null>(null);
	let loading = $state(true);
	let activating = $state(false);
	let deactivating = $state(false);

	// Form
	let form = $state({
		name: '',
		key: ''
	});
	let errors = $state<Record<string, string>>({});

	// ── Lifecycle ──────────────────────────────────────────────────────────
	onMount(loadLicense);

	async function loadLicense() {
		loading = true;
		try {
			const res = await fetch('/api/license');
			if (res.ok) {
				status = await res.json();
			}
		} catch (err) {
			console.error('[License] Failed to load:', err);
		} finally {
			loading = false;
		}
	}

	// ── Actions ────────────────────────────────────────────────────────────
	function validate(): boolean {
		const e: Record<string, string> = {};
		if (!form.name.trim()) e.name = 'License holder name is required';
		if (!form.key.trim()) e.key = 'License key is required';
		errors = e;
		return Object.keys(e).length === 0;
	}

	async function activate() {
		if (!validate()) return;
		activating = true;
		errors = {};

		try {
			const res = await fetch('/api/license', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form)
			});
			const data = await res.json();

			if (res.ok && data.success) {
				form = { name: '', key: '' };
				await loadLicense();
			} else {
				errors.general = data.error ?? 'Failed to activate license';
			}
		} catch (err) {
			console.error('[License] Activation error:', err);
			errors.general = 'Network error - failed to activate license';
		} finally {
			activating = false;
		}
	}

	async function deactivate() {
		if (
			!confirm(
				'Are you sure you want to deactivate this license? All enterprise features will be disabled.'
			)
		) {
			return;
		}

		deactivating = true;
		try {
			const res = await fetch('/api/license', { method: 'DELETE' });
			if (res.ok) {
				await loadLicense();
			}
		} catch (err) {
			console.error('[License] Deactivation error:', err);
		} finally {
			deactivating = false;
		}
	}

	// ── Computed ───────────────────────────────────────────────────────────
	const isActivated = $derived(status?.active && status?.valid);
	const hostnameMatches = $derived(status?.hostname === status?.payload?.host);

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'numeric',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

{#if loading}
	<div class="flex items-center justify-center py-12">
		<Loader2 class="size-4 animate-spin text-muted-foreground" />
	</div>
{:else if isActivated && status?.payload}
	<!-- License Information (Activated State) -->
	<div>
		<h2 class="text-lg font-semibold">License Information</h2>
		<p class="mt-0.5 text-sm text-muted-foreground">Details about your current license</p>
	</div>

	<div class="mt-4 space-y-2">
		<!-- Licensed to -->
		<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
				<Building2 class="size-4 text-muted-foreground" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-sm font-medium">{status.payload.name}</span>
					<Badge variant="default" class="text-[10px] capitalize">{status.payload.type}</Badge>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">Licensed to</p>
			</div>
		</div>

		<!-- Licensed host -->
		<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
				<Monitor class="size-4 text-muted-foreground" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="font-mono text-sm font-medium">{status.payload.host}</span>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">Licensed host</p>
			</div>
		</div>

		<!-- Issue date -->
		<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
				<Calendar class="size-4 text-muted-foreground" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-sm font-medium">{formatDate(status.payload.issued)}</span>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">Issue date</p>
			</div>
		</div>

		<!-- Expiration -->
		<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
				<Clock class="size-4 text-muted-foreground" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-sm font-medium">
						{status.payload.expires ? formatDate(status.payload.expires) : 'Never'}
					</span>
					{#if status.daysUntilExpiry !== null && status.daysUntilExpiry !== undefined}
						{@const badgeColor =
							status.daysUntilExpiry > 30 ? 'green' : status.daysUntilExpiry > 7 ? 'yellow' : 'red'}
						<Badge
							variant="outline"
							class="text-[10px] {badgeColor === 'green'
								? 'border-green-600 text-green-600'
								: badgeColor === 'yellow'
									? 'border-yellow-600 text-yellow-600'
									: 'border-red-600 text-red-600'}"
						>
							<span
								class="mr-1 inline-block size-1.5 rounded-full {badgeColor === 'green'
									? 'bg-green-500'
									: badgeColor === 'yellow'
										? 'bg-yellow-500'
										: 'bg-red-500'}"
							></span>
							{status.daysUntilExpiry} days
						</Badge>
					{/if}
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">Expiration</p>
			</div>
		</div>
	</div>

	<!-- System Information -->
	<div class="mt-6">
		<h2 class="text-lg font-semibold">System Information</h2>
		<p class="mt-0.5 text-sm text-muted-foreground">
			This hostname must match the licensed host for validation
		</p>
	</div>

	{#if !status.hostnameEnvSet}
		<div class="mt-4 flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
			<AlertTriangle class="mt-0.5 size-4 shrink-0 text-yellow-500" />
			<div class="min-w-0 flex-1 text-sm">
				<p class="font-medium text-yellow-600 dark:text-yellow-400">Hostname may change unexpectedly</p>
				<p class="mt-1 text-muted-foreground">
					<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">AUTOKUBE_HOSTNAME</code> is not set.
					The hostname is read from the OS and can change (e.g. after a reboot or network change), which will invalidate your license.
				</p>
				<p class="mt-1.5 text-xs text-muted-foreground">
					Set <code class="rounded bg-muted px-1 py-0.5 font-mono">AUTOKUBE_HOSTNAME=your-hostname</code> to pin the hostname and prevent this.
				</p>
			</div>
		</div>
	{/if}

	<div class="mt-4">
		<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
				<Monitor class="size-4 text-muted-foreground" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="font-mono text-sm font-medium">{status.hostname}</span>
					{#if hostnameMatches}
						<Badge variant="outline" class="border-green-600 text-[10px] text-green-600">
							<span class="mr-1 inline-block size-1.5 rounded-full bg-green-500"></span>
							Match
						</Badge>
					{:else}
						<Badge variant="outline" class="border-destructive text-[10px] text-destructive">
							<span class="mr-1 inline-block size-1.5 rounded-full bg-destructive"></span>
							Mismatch
						</Badge>
					{/if}
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">Current hostname</p>
			</div>
		</div>
	</div>

	<!-- Deactivate License -->
	<div class="mt-6 rounded-lg border border-destructive/50 bg-card">
		<div class="flex items-start justify-between gap-4 px-4 py-4">
			<div class="flex flex-1 items-start gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10"
				>
					<Key class="size-4 text-destructive" />
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="text-sm font-semibold text-destructive">Deactivate License</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						Removing the license will disable all features tied to your plan.
					</p>
					<p class="mt-3 text-sm text-muted-foreground">
						Once deactivated, AutoKube will revert to the free tier. You can re-activate at any time
						by entering a valid license key.
					</p>
				</div>
			</div>
			<AlertDialog>
				<AlertDialogTrigger>
					{#snippet child({ props })}
						<Button {...props} variant="destructive" size="sm" class="shrink-0" disabled={deactivating}>
							{#if deactivating}
								<Loader2 class="mr-1.5 size-3 animate-spin" />
							{/if}
							{deactivating ? 'Deactivating…' : 'Deactivate License'}
						</Button>
					{/snippet}
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Deactivate license?</AlertDialogTitle>
						<AlertDialogDescription class="text-sm">
							Are you sure you want to deactivate this license? All enterprise features will be
							disabled.
							<br /><br />
							Once deactivated, AutoKube will revert to the free tier. You can re-activate at any time
							by entering a valid license key.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
							onclick={deactivate}
						>
							Deactivate License
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	</div>
{:else}
	<!-- Upgrade Banner -->
	<div class="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
		<div class="flex-1 min-w-0">
			<p class="text-sm font-semibold text-foreground">Unlock enterprise features</p>
			<p class="text-xs text-muted-foreground mt-0.5">
				Get SSO / LDAP, custom roles, audit log export, and priority support with a Business License.
			</p>
		</div>
		<a
			href="https://autokube.io/pricing"
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
		>
			<Shield class="size-3" />
			Get Business License
		</a>
	</div>

	<!-- Activation Form (No License State) -->
	<!-- System Information -->
	<div>
		<h2 class="text-lg font-semibold">System Information</h2>
		<p class="mt-0.5 text-sm text-muted-foreground">
			Your license will be validated against this hostname
		</p>
	</div>

	{#if !status?.hostnameEnvSet}
		<div class="mt-4 flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3">
			<AlertTriangle class="mt-0.5 size-4 shrink-0 text-yellow-500" />
			<div class="min-w-0 flex-1 text-sm">
				<p class="font-medium text-yellow-600 dark:text-yellow-400">Hostname may change unexpectedly</p>
				<p class="mt-1 text-muted-foreground">
					<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">AUTOKUBE_HOSTNAME</code> is not set.
					The hostname is read from the OS and can change (e.g. after a reboot or network change), which will invalidate your license.
				</p>
				<p class="mt-1.5 text-xs text-muted-foreground">
					Set <code class="rounded bg-muted px-1 py-0.5 font-mono">AUTOKUBE_HOSTNAME=your-hostname</code> to pin the hostname and prevent this.
				</p>
			</div>
		</div>
	{/if}

	<div class="mt-4">
		<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
			<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
				<Monitor class="size-4 text-muted-foreground" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="font-mono text-sm font-medium">{status?.hostname ?? 'Unknown'}</span>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">Current hostname</p>
			</div>
		</div>
	</div>

	<!-- Activate License -->
	<div class="mt-6">
		<h2 class="text-lg font-semibold">Activate License</h2>
		<p class="mt-0.5 text-sm text-muted-foreground">
			Enter your license details to unlock enterprise features
		</p>
	</div>

	<div class="mt-4 space-y-4 rounded-lg border bg-card px-4 py-4">
		<!-- License Holder Name -->
		<div class="space-y-1.5">
			<Label for="license-name" class="text-xs">
				License Holder Name
				<span class="ml-1 text-muted-foreground"
					>Must match exactly the name on your license certificate</span
				>
			</Label>
			<Input
				id="license-name"
				placeholder="Acme Corporation"
				bind:value={form.name}
				class={errors.name ? 'border-destructive' : ''}
				disabled={activating}
			/>
			{#if errors.name}
				<p class="text-xs text-destructive">{errors.name}</p>
			{/if}
		</div>

		<!-- License Key -->
		<div class="space-y-1.5">
			<Label for="license-key" class="text-xs">
				License Key
				<span class="ml-1 text-muted-foreground">The license key provided by AutoKube support</span>
			</Label>
			<Textarea
				id="license-key"
				placeholder="Paste your license key here..."
				bind:value={form.key}
				class="min-h-30 font-mono text-xs {errors.key ? 'border-destructive' : ''}"
				disabled={activating}
			/>
			{#if errors.key}
				<p class="text-xs text-destructive">{errors.key}</p>
			{/if}
		</div>

		{#if errors.general}
			<div class="rounded-md bg-destructive/10 px-3 py-2">
				<p class="text-xs text-destructive">{errors.general}</p>
			</div>
		{/if}

		<Button size="sm" class="gap-1.5 text-xs" onclick={activate} disabled={activating}>
			{#if activating}
				<Loader2 class="size-3 animate-spin" />
			{:else}
				<Shield class="size-3" />
			{/if}
			{activating ? 'Activating…' : 'Activate License'}
		</Button>
	</div>
{/if}
