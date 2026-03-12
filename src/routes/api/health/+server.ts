import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DB_TYPE } from '$lib/server/db';
import os from 'node:os';
import { readFileSync } from 'node:fs';

const startTime = Date.now();

// Try to read build info from a generated file, fallback to defaults
function getBuildInfo() {
	try {
		const raw = readFileSync('build-info.json', 'utf-8');
		return JSON.parse(raw);
	} catch {
		return {
			branch: 'main',
			commit: 'dev',
			buildDate: new Date().toISOString().split('T')[0]
		};
	}
}

function getSchemaInfo() {
	try {
		const journalPath =
			DB_TYPE === 'postgres' ? './drizzle/pg/meta/_journal.json' : './drizzle/sqlite/meta/_journal.json';
		const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));

		if (journal.entries && journal.entries.length > 0) {
			const last = journal.entries[journal.entries.length - 1];
			return {
				schemaVersion: last.tag ?? null,
				schemaDate: last.when ? new Date(last.when).toISOString().split('T')[0] : null
			};
		}
		return { schemaVersion: null, schemaDate: null };
	} catch (e) {
		console.error('[DB] Error getting schema version:', e instanceof Error ? e.message : String(e));
		return { schemaVersion: null, schemaDate: null };
	}
}

export const GET: RequestHandler = async () => {
	const mem = process.memoryUsage();
	const buildInfo = getBuildInfo();
	const schemaInfo = getSchemaInfo();

	return json({
		build: {
			branch: buildInfo.branch,
			commit: buildInfo.commit,
			buildDate: buildInfo.buildDate
		},
		uptime: {
			ms: Date.now() - startTime
		},
		runtime: {
			sveltekit: '2.53.1',
			bunVersion: typeof Bun !== 'undefined' ? Bun.version : process.version,
			platform: os.platform(),
			arch: os.arch(),
			kernel: os.release(),
			memory: {
				heapUsed: mem.heapUsed,
				heapTotal: mem.heapTotal,
				rss: mem.rss,
				external: mem.external
			}
		},
		database: {
			type: DB_TYPE === 'postgres' ? 'PostgreSQL' : 'SQLite',
			schemaVersion: schemaInfo.schemaVersion,
			schemaDate: schemaInfo.schemaDate
		}
	});
};
