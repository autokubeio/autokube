<!--
  Pod Log Viewer — bottom drawer with live SSE log streaming.

  Features
  ─────────
  • Slide-up panel from the bottom (swipe/drag-handle to resize)
  • Live streaming via Server-Sent Events (EventSource)
  • Pause / Resume (buffers lines while paused)
  • Stop / Restart stream
  • Container selector for multi-container pods
  • Smart auto-scroll (pauses when user scrolls up, resumes at bottom)
  • Copy / Download logs
  • ANSI-stripped, log-level-colourised output

  Usage
  ─────
  <PodLogViewer
    bind:open
    clusterId={activeCluster.id}
    pod={selectedPod}
    onClose={() => (selectedPod = null)}
  />
-->

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Badge } from '$lib/components/ui/badge';
	import {
		X,
		Play,
		Pause,
		RotateCcw,
		Trash2,
		Download,
		AlignEndHorizontal,
		GripHorizontal,
		ScrollText,
		Copy,
		CheckCheck,
		AlertCircle,
		ChevronDown,
		Search,
		WrapText,
		ChevronUp,
		ArrowUp,
		ArrowDown,
		Brain,
		History
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import AiLogAnalysis from '$lib/components/ai-log-analysis.svelte';

	// ── Types ─────────────────────────────────────────────────────────────────

	export type LogPod = {
		name: string;
		namespace: string;
		containers: Array<{ name: string; image: string; ready: boolean; state: string }>;
	};

	type Props = {
		open?: boolean;
		clusterId: number;
		pod: LogPod | null;
		onClose?: () => void;
	};

	// ── Props ─────────────────────────────────────────────────────────────────

	let { open = $bindable(false), clusterId, pod, onClose }: Props = $props();

	// ── Extra state
	let showAiAnalysis = $state(false);
	let showPrevious = $state(false);

	// ── State ─────────────────────────────────────────────────────────────────

	type LogLine = { raw: string; level: LogLevel; ts: string; msg: string };
	type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'plain';
	type StreamState = 'idle' | 'streaming' | 'paused' | 'done' | 'error';

	let logLines = $state<LogLine[]>([]);
	let streamState = $state<StreamState>('idle');
	let streamError = $state('');
	let selectedContainer = $state('');
	let autoScroll = $state(true);
	let copied = $state(false);
	let wordWrap = $state(true);

	// Search
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let searchIndex = $state(0); // current active match (0-based)
	let searchInputEl = $state<HTMLInputElement | null>(null);

	// Panel dimensions
	const MIN_HEIGHT = 220;
	const MAX_HEIGHT_RATIO = 0.82;
	let panelHeight = $state(360);
	let isDragging = $state(false);

	// Refs
	let logEl = $state<HTMLElement | null>(null);
	let panelEl = $state<HTMLElement | null>(null);

	// Stream internals
	let es: EventSource | null = null;
	let pendingLines = $state<LogLine[]>([]);
	let ticking = false;

	// ── Derived ───────────────────────────────────────────────────────────────

	const containers = $derived(pod?.containers ?? []);
	const liveCount = $derived(logLines.length);
	const isOpen = $derived(open && pod !== null);

	// Search matches: array of { lineIdx, segments } for lines that match
	const searchLower = $derived(searchQuery.trim().toLowerCase());

	// Build a flat list of matching line indices
	const matchingLineIndices = $derived.by(() => {
		if (!searchLower) return [] as number[];
		const indices: number[] = [];
		for (let i = 0; i < logLines.length; i++) {
			if (logLines[i].msg.toLowerCase().includes(searchLower)) indices.push(i);
		}
		return indices;
	});

	const matchCount = $derived(matchingLineIndices.length);

	// Clamp active index
	const activeMatchIdx = $derived(
		matchCount === 0 ? -1 : ((searchIndex % matchCount) + matchCount) % matchCount
	);
	const activeLineIdx = $derived(
		activeMatchIdx >= 0 ? matchingLineIndices[activeMatchIdx] : -1
	);

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	$effect(() => {
		// Reset container selector and previous-logs mode when pod changes
		if (pod) {
			untrack(() => {
				selectedContainer = pod!.containers[0]?.name ?? '';
				showPrevious = false;
			});
		}
	});

	$effect(() => {
		if (isOpen) {
			untrack(() => startStream());
		} else {
			untrack(() => teardown(false));
		}
	});

	onDestroy(teardown);

	// ── Log Parsing ───────────────────────────────────────────────────────────

	const ANSI_RE = /\x1B\[[0-9;]*[mGKHFJ]/g;
	const K8S_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) /;

	// Common pattern: level=error  or "level":"error"  or LEVEL:
	const LEVEL_RE =
		/\b(?:level|lvl|severity)\s*[=:"]\s*"?([a-zA-Z]+)"?|^(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i;

	function parseLine(raw: string): LogLine {
		const clean = raw.replace(ANSI_RE, '');

		// Strip k8s timestamp prefix
		const tsMatch = K8S_TS_RE.exec(clean);
		const ts = tsMatch ? formatIsoShort(tsMatch[1]) : '';
		const body = tsMatch ? clean.slice(tsMatch[0].length) : clean;

		// Attempt JSON parse for structured logs
		let level: LogLevel = 'plain';
		let msg = body;

		try {
			const json = JSON.parse(body);
			if (json && typeof json === 'object') {
				const lvlRaw: string =
					json.level ?? json.lvl ?? json.severity ?? json.LEVEL ?? json.Level ?? '';
				level = classifyLevel(lvlRaw);
				msg = json.msg ?? json.message ?? json.MESSAGE ?? body;
			}
		} catch {
			// Plain text — detect level from text patterns
			const m = LEVEL_RE.exec(body);
			if (m) level = classifyLevel(m[1] ?? m[2]);
		}

		return { raw: clean, level, ts, msg };
	}

	function classifyLevel(raw: string): LogLevel {
		const l = raw.toLowerCase();
		if (l === 'error' || l === 'err' || l === 'fatal' || l === 'crit' || l === 'critical')
			return 'error';
		if (l === 'warn' || l === 'warning') return 'warn';
		if (l === 'info' || l === 'information') return 'info';
		if (l === 'debug') return 'debug';
		if (l === 'trace') return 'trace';
		return 'plain';
	}

	function formatIsoShort(iso: string): string {
		// 2026-03-06T17:22:49.290460162Z → Mar 06 17:22:49
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
		} catch {
			return iso;
		}
	}

	// ── Streaming ──────────────────────────────────────────────────────────────

	function startStream() {
		teardown(false);
		logLines = [];
		pendingLines = [];
		streamError = '';
		streamState = 'streaming';

		if (!pod || !clusterId) return;

		const qs = new URLSearchParams({
			namespace: pod.namespace,
			pod: pod.name,
			tailLines: '500'
		});
		if (selectedContainer) qs.set('container', selectedContainer);
		if (showPrevious) qs.set('previous', 'true');

		es = new EventSource(`/api/clusters/${clusterId}/pods/logs?${qs}`);

		es.onmessage = (e: MessageEvent) => {
			let raw: string;
			try {
				raw = JSON.parse(e.data);
			} catch {
				raw = e.data;
			}
			const line = parseLine(raw);
			if (!line.raw.trim()) return;

			if (streamState === 'paused') {
				pendingLines.push(line);
				return;
			}
			appendLines([line]);
		};

		es.addEventListener('done', () => {
			streamState = 'done';
			closeEs();
		});

		// Named SSE error events (sent by the server as `event: error\ndata: ...`)
		es.addEventListener('error', (e: Event) => {
			// Only handle MessageEvents — those are named SSE error payloads from the server.
			// Plain Event instances are native connection errors handled by onerror below.
			if (!(e instanceof MessageEvent)) return;
			try {
				streamError = JSON.parse(e.data) ?? 'Stream error';
			} catch {
				streamError = e.data ?? 'Stream error';
			}
			streamState = 'error';
			closeEs();
		});

		// Native connection errors (non-2xx, network drop, etc.)
		es.onerror = (e: Event) => {
			// Ignore if we already handled it via the named-error listener
			if (streamState !== 'streaming' && streamState !== 'paused') return;
			streamState = 'error';
			streamError = 'Connection failed — check cluster connectivity or browser console';
			closeEs();
		};
	}

	function closeEs() {
		if (es) {
			es.close();
			es = null;
		}
	}

	function teardown(resetLines = true) {
		closeEs();
		pendingLines = [];
		if (resetLines) {
			logLines = [];
			streamError = '';
			streamState = 'idle';
		} else if (streamState === 'streaming') {
			streamState = 'idle';
		}
	}

	// Batch DOM updates with rAF to avoid thrashing
	function appendLines(lines: LogLine[]) {
		logLines = [...logLines, ...lines].slice(-5000); // keep last 5 000 lines
		if (autoScroll && !ticking) {
			ticking = true;
			requestAnimationFrame(() => {
				ticking = false;
				scrollToBottom();
			});
		}
	}

	function scrollToBottom() {
		if (logEl) logEl.scrollTop = logEl.scrollHeight;
	}

	// ── Controls ──────────────────────────────────────────────────────────────

	function togglePause() {
		if (streamState === 'paused') {
			streamState = 'streaming';
			if (pendingLines.length) {
				appendLines(pendingLines);
				pendingLines = [];
			}
		} else if (streamState === 'streaming') {
			streamState = 'paused';
		}
	}

	function restart() {
		if (streamState === 'streaming' || streamState === 'paused') {
			teardown(false);
		}
		startStream();
	}

	function clearLogs() {
		logLines = [];
		pendingLines = [];
	}

	async function copyLogs() {
		const text = logLines.map((l) => l.raw).join('\n');
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1800);
		toast.success('Logs copied to clipboard');
	}

	function downloadLogs() {
		if (!pod) return;
		const text = logLines.map((l) => l.raw).join('\n');
		const blob = new Blob([text], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${pod.name}-${selectedContainer || 'logs'}.log`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function handleClose() {
		open = false;
		searchOpen = false;
		searchQuery = '';
		onClose?.();
	}

	// ── Search controls ──────────────────────────────────────────────────────

	function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) {
			requestAnimationFrame(() => searchInputEl?.focus());
		} else {
			searchQuery = '';
			searchIndex = 0;
		}
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
		if (activeLineIdx < 0 || !logEl) return;
		const row = logEl.querySelector(`[data-line-idx="${activeLineIdx}"]`);
		if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (e.shiftKey) searchPrev();
			else searchNext();
			e.preventDefault();
		}
		if (e.key === 'Escape') {
			toggleSearch();
			e.preventDefault();
		}
	}

	/**
	 * Split text into segments for highlighted rendering.
	 * Returns array of { text, highlight } objects.
	 */
	function highlightSegments(text: string, query: string): Array<{ text: string; hl: boolean }> {
		if (!query) return [{ text, hl: false }];
		const lower = text.toLowerCase();
		const segments: Array<{ text: string; hl: boolean }> = [];
		let pos = 0;
		while (pos < text.length) {
			const idx = lower.indexOf(query, pos);
			if (idx === -1) {
				segments.push({ text: text.slice(pos), hl: false });
				break;
			}
			if (idx > pos) segments.push({ text: text.slice(pos, idx), hl: false });
			segments.push({ text: text.slice(idx, idx + query.length), hl: true });
			pos = idx + query.length;
		}
		return segments;
	}

	function changeContainer(name: string) {
		selectedContainer = name;
		if (streamState === 'streaming' || streamState === 'paused') {
			startStream();
		}
	}

	function togglePrevious() {
		showPrevious = !showPrevious;
		startStream();
	}

	// ── Auto-scroll detection ─────────────────────────────────────────────────

	function onScroll() {
		if (!logEl) return;
		const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
		autoScroll = nearBottom;
	}

	// ── Drag-to-resize ────────────────────────────────────────────────────────

	function onHandlePointerDown(e: PointerEvent) {
		isDragging = true;
		const startY = e.clientY;
		const startH = panelHeight;

		function onMove(me: PointerEvent) {
			const delta = startY - me.clientY;
			const maxH = Math.floor(window.innerHeight * MAX_HEIGHT_RATIO);
			panelHeight = Math.max(MIN_HEIGHT, Math.min(maxH, startH + delta));
		}

		function onUp() {
			isDragging = true; // briefly keep for cursor
			requestAnimationFrame(() => (isDragging = false));
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
		}

		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
	}

	// ── Level colours ─────────────────────────────────────────────────────────

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
</script>

<!-- ── Overlay backdrop (subtle) ───────────────────────────────────────────── -->
{#if isOpen}
	<div
		class="fixed inset-0 z-40 pointer-events-none"
		style="background: linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.25) 100%)"
	></div>
{/if}

<!-- ── Panel ──────────────────────────────────────────────────────────────── -->
<div
	bind:this={panelEl}
	class={cn(
		'fixed bottom-0 left-0 right-0 z-50 flex flex-col',
		'border-t border-zinc-700/60 bg-zinc-950 shadow-2xl shadow-black/60',
		'transition-transform duration-300 ease-out',
		isOpen ? 'translate-y-0' : 'translate-y-full'
	)}
	style="height: {panelHeight}px"
>
	<!-- ── Drag handle ──────────────────────────────────────────────────── -->
	<div
		class={cn(
			'flex h-5 shrink-0 cursor-ns-resize items-center justify-center',
			'border-b border-zinc-700/40 bg-zinc-900/80 hover:bg-zinc-800/80',
			isDragging && 'bg-zinc-800/80'
		)}
		onpointerdown={onHandlePointerDown}
		role="separator"
		aria-orientation="horizontal"
		aria-label="Drag to resize log panel"
	>
		<GripHorizontal class="size-3.5 text-zinc-500" />
	</div>

	<!-- ── Header ──────────────────────────────────────────────────────── -->
	<div
		class="flex shrink-0 items-center gap-2 border-b border-zinc-700/40 bg-zinc-900/60 px-3 py-1.5"
	>
		<!-- Icon + pod name -->
		<ScrollText class="size-3.5 shrink-0 text-zinc-400" />
		<span class="max-w-[180px] truncate font-mono text-xs font-semibold text-zinc-200">
			{pod?.name ?? ''}
		</span>
		<Badge
			variant="outline"
			class="h-4 shrink-0 border-zinc-600 px-1 py-0 font-mono text-[10px] text-zinc-400"
		>
			{pod?.namespace ?? ''}
		</Badge>

		<!-- Container selector (only show if multiple containers) -->
		{#if containers.length > 1}
			<Select.Root
				type="single"
				value={selectedContainer}
				onValueChange={(v: string) => { if (v) changeContainer(v); }}
			>
				<Select.Trigger
					size="sm"
					class="h-6! min-w-25 max-w-40 rounded-sm! border-zinc-700! bg-zinc-800! px-2! py-0! text-[11px]! text-zinc-300! shadow-none! hover:bg-zinc-700!"
				>
					{selectedContainer || 'container'}
				</Select.Trigger>
				<Select.Content class="border-zinc-700! bg-zinc-900! text-zinc-300!">
					{#each containers as c}
						<Select.Item
							value={c.name}
							class="text-xs! text-zinc-300! data-highlighted:bg-zinc-800! data-highlighted:text-zinc-100!"
						>
							{c.name}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{:else if containers.length === 1}
			<span class="font-mono text-[11px] text-zinc-500">{selectedContainer}</span>
		{/if}

		<div class="flex-1"></div>

		<!-- Stream state badge -->
		<span
			class={cn(
				'flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px]',
				streamState === 'streaming' && 'bg-emerald-500/10 text-emerald-400',
				streamState === 'paused' && 'bg-yellow-500/10 text-yellow-400',
				streamState === 'done' && 'bg-zinc-500/10 text-zinc-400',
				streamState === 'error' && 'bg-red-500/10 text-red-400',
				streamState === 'idle' && 'bg-zinc-500/10 text-zinc-500'
			)}
		>
			<span
				class={cn(
					'size-1.5 rounded-full',
					streamState === 'streaming' && 'animate-pulse bg-emerald-400',
					streamState === 'paused' && 'bg-yellow-400',
					streamState === 'done' && 'bg-zinc-400',
					streamState === 'error' && 'bg-red-400',
					streamState === 'idle' && 'bg-zinc-600'
				)}
			></span>
			{streamState === 'streaming'
				? 'Live'
				: streamState === 'paused'
					? 'Paused'
					: streamState === 'done'
						? 'Done'
						: streamState === 'error'
							? 'Error'
							: 'Idle'}
		</span>

		<!-- Controls -->
		<div class="flex items-center gap-0.5">
			<!-- Previous logs toggle -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class={cn('h-6 w-6 hover:bg-zinc-800', showPrevious ? 'text-amber-400' : 'text-zinc-400')}
						onclick={togglePrevious}
					>
						<History class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>{showPrevious ? 'Showing previous container logs' : 'Show previous container logs'}</Tooltip.Content>
			</Tooltip.Root>

			<!-- Search toggle -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class={cn('h-6 w-6 hover:bg-zinc-800', searchOpen ? 'text-sky-400' : 'text-zinc-400')}
						onclick={toggleSearch}
					>
						<Search class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Search logs</Tooltip.Content>
			</Tooltip.Root>

			<!-- Wrap toggle -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class={cn('h-6 w-6 hover:bg-zinc-800', wordWrap ? 'text-emerald-400' : 'text-zinc-500')}
						onclick={() => (wordWrap = !wordWrap)}
					>
						<WrapText class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>{wordWrap ? 'Word wrap on' : 'Word wrap off'}</Tooltip.Content>
			</Tooltip.Root>

			<!-- Pause / Resume -->
			{#if streamState === 'streaming' || streamState === 'paused'}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<Button
							variant="ghost"
							size="icon"
							class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
							onclick={togglePause}
						>
							{#if streamState === 'paused'}
								<Play class="size-3.5" />
							{:else}
								<Pause class="size-3.5" />
							{/if}
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{streamState === 'paused' ? 'Resume stream' : 'Pause stream'}
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			<!-- Restart -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={restart}
					>
						<RotateCcw class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Restart stream</Tooltip.Content>
			</Tooltip.Root>

			<!-- Auto-scroll indicator / toggle -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class={cn(
							'h-6 w-6 hover:bg-zinc-800',
							autoScroll ? 'text-emerald-400' : 'text-zinc-500'
						)}
						onclick={() => {
							autoScroll = !autoScroll;
							if (autoScroll) scrollToBottom();
						}}
					>
						<ChevronDown class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</Tooltip.Content>
			</Tooltip.Root>

			<!-- Clear -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={clearLogs}
					>
						<Trash2 class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Clear logs</Tooltip.Content>
			</Tooltip.Root>

			<!-- Copy -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={copyLogs}
						disabled={liveCount === 0}
					>
						{#if copied}
							<CheckCheck class="size-3.5 text-emerald-400" />
						{:else}
							<Copy class="size-3.5" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Copy all logs</Tooltip.Content>
			</Tooltip.Root>

			<!-- Download -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={downloadLogs}
						disabled={liveCount === 0}
					>
						<Download class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Download logs</Tooltip.Content>
			</Tooltip.Root>

			<!-- Analyze with AI -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-violet-400 hover:bg-zinc-800 hover:text-violet-300"
						onclick={() => (showAiAnalysis = true)}
						disabled={liveCount === 0}
					>
						<Brain class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Analyze with AI</Tooltip.Content>
			</Tooltip.Root>

			<!-- Close -->
			<Button
				variant="ghost"
				size="icon"
				class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
				onclick={handleClose}
			>
				<X class="size-3.5" />
			</Button>
		</div>
	</div>

	<!-- ── Search bar ──────────────────────────────────────────────────────── -->
	{#if searchOpen}
		<div class="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/60 bg-zinc-900/80 px-3 py-1">
			<Search class="size-3 shrink-0 text-zinc-500" />
			<input
				bind:this={searchInputEl}
				bind:value={searchQuery}
				onkeydown={onSearchKeydown}
				type="text"
				placeholder="Search logs…"
				class="h-5 flex-1 border-none bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
			/>
			{#if searchQuery}
				<span class="shrink-0 font-mono text-[10px] text-zinc-500">
					{matchCount === 0 ? 'No results' : `${activeMatchIdx + 1} / ${matchCount}`}
				</span>
				<Button variant="ghost" size="icon" class="h-5 w-5 text-zinc-400 hover:bg-zinc-800" onclick={searchPrev} disabled={matchCount === 0}>
					<ArrowUp class="size-3" />
				</Button>
				<Button variant="ghost" size="icon" class="h-5 w-5 text-zinc-400 hover:bg-zinc-800" onclick={searchNext} disabled={matchCount === 0}>
					<ArrowDown class="size-3" />
				</Button>
			{/if}
			<Button variant="ghost" size="icon" class="h-5 w-5 text-zinc-500 hover:bg-zinc-800" onclick={toggleSearch}>
				<X class="size-3" />
			</Button>
		</div>
	{/if}

	<!-- ── Log content ─────────────────────────────────────────────────────── -->
	<div
		bind:this={logEl}
		onscroll={onScroll}
		class={cn(
			'flex-1 overflow-y-auto bg-zinc-950 px-1 py-1 font-mono',
			wordWrap ? 'overflow-x-hidden' : 'overflow-x-auto'
		)}
		style="font-size: 11.5px; line-height: 1.55;"
	>
		{#if streamState === 'error' && streamError}
			<div
				class="flex items-start gap-2 rounded-md bg-red-500/10 p-3 text-xs text-red-400"
			>
				<AlertCircle class="mt-0.5 size-3.5 shrink-0" />
				<span>{streamError}</span>
			</div>
		{/if}

		{#if logLines.length === 0 && streamState !== 'error'}
			<div class="flex h-full items-center justify-center text-xs text-zinc-600">
				{#if streamState === 'streaming'}
					<span class="animate-pulse">Connecting…</span>
				{:else if streamState === 'done'}
					<span>Stream ended — no output</span>
				{:else}
					<span>No logs</span>
				{/if}
			</div>
		{:else}
			{#each logLines as line, i}
				{@const isActiveMatch = i === activeLineIdx}
				{@const isMatch = searchLower && line.msg.toLowerCase().includes(searchLower)}
				<div
					data-line-idx={i}
					class={cn(
						'flex items-baseline gap-2 rounded px-1 py-px leading-snug',
						wordWrap ? 'min-w-0' : 'w-max min-w-full',
						line.level === 'error' && 'bg-red-500/5',
						line.level === 'warn' && 'bg-yellow-500/5',
						isActiveMatch && 'bg-sky-500/15 ring-1 ring-sky-500/40',
						isMatch && !isActiveMatch && 'bg-sky-500/5'
					)}
				>
					<!-- Line number -->
					<span class="w-[3.2ch] shrink-0 select-none text-right text-zinc-700">
						{i + 1}
					</span>

					<!-- Timestamp -->
					{#if line.ts}
						<span class="shrink-0 text-zinc-600">{line.ts}</span>
					{/if}

					<!-- Level badge -->
					{#if line.level !== 'plain'}
						<span
							class={cn(
								'w-[3ch] shrink-0 select-none text-center text-[10px] font-bold',
								LEVEL_CLASS[line.level]
							)}
						>
							{LEVEL_LABEL[line.level]}
						</span>
					{/if}

					<!-- Message / raw text with search highlight -->
					<span
						class={cn(
							'min-w-0 flex-1',
							wordWrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
							LEVEL_CLASS[line.level]
						)}
					>
						{#if searchLower && isMatch}
							{#each highlightSegments(line.msg, searchLower) as seg}
								{#if seg.hl}
									<mark class="rounded-sm bg-yellow-400/30 px-px text-yellow-200">{seg.text}</mark>
								{:else}
									{seg.text}
								{/if}
							{/each}
						{:else}
							{line.msg}
						{/if}
					</span>
				</div>
			{/each}

			{#if streamState === 'done'}
				<div
					class="mt-1 px-2 text-[10px] text-zinc-600 italic"
				>
					— stream ended ({liveCount} lines) —
				</div>
			{/if}
		{/if}
	</div>

	<!-- ── Status bar ─────────────────────────────────────────────────────── -->
	<div
		class="flex shrink-0 items-center justify-between border-t border-zinc-800/60 bg-zinc-900/50 px-3 py-0.5"
	>
		<span class="font-mono text-[10px] text-zinc-600">
			{liveCount} line{liveCount === 1 ? '' : 's'}
			{#if streamState === 'paused' && pendingLines.length > 0}
				<span class="text-yellow-500/80"> (+{pendingLines.length} buffered)</span>
			{/if}
			{#if searchLower && matchCount > 0}
				<span class="text-sky-400/80"> · {matchCount} match{matchCount === 1 ? '' : 'es'}</span>
			{/if}
		</span>
		<span class="font-mono text-[10px] text-zinc-700">
			{pod?.name ?? ''}
			{selectedContainer ? `· ${selectedContainer}` : ''}
		</span>
	</div>
</div>

<!-- AI Log Analysis Dialog -->
{#if pod}
	<AiLogAnalysis
		bind:open={showAiAnalysis}
		{clusterId}
		{pod}
		logs={logLines.map((l) => l.raw).join('\n')}
		onClose={() => (showAiAnalysis = false)}
	/>
{/if}

<!-- Cursor override while dragging -->
{#if isDragging}
	<div class="fixed inset-0 z-[9999] cursor-ns-resize"></div>
{/if}
