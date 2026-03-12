import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { runPodCommand } from '$lib/server/services/kubernetes/exec';
import { authorize } from '$lib/server/services/authorize';

/** Sanitize path — reject traversal */
function sanitizePath(raw: string): string | null {
	if (!raw) return null;
	const parts = raw.split('/').filter(Boolean);
	for (const p of parts) {
		if (p === '..') return null;
	}
	return '/' + parts.join('/');
}

function shEscape(s: string): string {
	return s.replace(/'/g, "'\\''");
}
/** Whether an exec error means the shell/binary wasn't found */
function isMissingExec(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return (
		msg.includes('executable file not found') ||
		msg.includes('no such file or directory') ||
		msg.includes('OCI runtime exec failed')
	);
}

type RunOpts = Omit<Parameters<typeof runPodCommand>[0], 'command'>;

/**
 * Run a base64-encode command in the container, trying multiple shells
 * and falling back to running `base64` directly.
 */
async function runBase64Command(
	opts: RunOpts,
	filePath: string
): Promise<{ stdout: string; stderr: string }> {
	const shells = ['/bin/sh', '/bin/bash', '/bin/ash'];
	const escaped = shEscape(filePath);
	// Always exit 0 so a base64 failure (bad path, perms, dangling symlink) doesn't
	// cause runPodCommand to throw. Sentinels:
	//   __IS_DIR__         — path is a directory (symlink or real)
	//   __BASE64_FAILED__  — base64 exited non-zero; check stderr for reason
	const cmd = `if test -d '${escaped}'; then echo __IS_DIR__; else base64 '${escaped}' || echo __BASE64_FAILED__; fi`;

	// Try each shell by absolute path
	for (const shell of shells) {
		try {
			return await runPodCommand({ ...opts, command: [shell, '-c', cmd] });
		} catch (err) {
			if (!isMissingExec(err)) throw err;
		}
	}

	// Try running base64 directly (no shell)
	try {
		return await runPodCommand({ ...opts, command: ['base64', filePath] });
	} catch (err) {
		if (!isMissingExec(err)) throw err;
	}

	throw new Error(
		'No shell or `base64` utility found in this container. ' +
		'Distroless containers may not support file downloads.'
	);
}
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
	const rawPath = url.searchParams.get('path');

	if (!clusterIdParam || !namespace || !pod || !container || !rawPath) {
		return json({ success: false, error: 'cluster, namespace, pod, container, path are required' }, { status: 400 });
	}

	const clusterId = parseInt(clusterIdParam);
	if (isNaN(clusterId)) {
		return json({ success: false, error: 'Invalid cluster ID' }, { status: 400 });
	}

	const path = sanitizePath(rawPath);
	if (!path) {
		return json({ success: false, error: 'Invalid path' }, { status: 400 });
	}

	// Derive a safe filename from the path
	const filename = path.split('/').filter(Boolean).pop() ?? 'download';

	try {
		// Use base64 to safely transport binary files through the text-based exec channel
		const { stdout, stderr } = await runBase64Command(
			{ clusterId, namespace, pod, container, maxBytes: 32 * 1024 * 1024, timeout: 60_000 },
			path
		);

		// Directory check: our shell command emits __IS_DIR__ when the path is a dir
		if (stdout.trim() === '__IS_DIR__') {
			return json({ success: false, error: 'IS_DIRECTORY' }, { status: 400 });
		}

		// Also catch the raw error message in case `test` wasn't available
		if (stderr.includes('Is a directory')) {
			return json({ success: false, error: 'IS_DIRECTORY' }, { status: 400 });
		}

		// base64 failed (dangling symlink, file not found, permission denied, etc.)
		if (stdout.trim() === '__BASE64_FAILED__') {
			const reason = stderr.trim() || 'File not readable';
			return json({ success: false, error: reason }, { status: 404 });
		}

		if (!stdout.trim()) {
			const errMsg = stderr.trim() || 'File is empty or not readable';
			return json({ success: false, error: errMsg }, { status: 404 });
		}

		// Decode base64 (strip whitespace/newlines from base64 output)
		const b64 = stdout.replace(/\s/g, '');
		let fileBytes: Uint8Array;
		try {
			fileBytes = Buffer.from(b64, 'base64');
		} catch {
			return json({ success: false, error: 'Failed to decode file content' }, { status: 500 });
		}

		return new Response(fileBytes.buffer as ArrayBuffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
				'Content-Length': String(fileBytes.byteLength)
			}
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[API] Filesystem download error:', err);
		return json({ success: false, error: msg }, { status: 500 });
	}
};
