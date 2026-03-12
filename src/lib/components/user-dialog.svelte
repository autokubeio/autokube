<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import type { User } from '$lib/server/db/schema';
	import type { ResolvedRole } from '$lib/server/queries/roles';

	interface UserWithRole extends User {
		roleId: number | null;
		roleName: string | null;
	}

	interface Props {
		open?: boolean;
		user?: UserWithRole | null;
		roles: ResolvedRole[];
		onClose: () => void;
		onSave: (data: {
			username: string;
			email?: string;
			displayName?: string;
			password?: string;
			roleId: number | null;
			isActive: boolean;
		}) => Promise<void>;
	}

	let { open = $bindable(false), user = null, roles, onClose, onSave }: Props = $props();

	let username = $state('');
	let email = $state('');
	let displayName = $state('');
	let password = $state('');
	let roleId = $state<string>('');
	let isActive = $state(true);
	let saving = $state(false);
	let errors = $state<Record<string, string>>({});

	const isEditMode = $derived(!!user);
	const isValid = $derived(
		username.trim().length > 0 &&
			(!isEditMode || password.trim().length === 0 || password.trim().length >= 6) &&
			(isEditMode || password.trim().length >= 6) &&
			roleId.length > 0
	);

	$effect(() => {
		if (open) {
			username = user?.username ?? '';
			email = user?.email ?? '';
			displayName = user?.displayName ?? '';
			password = '';
			roleId = user?.roleId ? String(user.roleId) : roles[0]?.id ? String(roles[0].id) : '';
			isActive = user?.isActive ?? true;
			errors = {};
		}
	});

	async function handleSave() {
		errors = {};

		if (!username.trim()) {
			errors.username = 'Username is required';
			return;
		}

		if (!isEditMode && password.trim().length < 6) {
			errors.password = 'Password must be at least 6 characters';
			return;
		}

		if (isEditMode && password.trim().length > 0 && password.trim().length < 6) {
			errors.password = 'Password must be at least 6 characters';
			return;
		}

		if (!roleId) {
			errors.roleId = 'Role is required';
			return;
		}

		saving = true;
		try {
			await onSave({
				username: username.trim(),
				email: email.trim() || undefined,
				displayName: displayName.trim() || undefined,
				password: password.trim() || undefined,
				roleId: roleId ? Number(roleId) : null,
				isActive
			});
			onClose();
		} catch (err) {
			console.error('[User Dialog] Save error:', err);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle class="text-base">{isEditMode ? 'Edit User' : 'Add User'}</DialogTitle>
		</DialogHeader>

		<div class="space-y-3 py-1">
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label class="text-xs">Username <span class="text-destructive">*</span></Label>
					<Input
						bind:value={username}
						placeholder="john_doe"
						class="h-8 text-xs"
						disabled={saving}
					/>
					{#if errors.username}
						<p class="text-[11px] text-destructive">{errors.username}</p>
					{/if}
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs">Display Name</Label>
					<Input
						bind:value={displayName}
						placeholder="John Doe"
						class="h-8 text-xs"
						disabled={saving}
					/>
				</div>
			</div>

			<div class="space-y-1.5">
				<Label class="text-xs">Email</Label>
				<Input
					bind:value={email}
					placeholder="user@example.com"
					type="email"
					class="h-8 text-xs"
					disabled={saving}
				/>
			</div>

			<div class="space-y-1.5">
				<Label class="text-xs">
					Password
					{#if !isEditMode}
						<span class="text-destructive">*</span>
					{:else}
						<span class="text-muted-foreground">(leave blank to keep)</span>
					{/if}
				</Label>
				<Input
					bind:value={password}
					placeholder={isEditMode ? '••••••••' : 'New password'}
					type="password"
					class="h-8 text-xs"
					disabled={saving}
				/>
				{#if errors.password}
					<p class="text-[11px] text-destructive">{errors.password}</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label class="text-xs">Role <span class="text-destructive">*</span></Label>
				<Select
					type="single"
					value={roleId as any}
					onValueChange={(v: any) => (roleId = v as string)}
					disabled={saving}
				>
					<SelectTrigger class="h-8 text-xs">
						{roles.find((r) => String(r.id) === roleId)?.name || 'Select a role'}
					</SelectTrigger>
					<SelectContent>
						{#each roles as role}
							<SelectItem value={String(role.id)} class="text-xs">
								<div class="flex items-center gap-2">
									<span>{role.name}</span>
									{#if role.isSystem}
										<Badge
											variant="outline"
											class="h-3.5 border-muted-foreground/30 px-1 text-[9px]"
										>
											system
										</Badge>
									{/if}
								</div>
							</SelectItem>
						{/each}
					</SelectContent>
				</Select>
				{#if errors.roleId}
					<p class="text-[11px] text-destructive">{errors.roleId}</p>
				{/if}
			</div>

			<div class="flex items-center justify-between rounded-lg border px-3 py-2.5">
				<div>
					<p class="text-xs font-medium">Active</p>
					<p class="text-[11px] text-muted-foreground">Allow this user to log in</p>
				</div>
				<Switch bind:checked={isActive} disabled={saving} />
			</div>
		</div>

		<DialogFooter class="pt-2">
			<Button variant="outline" size="sm" class="h-8 text-xs" onclick={onClose} disabled={saving}>
				Cancel
			</Button>
			<Button size="sm" class="h-8 text-xs" disabled={!isValid || saving} onclick={handleSave}>
				{saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Add User'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
