#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

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
