<!--
  Pod Terminal — bottom drawer with interactive shell via xterm.js.

  Features
  ─────────
  • Slide-up panel from the bottom (drag-handle to resize)
  • Interactive shell using xterm.js + K8s exec API
  • Shell selector (sh, bash, zsh)
  • Container selector for multi-container pods
  • Font size control
  • Status indicator (Connecting / Connected / Disconnected / Error)
  • Reconnect on demand

  Usage
  ─────
  <PodTerminal
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
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { MONO_FONTS } from '$lib/theme-utils';
	import {
		X,
		RotateCcw,
		GripHorizontal,
		Terminal,
		AlertCircle,
		Plus,
		Minus,
		Ban,
		SquareTerminal
	} from 'lucide-svelte';

	// ── Types ─────────────────────────────────────────────────────────────────

	export type TerminalPod = {
		name: string;
		namespace: string;
		containers: Array<{ name: string; image: string; ready: boolean; state: string }>;
	};

	type Props = {
		open?: boolean;
		clusterId: number;
		pod: TerminalPod | null;
		onClose?: () => void;
	};

	type ConnState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'no-shell';

	// ── Props ─────────────────────────────────────────────────────────────────

	let { open = $bindable(false), clusterId, pod, onClose }: Props = $props();

	// ── State ─────────────────────────────────────────────────────────────────

	let connState = $state<ConnState>('idle');
	let connError = $state('');
	let selectedContainer = $state('');
	let selectedShell = $state('/bin/sh');
	let resolvedShell = $state<string | null>(null); // shell actually used after fallback
	let fontSize = $state(13);
	let sessionId = $state<string | null>(null);

	// Track connection timing to detect shells that exit immediately
	let connectionStartedAt = $state<number | null>(null);
	let connectedAt = $state<number | null>(null);
	let hadUserInput = $state(false);
	let receivedTerminalOutput = $state(false);

	// Panel dimensions
	const MIN_HEIGHT = 220;
	const MAX_HEIGHT_RATIO = 0.82;
	let panelHeight = $state(360);
	let isDragging = $state(false);

	// Refs
	let terminalEl = $state<HTMLDivElement | null>(null);
	let panelEl = $state<HTMLElement | null>(null);

	// xterm instances (lazily loaded, browser only)
	let term = $state<import('@xterm/xterm').Terminal | null>(null);
	let fitAddon: import('@xterm/addon-fit').FitAddon | null = null;
	let es: EventSource | null = null;

	function isNoShellErrorMessage(message: string): boolean {
		const normalized = message.trim().toLowerCase();
		if (normalized === 'no_shell' || normalized.startsWith('no_shell:')) {
			return true;
		}

		const noShellHints = [
			'no such file or directory',
			'not found',
			'oci runtime exec failed',
			'exit code 126',
			'exit code 127',
			'executable file not found',
			'failed to exec',
			'shell exited immediately'
		];

		return noShellHints.some((hint) => normalized.includes(hint));
	}

	function normalizeNoShellMessage(message: string): string {
		if (!message.trim() || message.trim().toUpperCase() === 'NO_SHELL') {
			return 'This container has no shell installed. Common with distroless or scratch-based images.';
		}

		return message.replace(/^NO_SHELL:\s*/i, '').trim();
	}

	// ── Derived ───────────────────────────────────────────────────────────────

	const containers = $derived(pod?.containers ?? []);
	const isOpen = $derived(open && pod !== null);

	const terminalFontFamily = $derived(
		MONO_FONTS.find((f) => f.id === settingsStore.terminalFont)?.family ??
		"'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace"
	);

	const shells: Array<{ value: string; label: string; desc: string; color: string }> = [
		{ value: '/bin/sh',   label: 'sh',   desc: 'POSIX Shell',   color: 'text-zinc-400' },
		{ value: '/bin/bash', label: 'bash', desc: 'Bourne Again',  color: 'text-green-400' },
		{ value: '/bin/ash',  label: 'ash',  desc: 'Alpine Shell',  color: 'text-sky-400' },
	];

	const activeShell = $derived(shells.find((s) => s.value === selectedShell) ?? shells[0]);

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	$effect(() => {
		if (pod) {
			untrack(() => {
				selectedContainer = pod!.containers[0]?.name ?? '';
			});
		}
	});

	$effect(() => {
		if (isOpen) {
			untrack(() => connect());
		} else {
			untrack(() => teardown());
		}
	});

	// Auto-fit terminal when panel height changes
	$effect(() => {
		void panelHeight;
		untrack(() => {
			requestAnimationFrame(() => fitTerminal());
		});
	});

	// Apply font family changes live to open terminal
	$effect(() => {
		const family = terminalFontFamily;
		if (term) {
			term.options.fontFamily = family;
			fitTerminal();
		}
	});

	onDestroy(teardown);

	// ── Terminal Setup ────────────────────────────────────────────────────────

	async function initTerminal(): Promise<void> {
		if (term || !terminalEl) return;

		const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
			import('@xterm/xterm'),
			import('@xterm/addon-fit')
		]);

		// Import xterm CSS
		await import('@xterm/xterm/css/xterm.css');

		term = new XTerm({
			cursorBlink: true,
			fontSize,
			fontFamily: terminalFontFamily,
			theme: {
				background: '#09090b', // zinc-950
				foreground: '#d4d4d8', // zinc-300
				cursor: '#a1a1aa', // zinc-400
				selectionBackground: '#3f3f4680',
				black: '#18181b',
				red: '#f87171',
				green: '#4ade80',
				yellow: '#facc15',
				blue: '#60a5fa',
				magenta: '#c084fc',
				cyan: '#22d3ee',
				white: '#e4e4e7',
				brightBlack: '#52525b',
				brightRed: '#fca5a5',
				brightGreen: '#86efac',
				brightYellow: '#fde047',
				brightBlue: '#93c5fd',
				brightMagenta: '#d8b4fe',
				brightCyan: '#67e8f9',
				brightWhite: '#fafafa'
			},
			scrollback: 5000,
			convertEol: true,
			allowProposedApi: true
		});

		fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(terminalEl);

		// Forward keystrokes to the server
		term.onData((data: string) => {
			if (sessionId && connState === 'connected') {
				hadUserInput = true;
				sendInput(data);
			}
		});

		// Handle resize
		term.onResize(({ cols, rows }) => {
			if (sessionId && connState === 'connected') {
				sendResizeEvent(cols, rows);
			}
		});

		fitAddon.fit();
	}

	function fitTerminal() {
		if (fitAddon && term) {
			try {
				fitAddon.fit();
			} catch { /* ignore if not mounted */ }
		}
	}

	function disposeTerminal() {
		if (term) {
			term.dispose();
			term = null;
		}
		fitAddon = null;
	}

	// ── Connection ────────────────────────────────────────────────────────────

	async function connect() {
		teardown();
		connState = 'connecting';
		connError = '';
		connectionStartedAt = Date.now();
		receivedTerminalOutput = false;

		if (!pod || !clusterId) return;

		// First, init the terminal UI
		await new Promise<void>((r) => {
			requestAnimationFrame(async () => {
				await initTerminal();
				r();
			});
		});

		if (term) {
			term.clear();
			term.focus();
		}

		// Get terminal dimensions
		const cols = term?.cols ?? 80;
		const rows = term?.rows ?? 24;

		const qs = new URLSearchParams({
			namespace: pod.namespace,
			pod: pod.name,
			container: selectedContainer,
			shell: selectedShell,
			cols: cols.toString(),
			rows: rows.toString()
		});

		es = new EventSource(`/api/clusters/${clusterId}/pods/exec?${qs}`);

		es.addEventListener('connected', (e: Event) => {
			if (!(e instanceof MessageEvent)) return;
			try {
				const data = JSON.parse(e.data);
				sessionId = data.sessionId;
				resolvedShell = data.shell || selectedShell;
				connState = 'connected';
				connectedAt = Date.now();
				hadUserInput = false;
			} catch {
				connError = 'Failed to parse session data';
				connState = 'error';
			}
		});

		es.addEventListener('no_shell', (e: Event) => {
			if (!(e instanceof MessageEvent)) return;
			try {
				connError = normalizeNoShellMessage(JSON.parse(e.data) ?? '');
			} catch {
				connError = 'This container has no shell installed. Common with distroless or scratch-based images.';
			}
			connState = 'no-shell';
			closeEs();
		});

		es.addEventListener('stdout', (e: Event) => {
			if (!(e instanceof MessageEvent)) return;
			try {
				const text = JSON.parse(e.data);
				if (typeof text === 'string' && text.length > 0) {
					receivedTerminalOutput = true;
				}
				term?.write(text);
			} catch { /* ignore */ }
		});

		es.addEventListener('stderr', (e: Event) => {
			if (!(e instanceof MessageEvent)) return;
			try {
				const text = JSON.parse(e.data);
				if (typeof text === 'string' && text.length > 0) {
					receivedTerminalOutput = true;
				}
				term?.write(text);
			} catch { /* ignore */ }
		});

		es.addEventListener('done', () => {
			// Don't override no-shell or error states
			if (connState !== 'no-shell' && connState !== 'error') {
				// If the shell exited very quickly after connecting and the user
				// never typed anything, this container likely can't sustain a shell
				const startedAt = connectedAt ?? connectionStartedAt;
				const exitedQuickly = startedAt !== null && (Date.now() - startedAt) < 3000;
				if (exitedQuickly && !hadUserInput && !receivedTerminalOutput) {
					connError = 'Shell exited immediately. This container may not support interactive shells.';
					connState = 'no-shell';
				} else {
					connState = 'disconnected';
				}
			}
			closeEs();
		});

		es.addEventListener('error', (e: Event) => {
			if (!(e instanceof MessageEvent)) return;
			let msg = '';
			try {
				msg = JSON.parse(e.data) ?? 'Connection error';
			} catch {
				msg = (e as MessageEvent).data ?? 'Connection error';
			}
			// Detect shell-not-found errors and show no-shell UI instead
			const isNoShell = isNoShellErrorMessage(msg);
			connError = isNoShell ? normalizeNoShellMessage(msg) : msg;
			connState = isNoShell ? 'no-shell' : 'error';
			closeEs();
		});

		es.onerror = () => {
			if (connState !== 'connecting' && connState !== 'connected') return;
			connState = 'error';
			connError = 'Connection failed — check cluster connectivity';
			closeEs();
		};
	}

	function closeEs() {
		if (es) {
			es.close();
			es = null;
		}
	}

	function teardown() {
		// Destroy the exec session on server
		if (sessionId && clusterId) {
			const sid = sessionId;
			fetch(`/api/clusters/${clusterId}/pods/exec?sessionId=${sid}`, { method: 'DELETE' }).catch(
				() => {}
			);
		}
		closeEs();
		disposeTerminal();
		sessionId = null;
		resolvedShell = null;
		connectionStartedAt = null;
		connectedAt = null;
		hadUserInput = false;
		receivedTerminalOutput = false;
		connState = 'idle';
		connError = '';
	}

	// ── Stdin & Resize ────────────────────────────────────────────────────────

	async function sendInput(data: string) {
		if (!sessionId) return;
		try {
			await fetch(`/api/clusters/${clusterId}/pods/exec/input`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, data })
			});
		} catch {
			// Ignore send failures silently
		}
	}

	async function sendResizeEvent(cols: number, rows: number) {
		if (!sessionId) return;
		try {
			await fetch(`/api/clusters/${clusterId}/pods/exec/resize`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, cols, rows })
			});
		} catch {
			// Ignore resize failures silently
		}
	}

	// ── Controls ──────────────────────────────────────────────────────────────

	function reconnect() {
		connect();
	}

	function handleClose() {
		open = false;
		onClose?.();
	}

	function changeContainer(name: string) {
		selectedContainer = name;
		resolvedShell = null;
		if (connState !== 'idle') {
			connect();
		}
	}

	function changeShell(shell: string) {
		selectedShell = shell;
		resolvedShell = null;
		if (connState !== 'idle') {
			connect();
		}
	}

	function changeFontSize(delta: number) {
		fontSize = Math.max(10, Math.min(24, fontSize + delta));
		if (term) {
			term.options.fontSize = fontSize;
			fitTerminal();
		}
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
			isDragging = true;
			requestAnimationFrame(() => (isDragging = false));
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onUp);
		}

		document.addEventListener('pointermove', onMove);
		document.addEventListener('pointerup', onUp);
	}
</script>

<!-- ── Overlay backdrop ───────────────────────────────────────────────────── -->
{#if isOpen}
	<div
		class="pointer-events-none fixed inset-0 z-40"
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
		aria-label="Drag to resize terminal panel"
	>
		<GripHorizontal class="size-3.5 text-zinc-500" />
	</div>

	<!-- ── Header ──────────────────────────────────────────────────────── -->
	<div
		class="flex shrink-0 items-center gap-2 border-b border-zinc-700/40 bg-zinc-900/60 px-3 py-1.5"
	>
		<!-- Icon + pod name -->
		<Terminal class="size-3.5 shrink-0 text-zinc-400" />
		<span class="max-w-45 truncate font-mono text-xs font-semibold text-zinc-200">
			{pod?.name ?? ''}
		</span>
		<Badge
			variant="outline"
			class="h-4 shrink-0 border-zinc-600 px-1 py-0 font-mono text-[10px] text-zinc-400"
		>
			{pod?.namespace ?? ''}
		</Badge>

		<!-- Container selector -->
		{#if containers.length > 1}
			<Select.Root
				type="single"
				value={selectedContainer}
				onValueChange={(v: string) => {
					if (v) changeContainer(v);
				}}
			>
				<Select.Trigger
					size="sm"
					class="h-6! min-w-25 max-w-40 rounded-sm! border-zinc-700! bg-zinc-800! px-2! py-0! text-[11px]! text-zinc-300! shadow-none! hover:bg-zinc-700!"
				>
					{selectedContainer || 'container'}
				</Select.Trigger>
				<Select.Content class="border-zinc-700! bg-zinc-900! text-zinc-300!">
					{#each containers as c (c.name)}
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

		<!-- Shell selector -->
		<Select.Root
			type="single"
			value={selectedShell}
			onValueChange={(v: string) => {
				if (v) changeShell(v);
			}}
		>
			<Select.Trigger
				size="sm"
				class="h-6! gap-1.5! rounded-sm! border-zinc-700! bg-zinc-800! px-2! py-0! text-[11px]! shadow-none! hover:bg-zinc-700!"
			>
				<SquareTerminal class="size-3 shrink-0 {activeShell.color}" />
				<span class="font-mono text-zinc-300">{activeShell.label}</span>
			</Select.Trigger>
			<Select.Content class="min-w-40! border-zinc-700! bg-zinc-900! p-1!">
				{#each shells as sh (sh.value)}
					<Select.Item
						value={sh.value}
						label={sh.label}
						class="rounded-sm! pe-2! ps-2! data-highlighted:bg-zinc-800!"
					>
						{#snippet children({ selected })}
							<span class="flex w-full items-center gap-2">
								<SquareTerminal class="size-3.5 shrink-0 {sh.color}" />
								<span class="font-mono text-[12px] font-medium text-zinc-200">{sh.label}</span>
								<span class="ml-auto whitespace-nowrap text-[10px] text-zinc-500">{sh.desc}</span>
								{#if selected}
									<span class="text-emerald-400"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
								{/if}
							</span>
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<div class="flex-1"></div>

		<!-- Connection state badge -->
		<span
			class={cn(
				'flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px]',
				connState === 'connected' && 'bg-emerald-500/10 text-emerald-400',
				connState === 'connecting' && 'bg-sky-500/10 text-sky-400',
				connState === 'disconnected' && 'bg-zinc-500/10 text-zinc-400',
				connState === 'error' && 'bg-red-500/10 text-red-400',
				connState === 'no-shell' && 'bg-orange-500/10 text-orange-400',
				connState === 'idle' && 'bg-zinc-500/10 text-zinc-500'
			)}
		>
			<span
				class={cn(
					'size-1.5 rounded-full',
					connState === 'connected' && 'animate-pulse bg-emerald-400',
					connState === 'connecting' && 'animate-pulse bg-sky-400',
					connState === 'disconnected' && 'bg-zinc-400',
					connState === 'error' && 'bg-red-400',
					connState === 'no-shell' && 'bg-orange-400',
					connState === 'idle' && 'bg-zinc-600'
				)}
			></span>
			{connState === 'connected'
				? 'Connected'
				: connState === 'connecting'
					? 'Connecting…'
					: connState === 'disconnected'
						? 'Disconnected'
						: connState === 'error'
							? 'Error'
							: connState === 'no-shell'
								? 'No Shell'
								: 'Idle'}
			{#if resolvedShell && connState === 'connected' && resolvedShell !== selectedShell}
				{@const rs = shells.find((s) => s.value === resolvedShell)}
				<span class="text-[9px] text-yellow-400/80">(fell back to {rs?.label ?? resolvedShell.split('/').pop()})</span>
			{/if}
		</span>

		<!-- Controls -->
		<div class="flex items-center gap-0.5">
			<!-- Font size controls -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={() => changeFontSize(-1)}
					>
						<Minus class="size-3" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Decrease font size</Tooltip.Content>
			</Tooltip.Root>

			<span class="w-5 text-center font-mono text-[10px] text-zinc-500">{fontSize}</span>

			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={() => changeFontSize(1)}
					>
						<Plus class="size-3" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Increase font size</Tooltip.Content>
			</Tooltip.Root>

			<!-- Reconnect -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
						onclick={reconnect}
					>
						<RotateCcw class="size-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Reconnect</Tooltip.Content>
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

	<!-- ── Terminal content ─────────────────────────────────────────────── -->
	<div class="relative flex-1 overflow-hidden bg-zinc-950">
		{#if connState === 'error' && connError}
			<div
				class="absolute inset-x-0 top-0 z-10 flex items-start gap-2 border-b border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400"
			>
				<AlertCircle class="mt-0.5 size-3.5 shrink-0" />
				<span>{connError}</span>
			</div>
		{/if}

		{#if connState === 'no-shell'}
			<div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
				<div class="flex size-12 items-center justify-center rounded-full bg-orange-500/10">
					<Ban class="size-6 text-orange-400" />
				</div>
				<div>
					<h3 class="text-sm font-semibold text-zinc-200">No shell available</h3>
					<p class="mt-1 max-w-sm text-xs text-zinc-500">
						{'This container has no shell installed. Common with distroless or scratch-based images.'}
					</p>
				</div>
				<div class="mt-1 flex flex-wrap items-center justify-center gap-1">
					<span class="text-[10px] text-zinc-600">Tried:</span>
					<Badge variant="outline" class="border-zinc-700 px-1.5 py-0 font-mono text-[10px] text-zinc-500">{selectedShell}</Badge>
				</div>
			</div>
		{:else if connState === 'idle' || (connState === 'connecting' && !term)}
			<div class="flex h-full items-center justify-center text-xs text-zinc-600">
				{#if connState === 'connecting'}
					<span class="animate-pulse">Connecting…</span>
				{:else}
					<span>Terminal not connected</span>
				{/if}
			</div>
		{/if}

		<div
			bind:this={terminalEl}
			class="h-full w-full"
			style="padding: 4px;"
		></div>
	</div>

	<!-- ── Status bar ─────────────────────────────────────────────────── -->
	<div
		class="flex shrink-0 items-center justify-between border-t border-zinc-800/60 bg-zinc-900/50 px-3 py-0.5"
	>
		<span class="font-mono text-[10px] text-zinc-600">
			{resolvedShell || selectedShell}
			{term ? ` · ${term.cols}×${term.rows}` : ''}
		</span>
		<span class="font-mono text-[10px] text-zinc-700">
			{pod?.name ?? ''}
			{selectedContainer ? ` · ${selectedContainer}` : ''}
		</span>
	</div>
</div>

<!-- Cursor override while dragging -->
{#if isDragging}
	<div class="fixed inset-0 z-9999 cursor-ns-resize"></div>
{/if}
