/**
 * Postbuild script: patch build/server/index.js to wire up the `websocket`
 * export from hooks.server.ts into the Bun server.
 *
 * svelte-adapter-bun v1.0.1 uses regex patches that no longer match the
 * current SvelteKit minified build output (field renamed from #options.hooks
 * to #e.hooks, parameters minified, etc.), so `server.websocket()` is never
 * added and Bun starts without a WebSocket handler registered.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const serverPath = './build/server/index.js';
let code = readFileSync(serverPath, 'utf8');

let count = 0;

function patch(description: string, pattern: RegExp, replacement: string): void {
	const next = code.replace(pattern, replacement);
	if (next === code) {
		console.warn(`[patch-production-ws] WARNING: Pattern not matched — ${description}`);
	} else {
		count++;
		code = next;
	}
}

// ── 1. Add `ws` variable to the hooks loader function v() ───────────────────
// Matches: let t, n, e, a, <any-letter>;
// regardless of which single-letter var name is used for `init`
patch(
	'add ws to let declaration in v()',
	/(\blet t, n, e, a, )(\w)(;)/,
	'$1$2, ws$3'
);

// ── 2. Add websocket to the destructuring from the hooks chunk ───────────────
// Capture everything up to (but not including) the closing } so we can
// insert , websocket: ws before the } rather than after it.
patch(
	'add websocket:ws to destructuring in v()',
	/(\{handle: t, handleFetch: n, handleError: e, handleValidationError: a, init: \w)(\}) = (await import\()/,
	'$1, websocket: ws$2 = $3'
);

// ── 3. Add websocket to the returned object of v() ───────────────────────────
// Matches init: <any-letter>,\n<any-whitespace>reroute: void 0,
patch(
	'add websocket:ws to return object in v()',
	/(init: (\w),(\s+)reroute: void 0,)/,
	'init: $2,$3websocket: ws,$3reroute: void 0,'
);

// ── 4. Add websocket to this.#e.hooks assignment ─────────────────────────────
// Insert after transport: a.transport || {} (with or without trailing comma)
// Idempotent: skip if websocket line is already present
if (!code.includes('websocket: a.websocket || null')) {
	patch(
		'add websocket to this.#e.hooks',
		/(reroute: a\.reroute \|\| \(\(\) => \{\}\),(\s+)transport: a\.transport \|\| \{\}),?\s*\}/,
		'$1,$2websocket: a.websocket || null\n$2}'
	);
} else {
	count++; // already present, counts as applied
}

// ── 5. Add websocket() accessor method to the Server class ───────────────────
// Handles any minified parameter names inside init({...})
// Idempotent: skip if websocket() method is already present
if (!code.includes('websocket() { return this.#e.hooks')) {
	patch(
		'add websocket() method to Server class',
		/(\tasync init\(\{[^}]*\}\)\s*\{)/,
		'\twebsocket() { return this.#e.hooks?.websocket ?? null; }\n$1'
	);
} else {
	count++; // already present, counts as applied
}

if (count === 0) {
	console.error('[patch-production-ws] ERROR: No patches applied — bailing out');
	process.exit(1);
}

writeFileSync(serverPath, code, 'utf8');
console.log(`[patch-production-ws] Patched build/server/index.js for WebSocket support (${count}/5 patches applied)`);
if (count < 5) {
	console.warn('[patch-production-ws] WARNING: Only ' + count + ' of 5 patches applied — WebSocket may not work');
}
