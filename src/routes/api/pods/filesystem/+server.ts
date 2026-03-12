import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runPodCommand } from '$lib/server/services/kubernetes/exec';
import { authorize } from '$lib/server/services/authorize';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilesystemEntry = {
	name: string;
	type: 'd' | 'f' | 'l' | 'b' | 'c' | 'p' | 's' | '?';
	permissions: string;
	size: number;
	owner: string;
	group: string;
	symlink: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sanitize a filesystem path: reject traversal, normalize slashes */
function sanitizePath(raw: string): string | null {
	if (!raw) return '/';
	// Normalize: collapse multiple slashes, resolve . but NOT ..
	const parts = raw.split('/').filter(Boolean);
	for (const p of parts) {
		if (p === '..') return null; // traversal attempt
	}
	return '/' + parts.join('/');
}

/** Escape single-quotes for embedding in a sh -c '...' string */
function shEscape(s: string): string {
	return s.replace(/'/g, "'\\''");
}

/** Whether an exec error means the shell/binary wasn't found */
function isMissingExec(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return (
		msg.includes('executable file not found') ||
		msg.includes('OCI runtime exec failed')
	);
}

type RunOpts = Omit<Parameters<typeof runPodCommand>[0], 'command'>;

/** Convert octal permission number (e.g. "755", "1777", "4755") + file type to symbolic string */
function octalToSymbolic(octal: string, fileType: string): string {
	const n = parseInt(octal, 8);
	if (isNaN(n)) return '??????????';
	const typeChar: Record<string, string> = { d: 'd', f: '-', l: 'l', b: 'b', c: 'c', p: 'p', s: 's' };
	const t = typeChar[fileType] ?? '-';
	const bits = (v: number, shift: number) => (v >> shift) & 7;
	const rwx = (b: number) => (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-');
	let owner = rwx(bits(n, 6));
	let group = rwx(bits(n, 3));
	let other = rwx(bits(n, 0));
	if (n & 0o4000) owner = owner.slice(0, 2) + (owner[2] === 'x' ? 's' : 'S');
	if (n & 0o2000) group = group.slice(0, 2) + (group[2] === 'x' ? 's' : 'S');
	if (n & 0o1000) other = other.slice(0, 2) + (other[2] === 'x' ? 't' : 'T');
	return t + owner + group + other;
}

function sortEntries(entries: FilesystemEntry[]): FilesystemEntry[] {
	return entries.sort((a, b) => {
		if (a.type === 'd' && b.type !== 'd') return -1;
		if (a.type !== 'd' && b.type === 'd') return 1;
		return a.name.localeCompare(b.name);
	});
}

/**
 * Parse `find -printf '%y\t%m\t%s\t%u\t%g\t%P\t%l\n'` output.
 * %m = octal perms (BusyBox + GNU), %P = path relative to search root.
 */
function parseFindEntries(raw: string): FilesystemEntry[] {
	const entries: FilesystemEntry[] = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		const parts = line.split('\t');
		if (parts.length < 6) continue;
		const [type, permissions, sizeStr, owner, group, name, ...rest] = parts;
		if (!name) continue;
		const trimmedType = type?.trim() ?? '?';
		const rawPerms = permissions?.trim() ?? '?';
		const symbolicPerms = /^[0-7]+$/.test(rawPerms)
			? octalToSymbolic(rawPerms, trimmedType)
			: rawPerms;
		entries.push({
			name: name.trim(),
			type: trimmedType as FilesystemEntry['type'],
			permissions: symbolicPerms,
			size: parseInt(sizeStr ?? '0', 10) || 0,
			owner: owner?.trim() ?? '?',
			group: group?.trim() ?? '?',
			symlink: rest.join('\t').trim()
		});
	}
	return sortEntries(entries);
}

/**
 * Parse `ls -laAn` output.
 * Used as fallback when `find -printf` is not supported (some stripped BusyBox builds).
 * -n uses numeric UIDs/GIDs for consistent output.
 */
function parseLsEntries(raw: string): FilesystemEntry[] {
	const entries: FilesystemEntry[] = [];
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('total ')) continue;
		// Format: perms nlinks owner group size date date date name [-> target]
		const m = trimmed.match(
			/^([dlbcps-])([rwxstST-]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/
		);
		if (!m) continue;
		const [, typeChar, perms, owner, group, sizeStr, rest] = m;
		let name = rest;
		let symlink = '';
		if (typeChar === 'l' && rest.includes(' -> ')) {
			const idx = rest.lastIndexOf(' -> ');
			name = rest.slice(0, idx);
			symlink = rest.slice(idx + 4);
		}
		if (name === '.' || name === '..') continue;
		entries.push({
			name,
			type: (typeChar === '-' ? 'f' : typeChar) as FilesystemEntry['type'],
			permissions: typeChar + perms,
			size: parseInt(sizeStr, 10) || 0,
			owner,
			group,
			symlink
		});
	}
	return sortEntries(entries);
}

/**
 * List directory entries using the best available tool in the container.
 *
 * Strategy (each step is tried with all available shells):
 *   1. `find -printf '%y\t%m\t...'`  — works on GNU find and most BusyBox builds
 *   2. `ls -laAn <path>`              — universally available fallback
 *   3. `ls -laA  <path>`              — in case -n is not supported (rare)
 *
 * Shell probe order: /bin/sh → /bin/bash → /bin/ash
 * Any error (not just "binary not found") advances to the next attempt.
 */
async function listDirectory(opts: RunOpts, path: string): Promise<FilesystemEntry[]> {
	const shells = ['/bin/sh', '/bin/bash', '/bin/ash'];
	const ep = shEscape(path);
	// %m = octal perms (BusyBox-safe); %P = relative name; %l = symlink target
	const findCmd = `find '${ep}' -maxdepth 1 -mindepth 1 -printf '%y\\t%m\\t%s\\t%u\\t%g\\t%P\\t%l\\n' 2>/dev/null`;

	// 1. find -printf via shell
	for (const shell of shells) {
		try {
			const { stdout } = await runPodCommand({ ...opts, command: [shell, '-c', findCmd] });
			if (stdout.trim()) return parseFindEntries(stdout);
		} catch (err) {
			if (isMissingExec(err)) continue; // shell not found — try next shell
			// Any other error (exit code 1, -printf unsupported, etc.) — fall through to ls
			break;
		}
	}

	// 2. ls -laAn (numeric UIDs for consistent parsing) via shell
	const lsnCmd = `ls -laAn '${ep}' 2>/dev/null`;
	for (const shell of shells) {
		try {
			const { stdout } = await runPodCommand({ ...opts, command: [shell, '-c', lsnCmd] });
			if (stdout.trim()) return parseLsEntries(stdout);
		} catch (err) {
			if (isMissingExec(err)) continue;
			break;
		}
	}

	// 3. ls -laA (no -n, in case numeric UIDs aren't supported) via shell
	const lsCmd = `ls -laA '${ep}' 2>/dev/null`;
	for (const shell of shells) {
		try {
			const { stdout } = await runPodCommand({ ...opts, command: [shell, '-c', lsCmd] });
			if (stdout.trim()) return parseLsEntries(stdout);
		} catch (err) {
			if (isMissingExec(err)) continue;
			break;
		}
	}

	// 4. ls directly (no shell)
	try {
		const { stdout } = await runPodCommand({ ...opts, command: ['ls', '-laAn', path] });
		if (stdout.trim()) return parseLsEntries(stdout);
	} catch { /* ignore */ }

	throw new Error(
		'No shell (sh/bash/ash) or `ls` binary found in this container. ' +
		'Distroless/scratch containers may not have any utilities available.'
	);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async (event) => {
	const { cookies, url } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('clusters', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const clusterIdParam = url.searchParams.get('cluster');
	const namespace = url.searchParams.get('namespace');
	const pod = url.searchParams.get('pod');
	const container = url.searchParams.get('container');
	const rawPath = url.searchParams.get('path') ?? '/';

	if (!clusterIdParam || !namespace || !pod || !container) {
		return json({ success: false, error: 'cluster, namespace, pod, container are required' }, { status: 400 });
	}

	const clusterId = parseInt(clusterIdParam);
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const path = sanitizePath(rawPath);
	if (path === null) {
		return json({ success: false, error: 'Invalid path' }, { status: 400 });
	}

	try {
		const entries = await listDirectory(
			{ clusterId, namespace, pod, container, timeout: 20_000 },
			path
		);

		return json({ success: true, path, entries });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[API] Filesystem list error:', err);
		return json({ success: false, error: msg }, { status: 500 });
	}
};
