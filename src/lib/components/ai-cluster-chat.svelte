<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { Brain, X, Send, Square, Trash2, Bot, UserRound, AlertCircle, Loader2, Plus, History, MessageSquare } from 'lucide-svelte';
	import { marked } from 'marked';
	import { tick } from 'svelte';

	// Configure marked
	marked.setOptions({ gfm: true, breaks: true });

	// ── Types ────────────────────────────────────────────────────────
	interface Message {
		role: 'user' | 'assistant';
		content: string;
	}

	interface ChatSession {
		id: string;
		title: string;
		updatedAt: string | null;
	}

	interface SafeProvider {
		id: number;
		name: string;
		provider: string;
		model: string;
		isDefault: boolean;
		enabled: boolean;
		hasApiKey: boolean;
	}

	interface ClusterContext {
		id: number;
		name: string;
		status: string;
		health: string;
		version: string;
		nodes: number;
		namespaces: number;
		pods: number;
		runningPods: number;
		metricsAvailable: boolean;
	}

	type Props = {
		open?: boolean;
		cluster?: ClusterContext | null;
		onClose?: () => void;
	};

	// ── Props ────────────────────────────────────────────────────────
	let { open = $bindable(false), cluster = null, onClose }: Props = $props();

	// ── State ────────────────────────────────────────────────────────
	let messages = $state<Message[]>([]);
	let sessionId = $state<string | null>(null);
	let sessions = $state<ChatSession[]>([]);
	let loadingSessions = $state(false);
	let input = $state('');
	let loading = $state(false);
	let error = $state('');
	let providers = $state<SafeProvider[]>([]);
	let selectedProviderId = $state<number | null>(null);
	let abortController = $state<AbortController | null>(null);
	let messagesEnd = $state<HTMLElement | null>(null);
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let showHistory = $state(false);

	// ── Derived ──────────────────────────────────────────────────────
	const selectedProviderLabel = $derived(
		providers.find((p) => p.id === selectedProviderId)?.name ?? 'Select provider'
	);
	const currentSession = $derived(sessions.find((s) => s.id === sessionId) ?? null);
	const currentSessionTitle = $derived(currentSession?.title ?? 'New conversation');

	// ── Helpers ──────────────────────────────────────────────────────
	function relativeTime(dateStr: string | null): string {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	}

	function renderMarkdown(content: string): string {
		try {
			return marked.parse(content) as string;
		} catch {
			return content;
		}
	}

	async function scrollToBottom() {
		await tick();
		messagesEnd?.scrollIntoView({ behavior: 'smooth' });
	}

	function resizeTextarea() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
	}

	// ── API ──────────────────────────────────────────────────────────
	async function loadProviders() {
		try {
			const res = await fetch('/api/ai/providers');
			if (!res.ok) return;
			const data = await res.json();
			providers = (data.providers as SafeProvider[]).filter((p) => p.enabled && p.hasApiKey);
			const def = providers.find((p) => p.isDefault) ?? providers[0];
			if (def) selectedProviderId = def.id;
		} catch {
			// silent
		}
	}

	async function loadSessions() {
		if (!cluster?.id) return;
		loadingSessions = true;
		try {
			const res = await fetch(`/api/ai/chat/sessions?clusterId=${cluster.id}`);
			if (!res.ok) return;
			const data = await res.json();
			sessions = data.sessions ?? [];
			// Auto-select the most recent session and load its messages
			if (sessions.length > 0 && !sessionId) {
				await switchSession(sessions[0].id);
			}
		} catch {
			// silent
		} finally {
			loadingSessions = false;
		}
	}

	async function switchSession(id: string) {
		if (id === sessionId) return;
		sessionId = id;
		messages = [];
		error = '';
		try {
			const res = await fetch(`/api/ai/chat/sessions?sessionId=${id}`);
			if (!res.ok) return;
			const data = await res.json();
			messages = (data.messages ?? []).map((m: { role: string; content: string }) => ({
				role: m.role as 'user' | 'assistant',
				content: m.content
			}));
			await scrollToBottom();
		} catch {
			// silent
		}
	}

	function newConversation() {
		sessionId = null;
		messages = [];
		error = '';
		input = '';
		if (textarea) textarea.style.height = 'auto';
		textarea?.focus();
	}

	async function deleteSession(id: string, e: MouseEvent) {
		e.stopPropagation();
		await fetch(`/api/ai/chat/sessions?id=${id}`, { method: 'DELETE' });
		sessions = sessions.filter((s) => s.id !== id);
		if (sessionId === id) newConversation();
	}

	async function send() {
		const text = input.trim();
		if (!text || loading) return;

		input = '';
		if (textarea) textarea.style.height = 'auto';
		error = '';

		messages = [...messages, { role: 'user', content: text }];
		await scrollToBottom();

		loading = true;
		abortController = new AbortController();

		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: abortController.signal,
				body: JSON.stringify({
					userMessage: text,
					sessionId,
					providerId: selectedProviderId,
					clusterContext: cluster
						? {
								id: cluster.id,
								name: cluster.name,
								status: cluster.status,
								health: cluster.health,
								version: cluster.version,
								nodes: cluster.nodes,
								namespaces: cluster.namespaces,
								pods: cluster.pods,
								runningPods: cluster.runningPods,
								metricsAvailable: cluster.metricsAvailable
							}
						: undefined
				})
			});

			const data = await res.json();
			if (!res.ok || !data.success) throw new Error(data.error ?? 'Chat failed');

			// If a new session was created, update state + prepend to sessions list
			if (data.sessionId && data.sessionId !== sessionId) {
				sessionId = data.sessionId;
				const newSession: ChatSession = {
					id: data.sessionId,
					title: text.slice(0, 60),
					updatedAt: new Date().toISOString()
				};
				sessions = [newSession, ...sessions];
			} else if (sessionId) {
				// Bump the existing session to top of list
				const idx = sessions.findIndex((s) => s.id === sessionId);
				if (idx > 0) {
					const updated = { ...sessions[idx], updatedAt: new Date().toISOString() };
					sessions = [updated, ...sessions.filter((_, i) => i !== idx)];
				}
			}

			messages = [...messages, { role: 'assistant', content: data.message }];
			await scrollToBottom();
		} catch (err) {
			if ((err as Error).name === 'AbortError') return;
			error = err instanceof Error ? err.message : 'Request failed';
		} finally {
			loading = false;
			abortController = null;
			await tick();
			textarea?.focus();
		}
	}

	function stop() {
		abortController?.abort();
		loading = false;
		abortController = null;
	}

	function clearChat() {
		newConversation();
	}

	// ── Lifecycle ────────────────────────────────────────────────────
	$effect(() => {
		if (open) {
			loadProviders();
			loadSessions();
		}
	});
</script>

<!-- Backdrop -->
{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-black/20"
		onclick={() => { open = false; onClose?.(); }}
	></div>
{/if}

<!-- Panel -->
<div
	class={cn(
		'fixed top-0 right-0 z-50 flex h-full w-[380px] flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-in-out',
		open ? 'translate-x-0' : 'translate-x-full'
	)}
	onclick={(e) => { if (showHistory && !(e.target as HTMLElement).closest('.history-panel-inner')) showHistory = false; }}
>
	<!-- Header -->
	<div class="flex shrink-0 items-center justify-between border-b px-3 py-2.5">
		<div class="flex items-center gap-2.5">
			<div class="flex size-7 items-center justify-center rounded-full bg-violet-500/15">
				<Brain class="size-4 text-violet-400" />
			</div>
			<div class="leading-none">
				<p class="text-sm font-semibold">AI Assistant</p>
				{#if cluster}
					<p class="text-xs text-muted-foreground mt-0.5 font-mono">{cluster.name}</p>
				{/if}
			</div>
		</div>

		<div class="flex items-center gap-1">
			<!-- Provider selector -->
			{#if providers.length > 1}
				<Select.Root
					type="single"
					value={selectedProviderId?.toString()}
					onValueChange={(v: string) => { if (v) selectedProviderId = Number(v); }}
				>
					<Select.Trigger class="h-6 text-[11px] w-32 px-2">
						<span class="truncate">{selectedProviderLabel}</span>
					</Select.Trigger>
					<Select.Content>
						{#each providers as p (p.id)}
							<Select.Item value={p.id.toString()} class="text-xs">{p.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- History button -->
			{#if sessions.length > 0}
				<Button
					variant="ghost"
					size="icon"
					class="size-7 text-muted-foreground hover:text-foreground relative"
					title="Conversation history"
					onclick={(e) => { e.stopPropagation(); showHistory = !showHistory; }}
				>
					<History class="size-3.5" />
					<span class="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-violet-500 text-[8px] font-bold text-white leading-none">{sessions.length}</span>
				</Button>
			{/if}

			<Button
				variant="ghost"
				size="icon"
				class="size-7 text-muted-foreground hover:text-foreground"
				title="New conversation"
				onclick={newConversation}
			>
				<Plus class="size-3.5" />
			</Button>

			{#if loading}
				<Button
					variant="ghost"
					size="icon"
					class="size-7 text-red-400 hover:text-red-300"
					title="Stop"
					onclick={stop}
				>
					<Square class="size-3.5 fill-current" />
				</Button>
			{/if}

			<Button
				variant="ghost"
				size="icon"
				class="size-7 text-muted-foreground hover:text-foreground"
				onclick={() => { open = false; onClose?.(); }}
			>
				<X class="size-4" />
			</Button>
		</div>
	</div>

	<!-- History panel -->
	{#if showHistory && sessions.length > 0}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="history-panel-inner absolute inset-x-0 top-[49px] z-10 border-b bg-background shadow-lg"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between px-3 py-2 border-b">
				<span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversation History</span>
				<Button variant="ghost" size="icon" class="size-5" onclick={() => { showHistory = false; }}>
					<X class="size-3" />
				</Button>
			</div>
			<div class="max-h-64 overflow-y-auto py-1">
				{#each sessions as s (s.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="group flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors {s.id === sessionId ? 'bg-violet-500/10' : 'hover:bg-muted/60'}"
						onclick={() => { switchSession(s.id); showHistory = false; }}
						onkeydown={(e) => e.key === 'Enter' && (switchSession(s.id), showHistory = false)}
					>
						<div class="flex size-7 shrink-0 items-center justify-center rounded-full {s.id === sessionId ? 'bg-violet-500/20' : 'bg-muted'}">
							<MessageSquare class="size-3.5 {s.id === sessionId ? 'text-violet-400' : 'text-muted-foreground'}" />
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-medium {s.id === sessionId ? 'text-violet-300' : 'text-foreground'}">{s.title}</p>
							{#if s.updatedAt}
								<p class="text-[10px] text-muted-foreground/70 mt-0.5">{relativeTime(s.updatedAt)}</p>
							{/if}
						</div>
						<button
							class="hidden group-hover:flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-400/10 transition-colors"
							onclick={(e) => { e.stopPropagation(); deleteSession(s.id, e); }}
							title="Delete"
						>
							<Trash2 class="size-3" />
						</button>
					</div>
				{/each}
			</div>
			{#if sessions.length > 0}
				<div class="border-t px-3 py-2">
					<button
						class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
						onclick={() => { newConversation(); showHistory = false; }}
					>
						<Plus class="size-3.5" />
						New conversation
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Messages -->
	<div class="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
		{#if messages.length === 0 && !loading}
			<!-- Empty state -->
			<div class="flex flex-col items-center gap-3 py-12 text-center">
				<div class="flex size-12 items-center justify-center rounded-full bg-violet-500/10">
					<Brain class="size-6 text-violet-400" />
				</div>
				<div>
					<p class="text-sm font-medium">Ask about your cluster</p>
					<p class="text-xs text-muted-foreground mt-1 leading-relaxed">
						Get help diagnosing issues, understanding resources, or learning Kubernetes concepts.
					</p>
				</div>
				<!-- Suggestion chips -->
				{#if cluster}
					<div class="flex flex-wrap justify-center gap-1.5 mt-2">
						{#each [
							`Why are pods crashing?`,
							`Check node health`,
							`Explain CrashLoopBackOff`,
							`Best practices for ${cluster.name}`
						] as suggestion}
							<button
								class="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
								onclick={() => { input = suggestion; textarea?.focus(); }}
							>
								{suggestion}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#each messages as msg, i (i)}
			{#if msg.role === 'user'}
				<!-- User message -->
				<div class="flex gap-2 justify-end">
					<div class="max-w-[85%] rounded-2xl rounded-tr-sm bg-violet-600 px-3 py-2 text-sm text-white">
						{msg.content}
					</div>
					<div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
						<UserRound class="size-3.5 text-muted-foreground" />
					</div>
				</div>
			{:else}
				<!-- Assistant message -->
				<div class="flex gap-2">
					<div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 mt-0.5">
						<Bot class="size-3.5 text-violet-400" />
					</div>
					<div class="chat-markdown min-w-0 flex-1 text-sm leading-relaxed">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html renderMarkdown(msg.content)}
					</div>
				</div>
			{/if}
		{/each}

		{#if loading}
			<div class="flex gap-2">
				<div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 mt-0.5">
					<Loader2 class="size-3.5 text-violet-400 animate-spin" />
				</div>
				<div class="flex items-center gap-1 py-1">
					<span class="size-1.5 rounded-full bg-violet-400/60 animate-bounce [animation-delay:0ms]"></span>
					<span class="size-1.5 rounded-full bg-violet-400/60 animate-bounce [animation-delay:150ms]"></span>
					<span class="size-1.5 rounded-full bg-violet-400/60 animate-bounce [animation-delay:300ms]"></span>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
				<AlertCircle class="size-3.5 shrink-0 mt-0.5" />
				{error}
			</div>
		{/if}

		<!-- Scroll anchor -->
		<div bind:this={messagesEnd}></div>
	</div>

	<!-- Input -->
	<div class="shrink-0 border-t p-3">
		{#if providers.length === 0}
			<div class="rounded-lg border border-dashed p-3 text-center">
				<p class="text-xs text-muted-foreground">No AI providers configured.</p>
				<Button
					variant="link"
					size="sm"
					class="h-auto p-0 text-xs mt-1"
					onclick={() => { open = false; window.location.href = '/settings#ai'; }}
				>
					Configure in Settings →
				</Button>
			</div>
		{:else}
			<div class="flex items-end gap-2 rounded-xl border bg-muted/30 px-3 py-2 focus-within:border-violet-500/50 transition-colors">
				<textarea
					bind:this={textarea}
					bind:value={input}
					placeholder="Ask about your cluster…"
					rows="1"
					class="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[1.35rem] max-h-[140px] leading-5"
					oninput={resizeTextarea}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							send();
						}
					}}
					disabled={loading}
				></textarea>
				<Button
					size="icon"
					class="size-7 shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40"
					onclick={send}
					disabled={!input.trim() || loading || !selectedProviderId}
				>
					<Send class="size-3.5" />
				</Button>
			</div>
			<p class="mt-1.5 text-center text-[10px] text-muted-foreground/60">
				Enter to send · Shift+Enter for new line
			</p>
		{/if}
	</div>
</div>

<style>
	/* Markdown styles for assistant messages */
	:global(.chat-markdown p) {
		margin-bottom: 0.5rem;
	}
	:global(.chat-markdown p:last-child) {
		margin-bottom: 0;
	}
	:global(.chat-markdown h1, .chat-markdown h2, .chat-markdown h3) {
		font-weight: 600;
		margin-top: 0.75rem;
		margin-bottom: 0.25rem;
		line-height: 1.3;
	}
	:global(.chat-markdown h1) { font-size: 1rem; }
	:global(.chat-markdown h2) { font-size: 0.9375rem; }
	:global(.chat-markdown h3) { font-size: 0.875rem; }
	:global(.chat-markdown ul, .chat-markdown ol) {
		padding-left: 1.25rem;
		margin-bottom: 0.5rem;
	}
	:global(.chat-markdown ul) { list-style-type: disc; }
	:global(.chat-markdown ol) { list-style-type: decimal; }
	:global(.chat-markdown li) { margin-bottom: 0.2rem; }
	:global(.chat-markdown code:not(pre code)) {
		background: hsl(var(--muted));
		border: 1px solid hsl(var(--border));
		border-radius: 0.25rem;
		padding: 0.1em 0.35em;
		font-size: 0.8125em;
		font-family: ui-monospace, monospace;
	}
	:global(.chat-markdown pre) {
		background: hsl(var(--muted));
		border: 1px solid hsl(var(--border));
		border-radius: 0.5rem;
		padding: 0.75rem;
		overflow-x: auto;
		margin-bottom: 0.5rem;
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	:global(.chat-markdown pre code) {
		background: none;
		border: none;
		padding: 0;
		font-family: ui-monospace, monospace;
	}
	:global(.chat-markdown strong) { font-weight: 600; }
	:global(.chat-markdown a) {
		color: hsl(var(--primary));
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.chat-markdown blockquote) {
		border-left: 3px solid hsl(var(--border));
		padding-left: 0.75rem;
		color: hsl(var(--muted-foreground));
		margin-bottom: 0.5rem;
	}
	:global(.chat-markdown hr) {
		border-color: hsl(var(--border));
		margin: 0.75rem 0;
	}
</style>
