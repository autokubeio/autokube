<script lang="ts">
	import AccessRestricted from '$lib/components/access-restricted.svelte';
	import { Button } from '$lib/components/ui/button';
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
	import { AlertTriangle, Database, FileX, Trash2 } from 'lucide-svelte';

	let resettingConnections = $state(false);
	let clearingAudit = $state(false);
	let clearingData = $state(false);

	async function handleResetConnections() {
		resettingConnections = true;
		try {
			const res = await fetch('/api/clusters/reset', { method: 'POST' });
			if (res.ok) {
				window.location.reload();
			} else {
				const data = await res.json();
				alert(data.error || 'Failed to reset connections');
			}
		} catch (err) {
			console.error('[Danger Zone] Reset connections error:', err);
			alert('Failed to reset connections');
		} finally {
			resettingConnections = false;
		}
	}

	async function handleClearAuditLog() {
		clearingAudit = true;
		try {
			const res = await fetch('/api/audit/clear', { method: 'DELETE' });
			if (res.ok) {
				alert('Audit log cleared successfully');
			} else {
				const data = await res.json();
				alert(data.error || 'Failed to clear audit log');
			}
		} catch (err) {
			console.error('[Danger Zone] Clear audit log error:', err);
			alert('Failed to clear audit log');
		} finally {
			clearingAudit = false;
		}
	}

	async function handleClearAllData() {
		clearingData = true;
		try {
			const res = await fetch('/api/settings/reset', { method: 'DELETE' });
			if (res.ok) {
				window.location.href = '/';
			} else {
				const data = await res.json();
				alert(data.error || 'Failed to clear data');
			}
		} catch (err) {
			console.error('[Danger Zone] Clear all data error:', err);
			alert('Failed to clear data');
		} finally {
			clearingData = false;
		}
	}

	interface Props { canAccess?: boolean; }
	let { canAccess = true }: Props = $props();
</script>

{#if !canAccess}
<AccessRestricted message="You don't have permission to manage danger zone settings. Contact your administrator." />
{:else}
<div class="space-y-6">
	<div
		class="flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-3"
	>
		<AlertTriangle class="size-4 shrink-0 text-yellow-500" />
		<p class="text-sm text-yellow-600 dark:text-yellow-400">
			Warning: These actions are destructive and cannot be undone. Please proceed with caution.
		</p>
	</div>

	<!-- Reset cluster connections -->
	<div class="rounded-lg border border-destructive/50 bg-card">
		<div class="flex items-start justify-between gap-4 px-4 py-4">
			<div class="flex flex-1 items-start gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10"
				>
					<Database class="size-4 text-destructive" />
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="text-sm font-semibold text-destructive">Reset cluster connections</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						Remove all stored kubeconfigs and cluster credentials. You will need to re-add clusters.
					</p>
				</div>
			</div>
			<AlertDialog>
				<AlertDialogTrigger>
					{#snippet child({ props })}
						<Button {...props} variant="destructive" size="sm" class="shrink-0" disabled={resettingConnections}>
							{resettingConnections ? 'Resetting...' : 'Reset Connections'}
						</Button>
					{/snippet}
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reset all cluster connections?</AlertDialogTitle>
						<AlertDialogDescription class="text-sm">
							This will permanently delete all stored kubeconfigs and cluster credentials. You will
							need to re-add your clusters after this operation.
							<br /><br />
							<strong>This action cannot be undone.</strong>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
							onclick={handleResetConnections}
						>
							Reset Connections
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	</div>

	<!-- Clear audit log -->
	<div class="rounded-lg border border-destructive/50 bg-card">
		<div class="flex items-start justify-between gap-4 px-4 py-4">
			<div class="flex flex-1 items-start gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10"
				>
					<FileX class="size-4 text-destructive" />
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="text-sm font-semibold text-destructive">Clear audit log</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						Permanently delete all audit log entries. This cannot be undone.
					</p>
				</div>
			</div>
			<AlertDialog>
				<AlertDialogTrigger>
					{#snippet child({ props })}
						<Button {...props} variant="destructive" size="sm" class="shrink-0" disabled={clearingAudit}>
							{clearingAudit ? 'Clearing...' : 'Clear Audit Log'}
						</Button>
					{/snippet}
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Clear all audit log entries?</AlertDialogTitle>
						<AlertDialogDescription class="text-sm">
							This will permanently delete all audit log entries from the database. This includes
							all user actions, system events, and security logs.
							<br /><br />
							<strong>This action cannot be undone.</strong>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
							onclick={handleClearAuditLog}
						>
							Clear Audit Log
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	</div>

	<!-- Clear all application data -->
	<div class="rounded-lg border border-destructive/50 bg-card">
		<div class="flex items-start justify-between gap-4 px-4 py-4">
			<div class="flex flex-1 items-start gap-3">
				<div
					class="flex size-9 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10"
				>
					<Trash2 class="size-4 text-destructive" />
				</div>
				<div class="min-w-0 flex-1">
					<h3 class="text-sm font-semibold text-destructive">Clear all application data</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						Permanently delete all AutoKube configuration and cached data. This action is
						irreversible.
					</p>
				</div>
			</div>
			<AlertDialog>
				<AlertDialogTrigger>
					{#snippet child({ props })}
						<Button {...props} variant="destructive" size="sm" class="shrink-0" disabled={clearingData}>
							{clearingData ? 'Clearing...' : 'Clear All Data'}
						</Button>
					{/snippet}
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Clear all application data?</AlertDialogTitle>
						<AlertDialogDescription class="text-sm">
							This will permanently delete <strong>all AutoKube data</strong> including:
							<ul class="mt-2 ml-4 list-disc space-y-1">
								<li>All cluster connections and configurations</li>
								<li>User accounts and authentication settings</li>
								<li>SSH keys and credentials</li>
								<li>Notification channels and alert rules</li>
								<li>License information</li>
								<li>Audit logs and system settings</li>
							</ul>
							<br />
							<strong class="text-destructive"
								>This action cannot be undone. AutoKube will restart and you will be redirected to
								the setup page.</strong
							>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
							onclick={handleClearAllData}
						>
							Clear All Data
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	</div>
</div>
{/if}
