<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { AlertCircle, LogIn, Globe, Server, ChevronLeft } from 'lucide-svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { mode } from 'mode-watcher';

	interface SsoProvider {
		id: number;
		name: string;
		enabled: boolean;
	}

	type ActiveProvider =
		| { type: 'local' }
		| { type: 'ldap'; id: number; name: string }
		| { type: 'oidc'; id: number };

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let checking = $state(true);
	let oidcProviders = $state<SsoProvider[]>([]);
	let ldapProviders = $state<SsoProvider[]>([]);

	// Which provider the form is currently signed into
	let activeProvider = $state<ActiveProvider>({ type: 'local' });

	const hasExternalProviders = $derived(oidcProviders.length > 0 || ldapProviders.length > 0);
	const activeLabel = $derived(
		activeProvider.type === 'ldap' ? activeProvider.name : 'Local Account'
	);

	onMount(async () => {
		settingsStore.applyAll(mode.current);

		// Show OIDC error from callback redirect
		const urlError = page.url.searchParams.get('error');
		if (urlError) {
			const messages: Record<string, string> = {
				invalid_state: 'SSO login failed: invalid state. Please try again.',
				exchange_failed: 'SSO login failed: could not exchange token.',
				no_username: 'SSO login failed: provider returned no username.',
				provider_not_found: 'SSO provider not found or disabled.',
				server_error: 'SSO login failed: server error.'
			};
			error = messages[urlError] ?? `SSO login failed: ${urlError}`;
		}

		try {
			const res = await fetch('/api/auth-settings');
			if (!res.ok) throw new Error('Failed to load auth settings');
			const settings = await res.json();

			if (!settings.authEnabled) {
				await goto('/');
				return;
			}

			const meRes = await fetch('/api/auth/me');
			if (meRes.ok) {
				await goto('/');
				return;
			}

			// Load SSO providers for login page (public endpoint — no auth required)
			try {
				const ssoRes = await fetch('/api/sso/providers');
				if (ssoRes.ok) {
					const sso = await ssoRes.json();
					ldapProviders = sso.ldap ?? [];
					oidcProviders = sso.oidc ?? [];
				}
			} catch {
				// SSO providers are optional — ignore errors silently
			}

			// Auto-select single LDAP provider if no OIDC providers exist
			if (ldapProviders.length === 1 && oidcProviders.length === 0) {
				activeProvider = { type: 'ldap', id: ldapProviders[0].id, name: ldapProviders[0].name };
			}
		} catch (err) {
			console.error('[Login] Check error:', err);
		} finally {
			checking = false;
		}
	});

	$effect(() => {
		settingsStore.applyAll(mode.current);
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';

		if (!username.trim() || !password) {
			error = 'Please enter your username and password';
			return;
		}

		loading = true;
		try {
			const body =
				activeProvider.type === 'ldap'
					? { username: username.trim(), password, provider: activeProvider.id }
					: { username: username.trim(), password };

			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await res.json();
			if (!res.ok) {
				error = data.error || 'Invalid username or password';
				return;
			}
			await goto('/');
		} catch (err) {
			console.error('[Login] Error:', err);
			error = 'Something went wrong. Please try again.';
		} finally {
			loading = false;
		}
	}

	function selectLdap(p: SsoProvider) {
		error = '';
		activeProvider = { type: 'ldap', id: p.id, name: p.name };
	}

	function selectLocal() {
		error = '';
		activeProvider = { type: 'local' };
	}

	function loginWithOidc(providerId: number) {
		window.location.href = `/api/auth/oidc/${providerId}`;
	}
</script>

<svelte:head>
	<title>Log In - AutoKube</title>
</svelte:head>

{#if checking}
	<div
		class="flex min-h-screen items-center justify-center bg-linear-to-br from-background via-muted/20 to-background"
	>
		<div class="animate-pulse text-muted-foreground">Loading...</div>
	</div>
{:else}
	<div
		class="flex min-h-screen items-center justify-center bg-linear-to-br from-background via-muted/20 to-background p-4"
	>
		<Card class="w-full max-w-sm shadow-xl">
			<CardHeader class="space-y-1 pb-3">
				<div class="mb-2 flex items-center justify-center">
					<div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
						<span class="text-xl font-bold text-primary">AK</span>
					</div>
				</div>
				<CardTitle class="text-center text-xl">Welcome to AutoKube</CardTitle>
				<CardDescription class="text-center text-xs">
					{#if activeProvider.type === 'ldap'}
						Signing in with <strong>{activeProvider.name}</strong>
					{:else}
						Sign in to continue
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>

				<!-- ── Provider picker (shown when SSO providers exist and no provider selected yet) ── -->
				{#if hasExternalProviders && activeProvider.type === 'local'}
					<!-- OIDC buttons -->
					{#if oidcProviders.length > 0}
						<div class="mb-3 space-y-2">
							{#each oidcProviders as p (p.id)}
								<Button
									type="button"
									variant="outline"
									class="h-9 w-full gap-2"
									onclick={() => loginWithOidc(p.id)}
								>
									<Globe class="size-3.5" />
									Continue with {p.name}
								</Button>
							{/each}
						</div>
					{/if}

					<!-- LDAP buttons -->
					{#if ldapProviders.length > 0}
						<div class="mb-3 space-y-2">
							{#each ldapProviders as p (p.id)}
								<Button
									type="button"
									variant="outline"
									class="h-9 w-full gap-2"
									onclick={() => selectLdap(p)}
								>
									<Server class="size-3.5" />
									Sign in with {p.name}
								</Button>
							{/each}
						</div>
					{/if}

					<!-- divider before local form -->
					<div class="relative mb-4 flex items-center gap-2">
						<div class="h-px flex-1 bg-border"></div>
						<span class="text-[10px] text-muted-foreground">or use a local account</span>
						<div class="h-px flex-1 bg-border"></div>
					</div>
				{/if}

				<!-- ── Back button when a specific LDAP provider is selected ── -->
				{#if activeProvider.type === 'ldap' && hasExternalProviders}
					<button
						type="button"
						class="mb-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
						onclick={selectLocal}
					>
						<ChevronLeft class="size-3" /> Back to sign-in options
					</button>
				{/if}

				<!-- ── Username / password form ── -->
				<form onsubmit={handleSubmit} class="space-y-3">
					<div class="space-y-1.5">
						<Label for="username" class="text-xs">
							{activeProvider.type === 'ldap' ? 'Directory Username' : 'Username'}
						</Label>
						<Input
							id="username"
							type="text"
							placeholder={activeProvider.type === 'ldap' ? 'john.doe' : 'Enter your username'}
							bind:value={username}
							disabled={loading}
							autocomplete="username"
							class="h-9"
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="password" class="text-xs">Password</Label>
						<Input
							id="password"
							type="password"
							placeholder="Enter your password"
							bind:value={password}
							disabled={loading}
							autocomplete="current-password"
							class="h-9"
						/>
					</div>

					{#if error}
						<div
							class="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2.5"
						>
							<AlertCircle class="size-3.5 shrink-0 text-destructive" />
							<p class="text-xs text-destructive">{error}</p>
						</div>
					{/if}

					<Button
						type="submit"
						class="h-9 w-full gap-1.5"
						disabled={loading || !username.trim() || !password}
					>
						{#if loading}
							Signing in...
						{:else}
							<LogIn class="size-3.5" />
							{activeProvider.type === 'ldap' ? `Sign in with ${activeLabel}` : 'Log In'}
						{/if}
					</Button>
				</form>
			</CardContent>
		</Card>
	</div>
{/if}
