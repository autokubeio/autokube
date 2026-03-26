#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

function run(cmd: string): string {
	try {
		return execSync(cmd, { encoding: 'utf-8' }).trim();
	} catch {
		return 'unknown';
	}
}

// Allow passing values via env so Docker builds (which have no git) can still set them
const info = {
	branch: process.env.GIT_BRANCH || run('git rev-parse --abbrev-ref HEAD'),
	commit: process.env.GIT_COMMIT || run('git rev-parse --short HEAD'),
	buildDate: new Date().toISOString().split('T')[0]
};

writeFileSync('build-info.json', JSON.stringify(info, null, 2));
console.log('build-info.json written:', info);

// ── Patch build/handler.js ───────────────────────────────────────────────────
// svelte-adapter-bun injects `server.websocket()` into the handler, but its
// regex-based patcher fails on SvelteKit ≥2.x minified output, so the Server
// class never gets the websocket() method and startup crashes with:
//   TypeError: server.websocket is not a function
// We guard the call here after every build so this always works.
const handlerPath = 'build/handler.js';
try {
	const original = readFileSync(handlerPath, 'utf-8');
	const patched = original.replace(
		/\bserver\.websocket\(\)/g,
		'(typeof server.websocket === "function" ? server.websocket() : null)'
	);
	if (patched !== original) {
		writeFileSync(handlerPath, patched);
		console.log('build/handler.js patched: guarded server.websocket() call');
	} else {
		console.log('build/handler.js: no patch needed');
	}
} catch (e) {
	console.warn('Could not patch build/handler.js:', e);
}
