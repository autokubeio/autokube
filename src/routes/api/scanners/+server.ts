import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import {
	getScannerBinPath,
	getScannerVersion,
	installScanner,
	removeScanner,
	SCANNERS_DIR
} from '$lib/server/services/image-scanner';
import { existsSync } from 'node:fs';

export interface ScannerInfo {
	name: string;
	id: string;
	installed: boolean;
	version: string | null;
	installing: boolean;
}

/** GET — list scanners with their install status */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const scannerList: ScannerInfo[] = [];
	for (const id of ['grype', 'trivy'] as const) {
		const binPath = getScannerBinPath(id);
		const installed = existsSync(binPath);
		let version: string | null = null;
		if (installed) {
			version = await getScannerVersion(id);
		}
		scannerList.push({
			name: id === 'grype' ? 'Grype' : 'Trivy',
			id,
			installed,
			version,
			installing: false
		});
	}

	return json({ scanners: scannerList });
};

/** POST — install or remove a scanner binary */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	const body = await request.json();
	const { action, scanner } = body as { action: string; scanner: string };

	if (!['grype', 'trivy'].includes(scanner)) {
		return json({ error: 'Unknown scanner' }, { status: 400 });
	}

	const scannerId = scanner as 'grype' | 'trivy';

	if (action === 'install') {
		try {
			await installScanner(scannerId);
			const version = await getScannerVersion(scannerId);
			return json({ success: true, message: `${scanner} installed successfully`, version });
		} catch (err) {
			return json({ error: err instanceof Error ? err.message : 'Install failed' }, { status: 500 });
		}
	}

	if (action === 'remove') {
		try {
			await removeScanner(scannerId);
			return json({ success: true, message: `${scanner} removed` });
		} catch (err) {
			return json({ error: err instanceof Error ? err.message : 'Remove failed' }, { status: 500 });
		}
	}

	if (action === 'check') {
		const binPath = getScannerBinPath(scannerId);
		const installed = existsSync(binPath);
		const version = installed ? await getScannerVersion(scannerId) : null;
		return json({ installed, version });
	}

	return json({ error: 'Invalid action. Use install, remove, or check.' }, { status: 400 });
};
