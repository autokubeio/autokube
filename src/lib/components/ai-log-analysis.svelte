<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import {
		Brain,
		Loader2,
		AlertCircle,
		X,
		Send,
		Bot,
		UserRound,
		Search,
		RefreshCw,
		FileText,
		WrapText,
		ArrowUp,
		ArrowDown
	} from 'lucide-svelte';
	import { marked } from 'marked';
	import { tick } from 'svelte';

	marked.setOptions({ gfm: true, breaks: true });

	// ── Types ────────────────────────────────────────────────────────
	interface AnalysisError {
		line: string;
		explanation: string;
		severity: 'critical' | 'error' | 'warning' | 'info';
	}

	interface AnalysisResult {
		summary: string;
		status: 'healthy' | 'warning' | 'error' | 'critical';
		errors: AnalysisError[];
		rootCause: string | null;
		suggestions: string[];
		nextSteps: string[];
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

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
	}

	type Props = {
		open?: boolean;
		clusterId: number;
		pod: { name: string; namespace: string } | null;
		logs: string;
		onClose?: () => void;
	};

	// ── Props ────────────────────────────────────────────────────────
	let { open = $bindable(false), clusterId, pod, logs, onClose }: Props = $props();

	// ── State ────────────────────────────────────────────────────────
	let providers = $state<SafeProvider[]>([]);
	let selectedProviderId = $state<number | null>(null);
	let messages = $state<ChatMessage[]>([]);
	let loading = $state(false);
	let error = $state('');
	let providerName = $state('');
	let logFilter = $state('');
	let wordWrap = $state(false);
	let searchIndex = $state(0);
	let leftPct = $state(70);
	let dragging = $state(false);
	let containerEl = $state<HTMLElement | null>(null);
	let logScrollEl = $state<HTMLElement | null>(null);
	let input = $state('');
	let messagesEnd = $state<HTMLElement | null>(null);
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let analyzed = $state(false);

	// ── Log parsing (mirrors pod-log-viewer) ────────────────────────
	type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'plain';
	type ParsedLine = { raw: string; level: LogLevel; ts: string; msg: string; lineNo: number };

	const ANSI_RE = /\x1B\[[0-9;]*[mGKHFJ]/g;
	const K8S_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) /;
	const LEVEL_RE =
		/\b(?:level|lvl|severity)\s*[=:"\']\s*"?([a-zA-Z]+)"?|^(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i;

	const LEVEL_CLASS: Record<LogLevel, string> = {
		error: 'text-red-400',
		warn: 'text-yellow-400',
		info: 'text-sky-400',
		debug: 'text-violet-400',
		trace: 'text-zinc-500',
		plain: 'text-zinc-300'
	};

	const LEVEL_LABEL: Record<LogLevel, string> = {
		error: 'ERR',
		warn: 'WRN',
		info: 'INF',
		debug: 'DBG',
		trace: 'TRC',
		plain: ''
	};

	const LEVEL_ROW_BG: Record<LogLevel, string> = {
		error: 'bg-red-500/5',
		warn: 'bg-yellow-500/5',
		info: '',
		debug: '',
		trace: '',
		plain: ''
	};

	function classifyLevel(raw: string): LogLevel {
		const l = raw.toLowerCase();
		if (l === 'error' || l === 'err' || l === 'fatal' || l === 'crit' || l === 'critical') return 'error';
		if (l === 'warn' || l === 'warning') return 'warn';
		if (l === 'info' || l === 'information') return 'info';
		if (l === 'debug') return 'debug';
		if (l === 'trace') return 'trace';
		return 'plain';
	}

	function formatIsoShort(iso: string): string {
		try {
			const d = new Date(iso);
			if (isNaN(d.getTime())) return iso;
			const month = d.toLocaleString('en-US', { month: 'short' });
			const day = String(d.getDate()).padStart(2, '0');
			const time = [
				String(d.getHours()).padStart(2, '0'),
				String(d.getMinutes()).padStart(2, '0'),
				String(d.getSeconds()).padStart(2, '0')
			].join(':');
			return `${month} ${day} ${time}`;
		} catch { return iso; }
	}

	function parseLine(raw: string, lineNo: number): ParsedLine {
		const clean = raw.replace(ANSI_RE, '');
		const tsMatch = K8S_TS_RE.exec(clean);
		const ts = tsMatch ? formatIsoShort(tsMatch[1]) : '';
		const body = tsMatch ? clean.slice(tsMatch[0].length) : clean;
		let level: LogLevel = 'plain';
		let msg = body;
		try {
			const json = JSON.parse(body);
			if (json && typeof json === 'object') {
				const lvlRaw: string = json.level ?? json.lvl ?? json.severity ?? json.LEVEL ?? json.Level ?? '';
				level = classifyLevel(lvlRaw);
				msg = json.msg ?? json.message ?? json.MESSAGE ?? body;
			}
		} catch {
			const m = LEVEL_RE.exec(body);
			if (m) level = classifyLevel(m[1] ?? m[2]);
		}
		return { raw: clean, level, ts, msg, lineNo };
	}

	function highlightSegments(text: string, query: string): Array<{ text: string; hl: boolean }> {
		if (!query) return [{ text, hl: false }];
		const lower = text.toLowerCase();
		const segments: Array<{ text: string; hl: boolean }> = [];
		let pos = 0;
		while (pos < text.length) {
			const idx = lower.indexOf(query, pos);
			if (idx === -1) { segments.push({ text: text.slice(pos), hl: false }); break; }
			if (idx > pos) segments.push({ text: text.slice(pos, idx), hl: false });
			segments.push({ text: text.slice(idx, idx + query.length), hl: true });
			pos = idx + query.length;
		}
		return segments;
	}

	// ── Derived ──────────────────────────────────────────────────────
	const allLines = $derived(
		logs
			.split('\n')
			.filter((l) => l.replace(ANSI_RE, '').trim().length > 0)
			.map((l, i) => parseLine(l, i + 1))
	);

	const searchLower = $derived(logFilter.trim().toLowerCase());

	const filteredLines = $derived(
		searchLower
			? allLines.filter((l) => l.msg.toLowerCase().includes(searchLower))
			: allLines
	);

	const matchingLineIndices = $derived.by(() => {
		if (!searchLower) return [] as number[];
		return filteredLines.map((_, i) => i);
	});

	const matchCount = $derived(matchingLineIndices.length);
	const activeMatchIdx = $derived(
		matchCount === 0 ? -1 : ((searchIndex % matchCount) + matchCount) % matchCount
	);

	const selectedProviderLabel = $derived(
		providers.find((p) => p.id === selectedProviderId)?.name ?? 'Select provider'
	);

	// ── Helpers ──────────────────────────────────────────────────────
	function stripAnsi(str: string): string {
		// eslint-disable-next-line no-control-regex
		return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
	}

	function searchNext() {
		if (matchCount === 0) return;
		searchIndex = (searchIndex + 1) % matchCount;
		scrollToMatch();
	}

	function searchPrev() {
		if (matchCount === 0) return;
		searchIndex = (searchIndex - 1 + matchCount) % matchCount;
		scrollToMatch();
	}

	function scrollToMatch() {
		if (activeMatchIdx < 0 || !logScrollEl) return;
		const row = logScrollEl.querySelector(`[data-line-idx="${activeMatchIdx}"]`);
		row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.shiftKey ? searchPrev() : searchNext(); e.preventDefault(); }
		if (e.key === 'Escape') { logFilter = ''; e.preventDefault(); }
	}

	function renderMarkdown(content: string): string {
		try {
			return marked.parse(content) as string;
		} catch {
			return content;
		}
	}

	function analysisToMarkdown(a: AnalysisResult): string {
		const statusIcon = { healthy: '✅', warning: '⚠️', error: '🔴', critical: '🚨' }[a.status] ?? '•';
		let md = `${statusIcon} **${a.summary}**\n`;

		if (a.errors.length > 0) {
			md += `\n**Issues Found (${a.errors.length})**\n`;
			for (const e of a.errors) {
				const sev = e.severity.toUpperCase();
				md += `- \`[${sev}]\` ${e.explanation}`;
				if (e.line) md += `\n  > \`${e.line.slice(0, 120)}\``;
				md += '\n';
			}
		}

		if (a.rootCause) {
			md += `\n**Root Cause**\n${a.rootCause}\n`;
		}

		if (a.suggestions.length > 0) {
			md += `\n**Suggestions**\n`;
			a.suggestions.forEach((s, i) => {
				md += `${i + 1}. ${s}\n`;
			});
		}

		if (a.nextSteps.length > 0) {
			md += `\n**Next Steps**\n`;
			a.nextSteps.forEach((s, i) => {
				md += `${i + 1}. ${s}\n`;
			});
		}

		return md.trim();
	}

	async function scrollToBottom() {
		await tick();
		messagesEnd?.scrollIntoView({ behavior: 'smooth' });
	}

	function resizeTextarea() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
	}

	// ── Draggable divider ─────────────────────────────────────────────
	function onDividerMouseDown(e: MouseEvent) {
		dragging = true;
		e.preventDefault();
	}

	$effect(() => {
		if (!dragging) return;

		function onMove(e: MouseEvent) {
			if (!containerEl) return;
			const rect = containerEl.getBoundingClientRect();
			const pct = ((e.clientX - rect.left) / rect.width) * 100;
			leftPct = Math.max(22, Math.min(72, pct));
		}

		function onUp() {
			dragging = false;
		}

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);

		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	});

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
			// silently fail
		}
	}

	async function analyze() {
		if (!pod || !allLines.length) return;
		analyzed = true;
		const podLabel = pod.name;
		messages = [{ role: 'user', content: `Analyze the logs for **${podLabel}** in \`${pod.namespace}\`` }];
		await scrollToBottom();
		loading = true;
		error = '';

		try {
			const res = await fetch('/api/ai/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					providerId: selectedProviderId,
					logs: allLines.map((l) => l.raw).join('\n'),
					podName: pod.name,
					namespace: pod.namespace,
					clusterId
				})
			});
			const data = await res.json();
			if (!res.ok || !data.success) throw new Error(data.error ?? 'Analysis failed');
			const markdown = analysisToMarkdown(data.analysis as AnalysisResult);
			messages = [...messages, { role: 'assistant', content: markdown }];
			providerName = data.providerName ?? '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Analysis failed';
		} finally {
			loading = false;
			await scrollToBottom();
		}
	}

	async function sendQuestion() {
		const text = input.trim();
		if (!text || loading) return;
		input = '';
		if (textarea) textarea.style.height = 'auto';
		error = '';
		messages = [...messages, { role: 'user', content: text }];
		await scrollToBottom();
		loading = true;

		try {
			const res = await fetch('/api/ai/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					providerId: selectedProviderId,
					logs: allLines.map((l) => l.raw).join('\n'),
					podName: pod?.name,
					namespace: pod?.namespace,
					clusterId,
					question: text
				})
			});
			const data = await res.json();
			if (!res.ok || !data.success) throw new Error(data.error ?? 'Request failed');
			messages = [...messages, { role: 'assistant', content: data.answer }];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Request failed';
		} finally {
			loading = false;
			await scrollToBottom();
			await tick();
			textarea?.focus();
		}
	}

	// ── Lifecycle ────────────────────────────────────────────────────
	$effect(() => {
		if (open) {
			messages = [];
			analyzed = false;
			error = '';
			logFilter = '';
			searchIndex = 0;
			providerName = '';
			loadProviders();
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="max-w-[96vw] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden [&>button]:hidden"
	>
		<!-- Header -->
		<div class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
			<div class="flex items-center gap-2.5">
				<div class="flex size-8 items-center justify-center rounded-full bg-violet-500/15">
					<Brain class="size-4 text-violet-400" />
				</div>
				<div class="leading-none">
					<h2 class="text-sm font-semibold">AI Log Analysis</h2>
					{#if pod}
						<p class="mt-0.5 text-xs text-muted-foreground">
							<span class="font-mono">{pod.name}</span>
							<span class="mx-1 opacity-40">·</span>
							<span class="font-mono">{pod.namespace}</span>
						</p>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2">
				{#if providers.length > 1}
					<Select.Root
						type="single"
						value={selectedProviderId?.toString()}
						onValueChange={(v: string) => {
							if (v) selectedProviderId = Number(v);
						}}
					>
						<Select.Trigger class="h-7 w-44 text-xs">
							<span class="truncate">{selectedProviderLabel}</span>
						</Select.Trigger>
						<Select.Content>
							{#each providers as p (p.id)}
								<Select.Item value={p.id.toString()} class="text-xs">{p.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}

				{#if analyzed && !loading}
					<Button
						variant="outline"
						size="sm"
						class="h-7 gap-1.5 text-xs"
						onclick={analyze}
					>
						<RefreshCw class="size-3" />
						Re-analyze
					</Button>
				{/if}

				<Button
					variant="ghost"
					size="icon"
					class="size-7"
					onclick={() => {
						open = false;
						onClose?.();
					}}
				>
					<X class="size-4" />
				</Button>
			</div>
		</div>

		<!-- Body: draggable two-panel layout -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={containerEl}
			class={cn('flex flex-1 min-h-0', dragging && 'select-none cursor-col-resize')}
		>
			<!-- ── Left: Log Viewer ── -->
			<div style="width: {leftPct}%" class="flex min-h-0 flex-col border-r bg-zinc-950">
				<!-- Toolbar -->
				<div class="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/60 bg-zinc-900/80 px-3 py-1">
					<Search class="size-3 shrink-0 text-zinc-500" />
					<input
						type="text"
						bind:value={logFilter}
						onkeydown={onSearchKeydown}
						placeholder="Search logs…"
						class="h-5 flex-1 bg-transparent font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
					/>
					{#if logFilter}
						<span class="shrink-0 font-mono text-[10px] text-zinc-500">
							{matchCount === 0 ? 'No results' : `${activeMatchIdx + 1} / ${matchCount}`}
						</span>
						<button class="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800" onclick={searchPrev} disabled={matchCount === 0}>
							<ArrowUp class="size-3" />
						</button>
						<button class="flex size-5 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800" onclick={searchNext} disabled={matchCount === 0}>
							<ArrowDown class="size-3" />
						</button>
						<button class="flex size-5 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800" onclick={() => (logFilter = '')}>
							<X class="size-3" />
						</button>
					{:else}
						<span class="font-mono text-[10px] text-zinc-600 tabular-nums">{allLines.length} lines</span>
					{/if}
					<!-- Word wrap toggle -->
					<button
						class={cn('flex size-5 items-center justify-center rounded transition-colors', wordWrap ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300')}
						title={wordWrap ? 'Word wrap on' : 'Word wrap off'}
						onclick={() => (wordWrap = !wordWrap)}
					>
						<WrapText class="size-3" />
					</button>
				</div>

				<!-- Log lines -->
				<div
					bind:this={logScrollEl}
					class={cn('min-h-0 flex-1 py-1 font-mono', wordWrap ? 'overflow-x-hidden overflow-y-auto' : 'overflow-auto')}
					style="font-size: 11.5px; line-height: 1.55;"
				>
					{#each filteredLines as line, i (line.lineNo)}
						{@const isActiveMatch = i === activeMatchIdx}
						{@const isMatch = searchLower && line.msg.toLowerCase().includes(searchLower)}
						<div
							data-line-idx={i}
							class={cn(
								'flex items-baseline gap-2 rounded px-1 py-px leading-snug',
								wordWrap ? 'min-w-0' : 'w-max min-w-full',
								LEVEL_ROW_BG[line.level],
								isActiveMatch && 'bg-sky-500/15 ring-1 ring-sky-500/40',
								isMatch && !isActiveMatch && 'bg-sky-500/5'
							)}
						>
							<!-- Line number -->
							<span class="w-[3.2ch] shrink-0 select-none text-right text-zinc-700">{line.lineNo}</span>
							<!-- Timestamp -->
							{#if line.ts}
								<span class="shrink-0 text-zinc-600">{line.ts}</span>
							{/if}
							<!-- Level badge -->
							{#if line.level !== 'plain'}
								<span class={cn('w-[3ch] shrink-0 select-none text-center text-[10px] font-bold', LEVEL_CLASS[line.level])}>
									{LEVEL_LABEL[line.level]}
								</span>
							{/if}
							<!-- Message -->
							<span class={cn(
								'min-w-0 flex-1',
								wordWrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
								LEVEL_CLASS[line.level]
							)}>
								{#if searchLower && isMatch}
									{#each highlightSegments(line.msg, searchLower) as seg}
										{#if seg.hl}<mark class="rounded-sm bg-yellow-400/30 px-px text-yellow-200">{seg.text}</mark>{:else}{seg.text}{/if}
									{/each}
								{:else}
									{line.msg}
								{/if}
							</span>
						</div>
					{/each}
					{#if filteredLines.length === 0}
						<div class="py-8 text-center text-xs text-zinc-600">
							{logFilter ? 'No matching log lines' : 'No logs to display'}
						</div>
					{/if}
				</div>
				<!-- Status bar -->
				<div class="flex shrink-0 items-center justify-between border-t border-zinc-800/60 bg-zinc-900/50 px-3 py-0.5">
					<span class="font-mono text-[10px] text-zinc-600">
						{allLines.length} line{allLines.length === 1 ? '' : 's'}
						{#if searchLower && matchCount > 0}
							<span class="text-sky-400/80"> · {matchCount} match{matchCount === 1 ? '' : 'es'}</span>
						{/if}
					</span>
					<span class="font-mono text-[10px] text-zinc-700">{pod?.name ?? ''}</span>
				</div>
			</div>

			<!-- ── Draggable Divider ── -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class={cn(
					'group relative w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-violet-500/40',
					dragging && 'bg-violet-500/60'
				)}
				onmousedown={onDividerMouseDown}
			>
				<div class="absolute inset-x-0 inset-y-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
					<div class="h-10 w-0.5 rounded-full bg-violet-400/70"></div>
				</div>
			</div>

			<!-- ── Right: Chat Panel ── -->
			<div class="flex min-h-0 flex-1 flex-col">
				<!-- Chat sub-header -->
				<div class="flex shrink-0 items-center justify-between border-b bg-background px-3 py-1.5">
					<div class="flex items-center gap-1.5">
						<FileText class="size-3.5 text-muted-foreground" />
						<span class="text-xs text-muted-foreground">Log Analysis</span>
					</div>
					{#if providerName}
						<span class="font-mono text-[10px] text-violet-400">{providerName}</span>
					{/if}
				</div>

				<!-- Messages -->
				<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
					<!-- Empty state -->
					{#if messages.length === 0 && !loading}
					<div class="flex flex-col items-center gap-4 py-12 text-center">
						<div class="flex size-12 items-center justify-center rounded-full bg-violet-500/10">
							<Brain class="size-6 text-violet-400" />
						</div>
						{#if providers.length === 0}
							<div>
								<p class="text-sm font-medium">No AI provider configured</p>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									Add a provider in Settings → AI Assistant to enable log analysis.
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								onclick={() => { open = false; window.location.href = '/settings#ai'; }}
							>
								Configure AI Provider
							</Button>
						{:else}
							<div>
								<p class="text-sm font-medium">Analyze pod logs with AI</p>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									Click the suggestion below to start, or ask any question.
								</p>
							</div>
							{#if pod}
								<button
									class="rounded-full border border-border bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-foreground transition-colors cursor-pointer font-mono"
									onclick={analyze}
								>
									Analyze the logs for {pod.name} in {pod.namespace}
								</button>
							{/if}
						{/if}
					</div>
					{/if}

					<!-- Message list -->
					{#each messages as msg, i (i)}
						{#if msg.role === 'user'}
							<!-- User bubble -->
							<div class="flex justify-end gap-2">
								<div class="max-w-[85%] rounded-2xl rounded-tr-sm bg-violet-600 px-3 py-2 text-sm text-white">
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html renderMarkdown(msg.content)}
								</div>
								<div class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
									<UserRound class="size-3.5 text-muted-foreground" />
								</div>
							</div>
						{:else}
							<!-- Assistant bubble -->
							<div class="flex gap-2">
								<div class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
									<Bot class="size-3.5 text-violet-400" />
								</div>
								<div class="chat-markdown min-w-0 flex-1 text-sm leading-relaxed">
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html renderMarkdown(msg.content)}
								</div>
							</div>
						{/if}
					{/each}

					<!-- Loading indicator -->
					{#if loading}
						<div class="flex gap-2">
							<div class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
								<Loader2 class="size-3.5 animate-spin text-violet-400" />
							</div>
							<div class="flex items-center gap-1 py-1">
								<span class="size-1.5 animate-bounce rounded-full bg-violet-400/60 [animation-delay:0ms]"></span>
								<span class="size-1.5 animate-bounce rounded-full bg-violet-400/60 [animation-delay:150ms]"></span>
								<span class="size-1.5 animate-bounce rounded-full bg-violet-400/60 [animation-delay:300ms]"></span>
							</div>
						</div>
					{/if}

					<!-- Error -->
					{#if error}
						<div class="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
							<AlertCircle class="mt-0.5 size-3.5 shrink-0" />
							{error}
						</div>
					{/if}

					<div bind:this={messagesEnd}></div>
				</div>

				<!-- Input area -->
				<div class="shrink-0 border-t p-3">
					{#if providers.length === 0}
						<div class="rounded-lg border border-dashed p-3 text-center">
							<p class="text-xs text-muted-foreground">No AI providers configured.</p>
							<Button
								variant="link"
								size="sm"
								class="mt-1 h-auto p-0 text-xs"
								onclick={() => {
									open = false;
									window.location.href = '/settings#ai';
								}}
							>
								Configure in Settings →
							</Button>
						</div>
					{:else}
						<div
							class="flex items-end gap-2 rounded-xl border bg-muted/30 px-3 py-2 transition-colors focus-within:border-violet-500/50"
						>
							<textarea
								bind:this={textarea}
								bind:value={input}
								placeholder={analyzed
									? 'Ask a follow-up question about these logs…'
									: 'Click the suggestion above to start analysis…'}
								rows="1"
								class="max-h-[120px] min-h-[1.35rem] flex-1 resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-muted-foreground"
								oninput={resizeTextarea}
								onkeydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										sendQuestion();
									}
								}}
								disabled={loading || !analyzed}
							></textarea>
							<Button
								size="icon"
								class="size-7 shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40"
								onclick={sendQuestion}
								disabled={!input.trim() || loading || !selectedProviderId || !analyzed}
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
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	/* Markdown styles for assistant messages */
	:global(.chat-markdown p) { margin-bottom: 0.5rem; }
	:global(.chat-markdown p:last-child) { margin-bottom: 0; }
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
