<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import { sshKeysStore } from '$lib/stores/ssh-keys.svelte';
	import {
		KeyRound,
		RefreshCw,
		Upload,
		Plus,
		Copy,
		Trash2,
		Terminal,
		Lock,
		AlertTriangle,
		UploadCloud,
		CheckCircle2
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import ConfirmDelete from '$lib/components/confirm-delete.svelte';

	// ── New Key dialog ──────────────────────────────────────────────
	let newKeyOpen = $state(false);
	let newKeyName = $state('');
	let newKeyDesc = $state('');
	let newKeyPrivate = $state('');
	let newKeyGenerating = $state(false);
	let newKeySaving = $state(false);
	let newKeyError = $state('');

	async function handleGenerate(type: 'ed25519' | 'rsa') {
		newKeyGenerating = true;
		newKeyError = '';
		try {
			const result = await sshKeysStore.generate(type);
			newKeyPrivate = result.privateKey;
		} catch (err) {
			newKeyError = err instanceof Error ? err.message : 'Generation failed';
		} finally {
			newKeyGenerating = false;
		}
	}

	async function handleCreateKey() {
		if (!newKeyName.trim() || !newKeyPrivate.trim()) return;
		newKeySaving = true;
		newKeyError = '';
		try {
			await sshKeysStore.createPrivate({
				name: newKeyName.trim(),
				description: newKeyDesc.trim() || undefined,
				privateKey: newKeyPrivate.trim()
			});
			newKeyOpen = false;
			newKeyName = '';
			newKeyDesc = '';
			newKeyPrivate = '';
		} catch (err) {
			newKeyError = err instanceof Error ? err.message : 'Failed to create key';
		} finally {
			newKeySaving = false;
		}
	}

	function closeNewKey() {
		newKeyOpen = false;
		newKeyName = '';
		newKeyDesc = '';
		newKeyPrivate = '';
		newKeyError = '';
	}

	// ── Import dialog ───────────────────────────────────────────────
	let importOpen = $state(false);
	let importName = $state('');
	let importDesc = $state('');
	let importPublicKey = $state('');
	let importSaving = $state(false);
	let importError = $state('');
	let dragOver = $state(false);

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files[0];
		if (file) readPubFile(file);
	}

	function handleFileInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) readPubFile(file);
	}

	function readPubFile(file: File) {
		const reader = new FileReader();
		reader.onload = (e) => {
			const text = e.target?.result as string;
			importPublicKey = text.trim();
			// Auto-fill name from filename
			if (!importName) {
				importName = file.name.replace(/\.pub$/, '');
			}
		};
		reader.readAsText(file);
	}

	async function handleImportKey() {
		if (!importName.trim() || !importPublicKey.trim()) return;
		importSaving = true;
		importError = '';
		try {
			await sshKeysStore.importPublic({
				name: importName.trim(),
				description: importDesc.trim() || undefined,
				publicKey: importPublicKey.trim()
			});
			importOpen = false;
			importName = '';
			importDesc = '';
			importPublicKey = '';
		} catch (err) {
			importError = err instanceof Error ? err.message : 'Failed to import key';
		} finally {
			importSaving = false;
		}
	}

	function closeImport() {
		importOpen = false;
		importName = '';
		importDesc = '';
		importPublicKey = '';
		importError = '';
	}

	// ── Delete ──────────────────────────────────────────────────────
	let deletingId = $state<number | null>(null);

	async function handleDelete(id: number) {
		deletingId = id;
		try {
			await sshKeysStore.delete(id);
		} finally {
			deletingId = null;
		}
	}

	// ── Copy fingerprint ────────────────────────────────────────────
	let copiedId = $state<number | null>(null);

	async function copyFingerprint(id: number, fingerprint: string) {
		await navigator.clipboard.writeText(fingerprint);
		copiedId = id;
		setTimeout(() => (copiedId = null), 2000);
	}

	// ── Format date ─────────────────────────────────────────────────
	function formatDate(iso: string) {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(new Date(iso));
	}

	onMount(() => {
		sshKeysStore.fetch();
	});
</script>

<!-- Header -->
<div class="flex items-start justify-between">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold">SSH Keys</h2>
			<Badge variant="secondary" class="text-xs">{sshKeysStore.keys.length}</Badge>
		</div>
		<p class="mt-0.5 text-sm text-muted-foreground">
			Manage SSH keys for server authentication and deployments
		</p>
	</div>
	<div class="flex items-center gap-2">
		<Button
			variant="outline"
			size="sm"
			class="gap-1.5 text-xs"
			onclick={() => sshKeysStore.fetch()}
			disabled={sshKeysStore.loading}
		>
			<RefreshCw class={cn('size-3', sshKeysStore.loading && 'animate-spin')} />
			Refresh
		</Button>
		<Button variant="outline" size="sm" class="gap-1.5 text-xs" onclick={() => (importOpen = true)}>
			<Upload class="size-3" />
			Import
		</Button>
		<Button size="sm" class="gap-1.5 text-xs" onclick={() => (newKeyOpen = true)}>
			<Plus class="size-3" />
			New Key
		</Button>
	</div>
</div>

<!-- Key list -->
<div class="mt-4 space-y-2">
	{#if sshKeysStore.loading && sshKeysStore.keys.length === 0}
		<div class="flex items-center justify-center py-12">
			<RefreshCw class="size-4 animate-spin text-muted-foreground" />
		</div>
	{:else if sshKeysStore.keys.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12"
		>
			<KeyRound class="size-8 text-muted-foreground/50" />
			<p class="text-sm text-muted-foreground">No SSH keys yet</p>
			<Button
				size="sm"
				variant="outline"
				class="gap-1.5 text-xs"
				onclick={() => (newKeyOpen = true)}
			>
				<Plus class="size-3" /> Add your first key
			</Button>
		</div>
	{:else}
		{#each sshKeysStore.keys as key (key.id)}
			<div class="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
				<!-- Icon -->
				<div class="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted">
					<KeyRound class="size-4 text-muted-foreground" />
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-sm font-medium">{key.name}</span>
						<Badge variant="secondary" class="font-mono text-[10px] uppercase">
							{key.keyType === 'rsa' ? 'RSA' : 'ED25519'}
						</Badge>
					</div>
					<p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">{key.fingerprint}</p>
					<p class="text-xs text-muted-foreground">Added {formatDate(key.createdAt)}</p>
				</div>

				<!-- Actions -->
				<div class="flex shrink-0 items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						class="size-7 text-muted-foreground hover:text-foreground"
						onclick={() => copyFingerprint(key.id, key.fingerprint)}
					>
						{#if copiedId === key.id}
							<CheckCircle2 class="size-3.5 text-green-500" />
						{:else}
							<Copy class="size-3.5" />
						{/if}
					</Button>
					<ConfirmDelete
						title={key.name}
						loading={deletingId === key.id}
						onConfirm={() => handleDelete(key.id)}
					>
						{#snippet children()}
							<Button
								variant="ghost"
								size="icon"
								class="size-7 text-muted-foreground hover:text-destructive"
								disabled={deletingId === key.id}
							>
								{#if deletingId === key.id}
									<RefreshCw class="size-3.5 animate-spin" />
								{:else}
									<Trash2 class="size-3.5" />
								{/if}
							</Button>
						{/snippet}
					</ConfirmDelete>
				</div>
			</div>
		{/each}
	{/if}
</div>

<!-- ── New Private Key Dialog ──────────────────────────────────────── -->
<Dialog.Root
	open={newKeyOpen}
	onOpenChange={(v) => {
		if (!v) closeNewKey();
	}}
>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>New Private Key</Dialog.Title>
		</Dialog.Header>

		<!-- Warning -->
		<div class="flex gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
			<AlertTriangle class="mt-0.5 size-4 shrink-0 text-yellow-500" />
			<div class="text-sm text-muted-foreground">
				Private Keys are used to connect to your servers without passwords.<br />
				<strong class="text-foreground">You should not use passphrase protected keys.</strong>
			</div>
		</div>

		<!-- Generate buttons -->
		<div class="grid grid-cols-2 gap-2">
			<Button
				variant="outline"
				class="gap-2 text-sm"
				onclick={() => handleGenerate('ed25519')}
				disabled={newKeyGenerating}
			>
				<Terminal class="size-4" />
				{newKeyGenerating ? 'Generating…' : 'Generate new ED25519 SSH Key'}
			</Button>
			<Button
				variant="outline"
				class="gap-2 text-sm"
				onclick={() => handleGenerate('rsa')}
				disabled={newKeyGenerating}
			>
				<Lock class="size-4" />
				{newKeyGenerating ? 'Generating…' : 'Generate new RSA SSH Key'}
			</Button>
		</div>

		<!-- Fields -->
		<div class="space-y-4">
			<div class="space-y-1.5">
				<Label>Name <span class="text-destructive">*</span></Label>
				<Input placeholder="my-ssh-key" bind:value={newKeyName} />
			</div>
			<div class="space-y-1.5">
				<Label>Description</Label>
				<Input placeholder="Optional description" bind:value={newKeyDesc} />
			</div>
			<div class="space-y-1.5">
				<Label>Private Key <span class="text-destructive">*</span></Label>
				<textarea
					class="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs text-muted-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring focus:outline-none"
					placeholder="——BEGIN OPENSSH PRIVATE KEY——"
					bind:value={newKeyPrivate}
				></textarea>
			</div>
		</div>

		{#if newKeyError}
			<p class="text-xs text-destructive">{newKeyError}</p>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={closeNewKey}>Cancel</Button>
			<Button
				onclick={handleCreateKey}
				disabled={!newKeyName.trim() || !newKeyPrivate.trim() || newKeySaving}
			>
				{newKeySaving ? 'Creating…' : 'Create Key'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- ── Import SSH Public Key Dialog ───────────────────────────────── -->
<Dialog.Root
	open={importOpen}
	onOpenChange={(v) => {
		if (!v) closeImport();
	}}
>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Import SSH Public Key</Dialog.Title>
		</Dialog.Header>

		<!-- Drop zone -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class={cn(
				'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
				dragOver
					? 'border-primary bg-primary/5'
					: 'border-border hover:border-primary/50 hover:bg-muted/30'
			)}
			ondragover={(e) => {
				e.preventDefault();
				dragOver = true;
			}}
			ondragleave={() => (dragOver = false)}
			ondrop={handleDrop}
			onclick={() => document.getElementById('pub-file-input')?.click()}
		>
			<UploadCloud class="size-7 text-muted-foreground" />
			<p class="text-sm">
				Drop your <code class="rounded bg-muted px-1 font-mono text-xs">.pub</code> file here, or
				<span class="text-primary underline underline-offset-2">click to browse</span>
			</p>
			<p class="text-xs text-muted-foreground">
				Accepts ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub
			</p>
		</div>
		<input
			id="pub-file-input"
			type="file"
			accept=".pub"
			class="hidden"
			onchange={handleFileInput}
		/>

		<!-- Divider -->
		<div class="flex items-center gap-3">
			<div class="h-px flex-1 bg-border"></div>
			<span class="text-xs text-muted-foreground">or paste manually</span>
			<div class="h-px flex-1 bg-border"></div>
		</div>

		<!-- Fields -->
		<div class="space-y-4">
			<div class="space-y-1.5">
				<Label>Name <span class="text-destructive">*</span></Label>
				<Input placeholder="my-workstation" bind:value={importName} />
			</div>
			<div class="space-y-1.5">
				<Label>Public Key <span class="text-destructive">*</span></Label>
				<textarea
					class="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs text-muted-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring focus:outline-none"
					placeholder="ssh-ed25519 AAAA ... user@host"
					bind:value={importPublicKey}
				></textarea>
			</div>
		</div>

		{#if importError}
			<p class="text-xs text-destructive">{importError}</p>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={closeImport}>Cancel</Button>
			<Button
				onclick={handleImportKey}
				disabled={!importName.trim() || !importPublicKey.trim() || importSaving}
			>
				{importSaving ? 'Importing…' : 'Import Key'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
