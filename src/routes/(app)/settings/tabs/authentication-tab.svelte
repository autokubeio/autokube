<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Dialog from '$lib/components/ui/dialog';
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
		ShieldCheck,
		Users,
		UserPlus,
		Shield,
		Plus,
		Trash2,
		Pencil,
		AlertTriangle,
		AlertCircle,
		Sparkles,
		Server,
		Globe,
		CheckCircle2,
		XCircle,
		Loader2
	} from 'lucide-svelte';
	import UserDialog from '$lib/components/user-dialog.svelte';
	import RoleDialog from '$lib/components/role-dialog.svelte';
	import EnterpriseFeatureLock from '$lib/components/enterprise-feature-lock.svelte';
	import { authSettingsStore } from '$lib/stores/auth-settings.svelte';
	import { usersStore } from '$lib/stores/users.svelte';
	import { rolesStore } from '$lib/stores/roles.svelte';
	import type { User } from '$lib/server/db/schema';
	import type { PermissionMap, ResolvedRole } from '$lib/server/queries/roles';
	import type { ResolvedLdap } from '$lib/server/queries/ldap';
	import type { ResolvedOidc } from '$lib/server/queries/oidc';

	interface UserWithRole extends User {
		roleId: number | null;
		roleName: string | null;
	}

	// ── SSO provider shapes shown in UI (secrets replaced) ──────────────────
	type LdapUI = ResolvedLdap & { bindPassword?: string | null };
	type OidcUI = ResolvedOidc & { clientSecret: string };

	const authSettings = authSettingsStore();
	const users = usersStore();
	const roles = rolesStore();

	let userDialogOpen = $state(false);
	let editingUser = $state<UserWithRole | null>(null);
	let roleDialogOpen = $state(false);
	let editingRole = $state<ResolvedRole | null>(null);
	let hasValidLicense = $state(false);
	let licenseChecked = $state(false);

	// ── SSO state ────────────────────────────────────────────────────────────
	let ldapProviders = $state<LdapUI[]>([]);
	let oidcProviders = $state<OidcUI[]>([]);
	let ssoLoading = $state(false);

	// LDAP dialog
	let ldapDialogOpen = $state(false);
	let editingLdap = $state<LdapUI | null>(null);
	let ldapSaving = $state(false);
	let ldapTesting = $state(false);
	let ldapTestResult = $state<{ success: boolean; message: string } | null>(null);
	let ldapForm = $state(defaultLdapForm());

	// OIDC dialog
	let oidcDialogOpen = $state(false);
	let editingOidc = $state<OidcUI | null>(null);
	let oidcSaving = $state(false);
	let oidcForm = $state(defaultOidcForm());

	function defaultLdapForm() {
		return {
			name: '',
			enabled: true,
			serverUrl: 'ldap://localhost:389',
			bindDn: '',
			bindPassword: '',
			baseDn: '',
			userFilter: '(uid={username})',
			usernameAttribute: 'uid',
			emailAttribute: 'mail',
			displayNameAttribute: 'cn',
			groupBaseDn: '',
			groupFilter: '',
			adminGroup: '',
			tlsEnabled: false,
			tlsCa: ''
		};
	}

	function defaultOidcForm() {
		return {
			name: '',
			enabled: true,
			issuerUrl: '',
			clientId: '',
			clientSecret: '',
			redirectUri: '',
			scopes: 'openid profile email',
			usernameClaim: 'preferred_username',
			emailClaim: 'email',
			displayNameClaim: 'name',
			adminClaim: '',
			adminValue: '',
			roleMappingsClaim: 'groups'
		};
	}

	const authEnabled = $derived(authSettings.settings?.authEnabled ?? false);
	const isEditLdap = $derived(!!editingLdap);
	const isEditOidc = $derived(!!editingOidc);

	onMount(async () => {
		authSettings.loadSettings();
		users.loadUsers();
		roles.loadRoles();
		try {
			const res = await fetch('/api/license');
			const data = await res.json();
			hasValidLicense = data.active && (data.payload?.type === 'professional' || data.payload?.type === 'enterprise');
		} catch {
			hasValidLicense = false;
		} finally {
			licenseChecked = true;
		}
		if (hasValidLicense) loadSsoProviders();
	});

	async function loadSsoProviders() {
		ssoLoading = true;
		try {
			const [ldapRes, oidcRes] = await Promise.all([
				fetch('/api/sso/ldap'),
				fetch('/api/sso/oidc')
			]);
			ldapProviders = ldapRes.ok ? await ldapRes.json() : [];
			oidcProviders = oidcRes.ok ? await oidcRes.json() : [];
		} catch (err) {
			console.error('[SSO] Failed to load providers:', err);
		} finally {
			ssoLoading = false;
		}
	}

	// ── LDAP dialog ──────────────────────────────────────────────────────────
	function openAddLdap() {
		editingLdap = null;
		ldapForm = defaultLdapForm();
		ldapTestResult = null;
		ldapDialogOpen = true;
	}

	function openEditLdap(p: LdapUI) {
		editingLdap = p;
		ldapForm = {
			name: p.name,
			enabled: p.enabled,
			serverUrl: p.serverUrl,
			bindDn: p.bindDn ?? '',
			bindPassword: p.bindPassword ?? '',
			baseDn: p.baseDn,
			userFilter: p.userFilter,
			usernameAttribute: p.usernameAttribute,
			emailAttribute: p.emailAttribute,
			displayNameAttribute: p.displayNameAttribute,
			groupBaseDn: p.groupBaseDn ?? '',
			groupFilter: p.groupFilter ?? '',
			adminGroup: p.adminGroup ?? '',
			tlsEnabled: p.tlsEnabled,
			tlsCa: p.tlsCa ?? ''
		};
		ldapTestResult = null;
		ldapDialogOpen = true;
	}

	async function saveLdap() {
		if (!ldapForm.name.trim() || !ldapForm.serverUrl.trim() || !ldapForm.baseDn.trim()) {
			toast.error('Name, Server URL, and Base DN are required');
			return;
		}
		ldapSaving = true;
		try {
			const payload: Partial<LdapUI> = {
				...ldapForm,
				bindDn: ldapForm.bindDn || null,
				bindPassword: ldapForm.bindPassword || null,
				groupBaseDn: ldapForm.groupBaseDn || null,
				groupFilter: ldapForm.groupFilter || null,
				adminGroup: ldapForm.adminGroup || null,
				tlsCa: ldapForm.tlsCa || null
			};
			const url = isEditLdap ? `/api/sso/ldap/${editingLdap!.id}` : '/api/sso/ldap';
			const method = isEditLdap ? 'PATCH' : 'POST';
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
			toast.success(isEditLdap ? 'LDAP provider updated' : 'LDAP provider created');
			ldapDialogOpen = false;
			loadSsoProviders();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save LDAP provider');
		} finally {
			ldapSaving = false;
		}
	}

	async function testLdap() {
		if (!editingLdap) return;
		ldapTesting = true;
		ldapTestResult = null;
		try {
			const res = await fetch(`/api/sso/ldap/${editingLdap.id}/test`, { method: 'POST' });
			ldapTestResult = await res.json();
		} catch {
			ldapTestResult = { success: false, message: 'Request failed' };
		} finally {
			ldapTesting = false;
		}
	}

	async function deleteLdap(id: number, name: string) {
		const res = await fetch(`/api/sso/ldap/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.success(`Deleted "${name}"`);
			loadSsoProviders();
		} else {
			toast.error('Failed to delete LDAP provider');
		}
	}

	async function toggleLdap(p: LdapUI) {
		await fetch(`/api/sso/ldap/${p.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !p.enabled })
		});
		loadSsoProviders();
	}

	// ── OIDC dialog ──────────────────────────────────────────────────────────
	function openAddOidc() {
		editingOidc = null;
		oidcForm = defaultOidcForm();
		oidcDialogOpen = true;
	}

	function openEditOidc(p: OidcUI) {
		editingOidc = p;
		oidcForm = {
			name: p.name,
			enabled: p.enabled,
			issuerUrl: p.issuerUrl,
			clientId: p.clientId,
			clientSecret: p.clientSecret,
			redirectUri: p.redirectUri,
			scopes: p.scopes,
			usernameClaim: p.usernameClaim,
			emailClaim: p.emailClaim,
			displayNameClaim: p.displayNameClaim,
			adminClaim: p.adminClaim ?? '',
			adminValue: p.adminValue ?? '',
			roleMappingsClaim: p.roleMappingsClaim ?? 'groups'
		};
		oidcDialogOpen = true;
	}

	async function saveOidc() {
		if (!oidcForm.name.trim() || !oidcForm.issuerUrl.trim() || !oidcForm.clientId.trim()) {
			toast.error('Name, Issuer URL, and Client ID are required');
			return;
		}
		oidcSaving = true;
		try {
			const payload = {
				...oidcForm,
				// Auto-derive redirect URI if the admin left it blank
				redirectUri: oidcForm.redirectUri.trim() || oidcCallbackUrl(),
				adminClaim: oidcForm.adminClaim || null,
				adminValue: oidcForm.adminValue || null
			};
			const url = isEditOidc ? `/api/sso/oidc/${editingOidc!.id}` : '/api/sso/oidc';
			const method = isEditOidc ? 'PATCH' : 'POST';
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
			toast.success(isEditOidc ? 'OIDC provider updated' : 'OIDC provider created');
			oidcDialogOpen = false;
			loadSsoProviders();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save OIDC provider');
		} finally {
			oidcSaving = false;
		}
	}

	async function deleteOidc(id: number, name: string) {
		const res = await fetch(`/api/sso/oidc/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.success(`Deleted "${name}"`);
			loadSsoProviders();
		} else {
			toast.error('Failed to delete OIDC provider');
		}
	}

	async function toggleOidc(p: OidcUI) {
		await fetch(`/api/sso/oidc/${p.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !p.enabled })
		});
		loadSsoProviders();
	}

	// Compute callback URL hint
	function oidcCallbackUrl() {
		if (typeof window === 'undefined') return '';
		return `${window.location.origin}/api/auth/oidc/callback`;
	}

	async function handleToggleAuth(enabled: boolean) {
		try {
			await authSettings.updateSettings({ authEnabled: enabled });
		} catch (err) {
			console.error('[Auth Tab] Toggle error:', err);
		}
	}

	function openAddUserDialog() {
		editingUser = null;
		userDialogOpen = true;
	}

	function openEditUserDialog(user: UserWithRole) {
		editingUser = user;
		userDialogOpen = true;
	}

	function closeUserDialog() {
		userDialogOpen = false;
		editingUser = null;
	}

	function openAddRoleDialog() {
		editingRole = null;
		roleDialogOpen = true;
	}

	function openEditRoleDialog(role: ResolvedRole) {
		editingRole = role;
		roleDialogOpen = true;
	}

	function closeRoleDialog() {
		roleDialogOpen = false;
		editingRole = null;
	}

	async function handleSaveUser(data: {
		username: string;
		email?: string;
		displayName?: string;
		password?: string;
		roleId: number | null;
		isActive: boolean;
	}) {
		if (editingUser) {
			await users.updateUser(editingUser.id, data);
		} else {
			if (!data.password) throw new Error('Password is required for new users');
			await users.createUser({
				username: data.username,
				password: data.password,
				email: data.email,
				displayName: data.displayName,
				roleId: data.roleId ?? undefined
			});
		}
	}

	async function handleSaveRole(data: { name: string; description: string; permissions: PermissionMap }) {
		if (editingRole) {
			await roles.updateRole(editingRole.id, data);
		} else {
			await roles.createRole(data);
		}
	}

	async function handleDeleteUser(userId: number) {
		await users.deleteUser(userId);
	}

	async function handleDeleteRole(roleId: number) {
		await roles.deleteRole(roleId);
	}

	function getRoleName(roleId: number | null) {
		return roles.roles.find((r) => r.id === roleId)?.name ?? '—';
	}

	function getUserAvatar(name: string) {
		const initials = name
			.split(/[\s_]/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
		return initials;
	}

	function getTotalPermissions(role: ResolvedRole) {
		return Object.values(role.permissions).reduce(
			(n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
			0
		);
	}
</script>

<!-- Authentication toggle -->
<div class="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-4">
	<div class="flex items-center gap-3">
		<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
			<ShieldCheck class="size-4 text-primary" />
		</div>
		<div>
			<p class="text-sm font-semibold">Authentication</p>
			<p class="text-xs text-muted-foreground">
				{#if authEnabled}
					Users must log in to access AutoKube
				{:else}
					Authentication is disabled — anyone can access AutoKube
				{/if}
			</p>
		</div>
	</div>
	{#if authSettings.loading}
		<Skeleton class="h-6 w-11 rounded-full" />
	{:else}
		<Switch
			checked={authEnabled}
			onCheckedChange={handleToggleAuth}
			disabled={authSettings.loading}
		/>
	{/if}
</div>
{#if !authEnabled && !authSettings.loading}
	<div
		class="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-3"
	>
		<AlertTriangle class="size-3.5 shrink-0 text-yellow-500" />
		<p class="text-xs text-yellow-600 dark:text-yellow-400">
			Warning: Disabling authentication exposes AutoKube to anyone who can reach this host.
		</p>
	</div>
{/if}

<!-- Users -->
<div class="mt-6 flex items-start justify-between">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold">Users</h2>
			{#if !users.loading}
				<Badge variant="secondary" class="text-xs">
					{users.users.length}
				</Badge>
			{/if}
		</div>
		<p class="mt-0.5 text-sm text-muted-foreground">
			Manage who has access and their assigned role
		</p>
	</div>
	<Button size="sm" class="shrink-0 gap-1.5 text-xs" onclick={openAddUserDialog}>
		<UserPlus class="size-3" />
		Add User
	</Button>
</div>

<div class="mt-4 space-y-2">
	{#if users.loading}
		{#each Array.from({ length: 3 }, (_, index) => index) as index (index)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<Skeleton class="size-9 rounded-full" />
				<div class="flex-1 space-y-1.5">
					<Skeleton class="h-3.5 w-32" />
					<Skeleton class="h-3 w-48" />
				</div>
				<Skeleton class="h-5 w-16 rounded-full" />
			</div>
		{/each}
	{:else if users.error}
		<div
			class="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-xs text-destructive"
		>
			<AlertCircle class="size-4" />
			Failed to load users.
		</div>
	{:else if users.users.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12"
		>
			<Users class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No users yet</p>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openAddUserDialog}>
				<UserPlus class="size-3" /> Add your first user
			</Button>
		</div>
	{:else}
		{#each users.users as user (user.id)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<!-- Avatar -->
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-primary/10 text-xs font-semibold text-primary"
				>
					{getUserAvatar(user.displayName || user.username)}
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-sm font-medium">{user.displayName || user.username}</span>
						<span class="text-xs text-muted-foreground">@{user.username}</span>
						{#if !user.isActive}
							<Badge
								variant="outline"
								class="border-muted-foreground/30 text-[10px] text-muted-foreground"
							>
								inactive
							</Badge>
						{/if}
						<Badge variant="secondary" class="text-[10px]">
							{user.roleName ?? getRoleName(user.roleId)}
						</Badge>
					</div>
					<div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						{#if user.email}
							<span>{user.email}</span>
						{/if}
						{#if user.lastLogin}
							<span>•</span>
							<span>Last login: {new Date(user.lastLogin).toLocaleDateString()}</span>
						{/if}
					</div>
				</div>

				<!-- Actions -->
				<div class="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						onclick={() => openEditUserDialog(user)}
					>
						<Pencil class="size-3.5" />
					</Button>
					<AlertDialog>
						<AlertDialogTrigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="size-7 text-muted-foreground hover:text-destructive"
								>
									<Trash2 class="size-3.5" />
								</Button>
							{/snippet}
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Delete user?</AlertDialogTitle>
								<AlertDialogDescription class="text-xs">
									<strong>{user.displayName || user.username}</strong> will immediately lose access to
									AutoKube.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel class="h-8 text-xs">Cancel</AlertDialogCancel>
								<AlertDialogAction
									class="text-destructive-foreground h-8 bg-destructive text-xs hover:bg-destructive/90"
									onclick={() => handleDeleteUser(user.id)}
								>
									Delete
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		{/each}
	{/if}
</div>

<!-- Roles -->
<div class="mt-6">
	<div class="flex items-center gap-2 mb-1">
		<Badge
			class="h-5 gap-0.5 rounded-md border-0 bg-linear-to-r from-amber-400 to-yellow-500 px-1.5 text-[10px] font-bold text-black shadow-sm"
		>
			<Sparkles class="size-3" />
			Pro
		</Badge>
		<h2 class="text-lg font-semibold">Roles</h2>
		{#if hasValidLicense && !roles.loading}
			<Badge variant="secondary" class="text-xs">
				{roles.roles.length}
			</Badge>
		{/if}
	</div>
	<p class="mt-0.5 text-sm text-muted-foreground">
		Define roles with system and cluster-level permissions
	</p>
</div>

{#if !licenseChecked}
	<div class="mt-4 flex items-center justify-center py-8">
		<Skeleton class="h-32 w-full rounded-lg" />
	</div>
{:else if !hasValidLicense}
	<div class="mt-4">
		<EnterpriseFeatureLock
			inline
			featureName="Roles"
			description="Define custom roles with granular permissions to control who can access what in AutoKube."
			features={['Custom role definitions', 'Granular permission control', 'Cluster-scoped access', 'User role assignment']}
		/>
	</div>
{:else}
<div class="mt-2 flex justify-end">
	<Button size="sm" class="shrink-0 gap-1.5 text-xs" onclick={openAddRoleDialog}>
		<Plus class="size-3" />
		New Role
	</Button>
</div>

<div class="mt-4 space-y-2">
	{#if roles.loading}
		{#each Array.from({ length: 3 }, (_, index) => index) as index (index)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<Skeleton class="size-9 rounded-full" />
				<div class="flex-1 space-y-1.5">
					<Skeleton class="h-3.5 w-24" />
					<Skeleton class="h-3 w-40" />
				</div>
				<Skeleton class="h-5 w-20 rounded-full" />
			</div>
		{/each}
	{:else if roles.error}
		<div
			class="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-xs text-destructive"
		>
			<AlertCircle class="size-4" />
			Failed to load roles.
		</div>
	{:else if roles.roles.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12"
		>
			<Shield class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No roles defined yet</p>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openAddRoleDialog}>
				<Plus class="size-3" /> Create your first role
			</Button>
		</div>
	{:else}
		{#each roles.roles as role (role.id)}
			{@const totalPerms = getTotalPermissions(role)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<!-- Icon -->
				<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
					<Shield class="size-4 text-muted-foreground" />
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-sm font-medium">{role.name}</span>
						{#if role.isSystem}
							<Badge
								variant="outline"
								class="border-muted-foreground/30 text-[10px] text-muted-foreground"
							>
								system
							</Badge>
						{/if}
						<Badge variant="secondary" class="text-[10px]">
							{role.userCount}
							{role.userCount === 1 ? 'user' : 'users'}
						</Badge>
					</div>
					<div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						{#if role.description}
							<span>{role.description}</span>
							<span>•</span>
						{/if}
						<span>{totalPerms} permissions</span>
					</div>
				</div>

				<!-- Actions -->
				<div class="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						onclick={() => openEditRoleDialog(role)}
					>
						<Pencil class="size-3.5" />
					</Button>
					{#if !role.isSystem}
						<AlertDialog>
							<AlertDialogTrigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon"
										class="size-7 text-muted-foreground hover:text-destructive"
									>
										<Trash2 class="size-3.5" />
									</Button>
								{/snippet}
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete role?</AlertDialogTitle>
									<AlertDialogDescription class="text-xs">
										The <strong>{role.name}</strong> role will be removed and users assigned to it will
										lose this role.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel class="h-8 text-xs">Cancel</AlertDialogCancel>
									<AlertDialogAction
										class="text-destructive-foreground h-8 bg-destructive text-xs hover:bg-destructive/90"
										onclick={() => handleDeleteRole(role.id)}
									>
										Delete
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</div>
{/if}

<!-- ── SSO / Enterprise Auth ─────────────────────────────────────────────── -->
<div class="mt-8">
	<div class="mb-1 flex items-center gap-2">
		<Badge
			class="h-5 gap-0.5 rounded-md border-0 bg-linear-to-r from-amber-400 to-yellow-500 px-1.5 text-[10px] font-bold text-black shadow-sm"
		>
			<Sparkles class="size-3" />
			Pro
		</Badge>
		<h2 class="text-lg font-semibold">SSO / Enterprise Auth</h2>
	</div>
	<p class="text-sm text-muted-foreground">
		Connect external identity providers — LDAP/Active Directory or OpenID Connect
	</p>
</div>

{#if !licenseChecked}
	<div class="mt-4">
		<Skeleton class="h-32 w-full rounded-lg" />
	</div>
{:else if !hasValidLicense}
	<div class="mt-4">
		<EnterpriseFeatureLock
			inline
			featureName="SSO"
			description="Authenticate users via your corporate LDAP directory or any OIDC-compatible provider."
			features={['LDAP / Active Directory', 'OpenID Connect (OIDC)', 'Auto-provision users', 'Group → role mapping']}
		/>
	</div>
{:else}
	<!-- LDAP providers -->
	<div class="mt-5">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Server class="size-4 text-muted-foreground" />
				<span class="text-sm font-medium">LDAP / Active Directory</span>
				{#if !ssoLoading}
					<Badge variant="secondary" class="text-[10px]">{ldapProviders.length}</Badge>
				{/if}
			</div>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openAddLdap}>
				<Plus class="size-3" /> Add LDAP
			</Button>
		</div>

		<div class="mt-3 space-y-2">
			{#if ssoLoading}
				{#each [0, 1] as i (i)}
					<div class="flex h-14 animate-pulse items-center gap-3 rounded-lg border bg-card px-4">
						<Skeleton class="size-8 rounded-full" />
						<div class="flex-1 space-y-1.5">
							<Skeleton class="h-3.5 w-36" />
							<Skeleton class="h-3 w-52" />
						</div>
					</div>
				{/each}
			{:else if ldapProviders.length === 0}
				<div
					class="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center"
				>
					<Server class="size-7 text-muted-foreground/40" />
					<p class="text-xs text-muted-foreground">No LDAP providers configured</p>
				</div>
			{:else}
				{#each ldapProviders as ldap (ldap.id)}
					<div class="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
						<div
							class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-blue-500/10"
						>
							<Server class="size-4 text-blue-500" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="text-sm font-medium">{ldap.name}</span>
								{#if ldap.enabled}
									<Badge variant="outline" class="text-[10px]">
										<span class="mr-1 inline-block size-1.5 rounded-full bg-green-500"></span>Enabled
									</Badge>
								{:else}
									<Badge
										variant="outline"
										class="text-[10px] text-muted-foreground"
									>
										<span
											class="mr-1 inline-block size-1.5 rounded-full bg-muted-foreground"
										></span>Disabled
									</Badge>
								{/if}
							</div>
							<p class="mt-0.5 truncate text-xs text-muted-foreground">{ldap.serverUrl}</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Switch
								checked={ldap.enabled}
								onCheckedChange={() => toggleLdap(ldap)}
								aria-label="Toggle LDAP provider"
							/>
							<Button
								variant="ghost"
								size="icon"
								class="size-7 text-muted-foreground hover:text-foreground"
								onclick={() => openEditLdap(ldap)}
							>
								<Pencil class="size-3.5" />
							</Button>
							<AlertDialog>
								<AlertDialogTrigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="size-7 text-muted-foreground hover:text-destructive"
										>
											<Trash2 class="size-3.5" />
										</Button>
									{/snippet}
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Delete LDAP provider?</AlertDialogTitle>
										<AlertDialogDescription class="text-xs">
											<strong>{ldap.name}</strong> will be removed. Users who logged in via this
											provider will keep their local accounts.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel class="h-8 text-xs">Cancel</AlertDialogCancel>
										<AlertDialogAction
											class="text-destructive-foreground h-8 bg-destructive text-xs hover:bg-destructive/90"
											onclick={() => deleteLdap(ldap.id, ldap.name)}
										>
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>

	<!-- OIDC providers -->
	<div class="mt-5">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Globe class="size-4 text-muted-foreground" />
				<span class="text-sm font-medium">OpenID Connect (OIDC)</span>
				{#if !ssoLoading}
					<Badge variant="secondary" class="text-[10px]">{oidcProviders.length}</Badge>
				{/if}
			</div>
			<Button size="sm" variant="outline" class="gap-1.5 text-xs" onclick={openAddOidc}>
				<Plus class="size-3" /> Add OIDC
			</Button>
		</div>

		<div class="mt-3 space-y-2">
			{#if ssoLoading}
				{#each [0, 1] as i (i)}
					<div class="flex h-14 animate-pulse items-center gap-3 rounded-lg border bg-card px-4">
						<Skeleton class="size-8 rounded-full" />
						<div class="flex-1 space-y-1.5">
							<Skeleton class="h-3.5 w-36" />
							<Skeleton class="h-3 w-52" />
						</div>
					</div>
				{/each}
			{:else if oidcProviders.length === 0}
				<div
					class="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center"
				>
					<Globe class="size-7 text-muted-foreground/40" />
					<p class="text-xs text-muted-foreground">No OIDC providers configured</p>
				</div>
			{:else}
				{#each oidcProviders as oidc (oidc.id)}
					<div class="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
						<div
							class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-purple-500/10"
						>
							<Globe class="size-4 text-purple-500" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="text-sm font-medium">{oidc.name}</span>
								{#if oidc.enabled}
									<Badge variant="outline" class="text-[10px]">
										<span class="mr-1 inline-block size-1.5 rounded-full bg-green-500"></span>Enabled
									</Badge>
								{:else}
									<Badge
										variant="outline"
										class="text-[10px] text-muted-foreground"
									>
										<span
											class="mr-1 inline-block size-1.5 rounded-full bg-muted-foreground"
										></span>Disabled
									</Badge>
								{/if}
							</div>
							<p class="mt-0.5 truncate text-xs text-muted-foreground">{oidc.issuerUrl}</p>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<Switch
								checked={oidc.enabled}
								onCheckedChange={() => toggleOidc(oidc)}
								aria-label="Toggle OIDC provider"
							/>
							<Button
								variant="ghost"
								size="icon"
								class="size-7 text-muted-foreground hover:text-foreground"
								onclick={() => openEditOidc(oidc)}
							>
								<Pencil class="size-3.5" />
							</Button>
							<AlertDialog>
								<AlertDialogTrigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="size-7 text-muted-foreground hover:text-destructive"
										>
											<Trash2 class="size-3.5" />
										</Button>
									{/snippet}
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Delete OIDC provider?</AlertDialogTitle>
										<AlertDialogDescription class="text-xs">
											<strong>{oidc.name}</strong> will be removed. Users who logged in via this
											provider will keep their local accounts.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel class="h-8 text-xs">Cancel</AlertDialogCancel>
										<AlertDialogAction
											class="text-destructive-foreground h-8 bg-destructive text-xs hover:bg-destructive/90"
											onclick={() => deleteOidc(oidc.id, oidc.name)}
										>
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<!-- ── LDAP Dialog ──────────────────────────────────────────────────────────── -->
<Dialog.Root bind:open={ldapDialogOpen}>
	<Dialog.Content class="max-h-[90vh] max-w-lg overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEditLdap ? 'Edit' : 'Add'} LDAP Provider</Dialog.Title>
			<Dialog.Description class="text-xs">
				Connect AutoKube to an LDAP directory or Active Directory server.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Basic -->
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Name *</Label>
					<Input bind:value={ldapForm.name} placeholder="Corporate AD" class="h-8 text-xs" />
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Server URL *</Label>
					<Input
						bind:value={ldapForm.serverUrl}
						placeholder="ldap://dc.example.com:389"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Bind DN</Label>
					<Input
						bind:value={ldapForm.bindDn}
						placeholder="cn=admin,dc=example,dc=com"
						class="h-8 text-xs"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Bind Password</Label>
					<Input
						type="password"
						bind:value={ldapForm.bindPassword}
						placeholder="••••••••"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">Base DN *</Label>
				<Input
					bind:value={ldapForm.baseDn}
					placeholder="dc=example,dc=com"
					class="h-8 text-xs"
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">User Filter</Label>
					<Input
						bind:value={ldapForm.userFilter}
						placeholder="(uid={'{username}'})"
						class="h-8 text-xs"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Username Attribute</Label>
					<Input
						bind:value={ldapForm.usernameAttribute}
						placeholder="uid"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Email Attribute</Label>
					<Input
						bind:value={ldapForm.emailAttribute}
						placeholder="mail"
						class="h-8 text-xs"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Display Name Attribute</Label>
					<Input
						bind:value={ldapForm.displayNameAttribute}
						placeholder="cn"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">Admin Group DN <span class="text-muted-foreground">(optional — grants admin)</span></Label>
				<Input
					bind:value={ldapForm.adminGroup}
					placeholder="cn=admins,dc=example,dc=com"
					class="h-8 text-xs"
				/>
			</div>
			<div class="flex items-center gap-2">
				<Switch bind:checked={ldapForm.tlsEnabled} />
				<Label class="text-xs">Enable TLS / LDAPS</Label>
			</div>
			{#if ldapForm.tlsEnabled}
				<div class="space-y-1.5">
					<Label class="text-xs">Custom CA Certificate (PEM)</Label>
					<textarea
						bind:value={ldapForm.tlsCa}
						placeholder="-----BEGIN CERTIFICATE-----"
						rows={4}
						class="w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
					></textarea>
				</div>
			{/if}

			<!-- Test result -->
			{#if ldapTestResult}
				<div
					class="flex items-start gap-2 rounded-md border px-3 py-2 text-xs {ldapTestResult.success
						? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
						: 'border-destructive/30 bg-destructive/10 text-destructive'}"
				>
					{#if ldapTestResult.success}
						<CheckCircle2 class="mt-0.5 size-3.5 shrink-0" />
					{:else}
						<XCircle class="mt-0.5 size-3.5 shrink-0" />
					{/if}
					<span>{ldapTestResult.message}</span>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="gap-2">
			{#if isEditLdap}
				<Button
					variant="outline"
					size="sm"
					class="text-xs"
					onclick={testLdap}
					disabled={ldapTesting}
				>
					{#if ldapTesting}
						<Loader2 class="mr-1 size-3 animate-spin" />
					{/if}
					Test Connection
				</Button>
			{/if}
			<Button variant="ghost" size="sm" class="text-xs" onclick={() => (ldapDialogOpen = false)}>
				Cancel
			</Button>
			<Button size="sm" class="text-xs" onclick={saveLdap} disabled={ldapSaving}>
				{#if ldapSaving}<Loader2 class="mr-1 size-3 animate-spin" />{/if}
				{isEditLdap ? 'Save Changes' : 'Add Provider'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- ── OIDC Dialog ──────────────────────────────────────────────────────────── -->
<Dialog.Root bind:open={oidcDialogOpen}>
	<Dialog.Content class="max-h-[90vh] max-w-lg overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEditOidc ? 'Edit' : 'Add'} OIDC Provider</Dialog.Title>
			<Dialog.Description class="text-xs">
				Connect AutoKube to any OpenID Connect-compatible identity provider (Auth0, Keycloak,
				Azure AD, Okta, Google…).
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Callback URL hint -->
			<div class="rounded-md border bg-muted/40 px-3 py-2">
				<p class="text-[10px] text-muted-foreground">Callback / Redirect URI to register with your provider:</p>
				<p class="mt-0.5 font-mono text-[11px] text-foreground">{oidcCallbackUrl()}</p>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Name *</Label>
					<Input bind:value={oidcForm.name} placeholder="Keycloak" class="h-8 text-xs" />
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Issuer URL *</Label>
					<Input
						bind:value={oidcForm.issuerUrl}
						placeholder="https://sso.example.com/realms/main"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Client ID *</Label>
					<Input bind:value={oidcForm.clientId} placeholder="autokube" class="h-8 text-xs" />
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Client Secret</Label>
					<Input
						type="password"
						bind:value={oidcForm.clientSecret}
						placeholder="••••••••"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">Scopes</Label>
				<Input
					bind:value={oidcForm.scopes}
					placeholder="openid profile email"
					class="h-8 text-xs"
				/>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Username Claim</Label>
					<Input
						bind:value={oidcForm.usernameClaim}
						placeholder="preferred_username"
						class="h-8 text-xs"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Email Claim</Label>
					<Input
						bind:value={oidcForm.emailClaim}
						placeholder="email"
						class="h-8 text-xs"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Name Claim</Label>
					<Input
						bind:value={oidcForm.displayNameClaim}
						placeholder="name"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Admin Claim <span class="text-muted-foreground">(optional)</span></Label>
					<Input
						bind:value={oidcForm.adminClaim}
						placeholder="roles"
						class="h-8 text-xs"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Admin Value</Label>
					<Input
						bind:value={oidcForm.adminValue}
						placeholder="autokube-admin"
						class="h-8 text-xs"
					/>
				</div>
			</div>
			<div class="space-y-1.5">
				<Label class="text-xs">Group/Role Claim <span class="text-muted-foreground">(for role mapping)</span></Label>
				<Input
					bind:value={oidcForm.roleMappingsClaim}
					placeholder="groups"
					class="h-8 text-xs"
				/>
			</div>
			<div class="flex items-center gap-2">
				<Switch bind:checked={oidcForm.enabled} />
				<Label class="text-xs">Enabled on login page</Label>
			</div>
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="ghost" size="sm" class="text-xs" onclick={() => (oidcDialogOpen = false)}>
				Cancel
			</Button>
			<Button size="sm" class="text-xs" onclick={saveOidc} disabled={oidcSaving}>
				{#if oidcSaving}<Loader2 class="mr-1 size-3 animate-spin" />{/if}
				{isEditOidc ? 'Save Changes' : 'Add Provider'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Dialogs -->
<UserDialog
	bind:open={userDialogOpen}
	user={editingUser}
	roles={roles.roles}
	onClose={closeUserDialog}
	onSave={handleSaveUser}
/>
<RoleDialog
	bind:open={roleDialogOpen}
	role={editingRole}
	onClose={closeRoleDialog}
	onSave={handleSaveRole}
/>
