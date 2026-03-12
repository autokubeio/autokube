import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getLicenseStatus,
	activateLicense,
	deactivateLicense,
	isEnterpriseEnabled,
	getDaysUntilExpiry,
	getHostname,
	type StoredLicense,
	type LicenseValidation
} from '$lib/server/services/license';
import { authorize } from '$lib/server/services/authorize';

// ── Types ───────────────────────────────────────────────────────────────────

interface LicenseStatusResponse extends LicenseValidation {
	stored?: StoredLicense;
	isEnterprise: boolean;
	daysUntilExpiry?: number | null;
	hostname: string;
}

interface LicenseActivationRequest {
	name: string;
	key: string;
}

interface LicenseActivationResponse {
	success: boolean;
	license?: StoredLicense;
	error?: string;
}

// ── GET /api/license ────────────────────────────────────────────────────────

/**
 * Get the current license status and details.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('license', 'view')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const status = await getLicenseStatus();
		const isEnterprise = await isEnterpriseEnabled();
		const daysUntilExpiry = await getDaysUntilExpiry();
		const hostname = getHostname();

		return json({
			...status,
			isEnterprise,
			daysUntilExpiry,
			hostname
		} satisfies LicenseStatusResponse);
	} catch (error) {
		console.error('[License API] Failed to get license status:', error);

		return json(
			{
				valid: false,
				active: false,
				isEnterprise: false,
				hostname: getHostname(),
				error: 'Failed to retrieve license status'
			} satisfies LicenseStatusResponse,
			{ status: 500 }
		);
	}
};

// ── POST /api/license ───────────────────────────────────────────────────────

/**
 * Activate a new license.
 */
export const POST: RequestHandler = async ({ request, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('license', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = (await request.json()) as LicenseActivationRequest;

		// Validate request body
		if (!body.name || typeof body.name !== 'string') {
			return json(
				{ success: false, error: 'License name is required' } satisfies LicenseActivationResponse,
				{ status: 400 }
			);
		}

		if (!body.key || typeof body.key !== 'string') {
			return json(
				{ success: false, error: 'License key is required' } satisfies LicenseActivationResponse,
				{ status: 400 }
			);
		}

		// Activate the license
		const result = await activateLicense(body.name, body.key);

		if (!result.success) {
			return json(result satisfies LicenseActivationResponse, { status: 400 });
		}

		console.log(`[License API] License activated for "${body.name}"`);

		return json(result satisfies LicenseActivationResponse, { status: 200 });
	} catch (error) {
		console.error('[License API] Failed to activate license:', error);

		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{
				success: false,
				error: `Failed to activate license: ${message}`
			} satisfies LicenseActivationResponse,
			{ status: 500 }
		);
	}
};

// ── DELETE /api/license ─────────────────────────────────────────────────────

/**
 * Deactivate and remove the current license.
 */
export const DELETE: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('license', 'update')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		await deactivateLicense();

		console.log('[License API] License deactivated');

		return json({ success: true });
	} catch (error) {
		console.error('[License API] Failed to deactivate license:', error);

		const message = error instanceof Error ? error.message : 'Unknown error';
		return json(
			{ success: false, error: `Failed to deactivate license: ${message}` },
			{ status: 500 }
		);
	}
};
