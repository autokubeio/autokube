/** Enterprise license validation and management using RSA-SHA256 signatures. */

import crypto from 'node:crypto';
import os from 'node:os';
import { getSetting, setSetting } from '../queries';

// ── Types ───────────────────────────────────────────────────────────────────

export type LicenseType = 'enterprise' | 'professional';

export interface LicensePayload {
	name: string;
	host: string;
	issued: string;
	expires: string | null;
	type: LicenseType;
	v?: number;
}

export interface LicenseValidation {
	valid: boolean;
	active: boolean;
	payload?: LicensePayload;
	error?: string;
}

export interface StoredLicense {
	name: string;
	key: string;
	activatedAt: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const LICENSE_SETTING_KEY = 'enterprise_license';

/**
 * RSA public key for license signature verification.
 * The corresponding private key is kept secure and used only for license generation.
 */
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAgccL8JoTF0YrRTmc3Gx8
WuYU//fRvgUSTYVKKsNERXOcrE4ifHwfQGWLfs0UacxrigkrmK5ADpKfNPgUTf/M
4f//haueoLwZI31heED8PlXYDtk9hZfvCSACQynymUx0mbxhUJDITfGYqPf69DiQ
BLGZ4GuRrbNeHbxJoiyjErIRfWIvLvkqhp2/vW1i0YS2DN3jgiwL1dmxeRt/8jRM
JAAfRvu6u+/RpOwWRpQ21LUkWNAO+pZLHxD3XCWNA0od5RvYmnojO85gr2P3YDax
99bBgAnXLrnyOdECMhXCrTt5YUDHdcBQ54nEEcVPSX1oGnTbuC5ucNQRW7GNTHiH
jwIDAQAB
-----END PUBLIC KEY-----`;

// ── License Validation ──────────────────────────────────────────────────────

/**
 * Get the current hostname for license validation.
 * Uses AUTOKUBE_HOSTNAME env var if set (for Docker), otherwise falls back to os.hostname().
 */
export function getHostname(): string {
	return process.env.AUTOKUBE_HOSTNAME || os.hostname();
}

/**
 * Validate a license key using RSA-SHA256 signature verification.
 *
 * @param licenseKey The license key in format: base64url(payload).base64url(signature)
 * @param hostname Optional hostname to validate against (defaults to current hostname)
 * @returns Validation result with payload if valid
 */
export function validateLicenseKey(licenseKey: string, hostname?: string): LicenseValidation {
	try {
		// Clean the license key - remove whitespace and newlines
		const cleanKey = licenseKey.replace(/\s+/g, '');

		// Parse license format: payload.signature
		const parts = cleanKey.split('.');
		if (parts.length !== 2) {
			return {
				valid: false,
				active: false,
				error: 'Invalid license format - expected payload.signature'
			};
		}

		const [payloadBase64, signatureBase64] = parts;

		// Verify RSA-SHA256 signature
		const verifier = crypto.createVerify('RSA-SHA256');
		verifier.update(payloadBase64);
		const isSignatureValid = verifier.verify(LICENSE_PUBLIC_KEY, signatureBase64, 'base64url');

		if (!isSignatureValid) {
			return { valid: false, active: false, error: 'Invalid license signature' };
		}

		// Decode and parse payload
		const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
		const payload = JSON.parse(payloadJson) as LicensePayload;

		// Check expiration
		if (payload.expires) {
			const expiryDate = new Date(payload.expires);
			if (expiryDate < new Date()) {
				return {
					valid: false,
					active: false,
					error: `License expired on ${expiryDate.toLocaleDateString()}`,
					payload
				};
			}
		}

		// Validate hostname
		const currentHost = hostname || getHostname();
		if (payload.host !== '*') {
			const isHostValid =
				payload.host === currentHost ||
				(payload.host.startsWith('*.') && currentHost.endsWith(payload.host.slice(1)));

			if (!isHostValid) {
				return {
					valid: false,
					active: false,
					error: `License not valid for host "${currentHost}" (licensed for "${payload.host}")`,
					payload
				};
			}
		}

		return { valid: true, active: true, payload };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		return { valid: false, active: false, error: `License validation failed: ${message}` };
	}
}

// ── License Storage ─────────────────────────────────────────────────────────

/**
 * Retrieve the currently stored license from the database.
 */
export async function getStoredLicense(): Promise<StoredLicense | null> {
	const stored = await getSetting(LICENSE_SETTING_KEY);
	return stored as StoredLicense | null;
}

/**
 * Activate and store a license key after validation.
 *
 * @param name License holder name (must match the license)
 * @param key License key to activate
 * @returns Success status and stored license or error message
 */
export async function activateLicense(
	name: string,
	key: string
): Promise<{ success: boolean; license?: StoredLicense; error?: string }> {
	// Clean and trim inputs
	const cleanName = name.trim();
	const cleanKey = key.replace(/\s+/g, '');

	if (!cleanName) {
		return { success: false, error: 'License name is required' };
	}

	if (!cleanKey) {
		return { success: false, error: 'License key is required' };
	}

	// Validate the license
	const validation = validateLicenseKey(cleanKey, getHostname());

	if (!validation.valid) {
		return { success: false, error: validation.error || 'License validation failed' };
	}

	// Verify name matches
	if (validation.payload && validation.payload.name !== cleanName) {
		return {
			success: false,
			error: `License name mismatch. Expected "${validation.payload.name}", received "${cleanName}"`
		};
	}

	// Store the license
	const license: StoredLicense = {
		name: cleanName,
		key: cleanKey,
		activatedAt: new Date().toISOString()
	};

	await setSetting(LICENSE_SETTING_KEY, license);

	return { success: true, license };
}

/**
 * Remove the currently stored license.
 */
export async function deactivateLicense(): Promise<boolean> {
	await setSetting(LICENSE_SETTING_KEY, null);
	return true;
}

// ── License Status Queries ──────────────────────────────────────────────────

/**
 * Get the full license status including validation state.
 */
export async function getLicenseStatus(): Promise<LicenseValidation & { stored?: StoredLicense }> {
	const stored = await getStoredLicense();

	if (!stored?.key) {
		return { valid: false, active: false, error: 'No license installed' };
	}

	const validation = validateLicenseKey(stored.key, getHostname());
	return { ...validation, stored };
}

/**
 * Check if enterprise features are enabled.
 * Only returns true for active enterprise licenses (not professional).
 */
export async function isEnterpriseEnabled(): Promise<boolean> {
	const status = await getLicenseStatus();
	return status.valid && status.active && status.payload?.type === 'enterprise';
}

/**
 * Get the current license type if a valid license is active.
 */
export async function getLicenseType(): Promise<LicenseType | null> {
	const status = await getLicenseStatus();
	return status.valid && status.active && status.payload ? status.payload.type : null;
}

/**
 * Get days until license expiration (returns null if no expiry or invalid license).
 */
export async function getDaysUntilExpiry(): Promise<number | null> {
	const status = await getLicenseStatus();

	if (!status.valid || !status.active || !status.payload?.expires) {
		return null;
	}

	const expiryDate = new Date(status.payload.expires);
	const now = new Date();
	const millisecondsPerDay = 1000 * 60 * 60 * 24;
	const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / millisecondsPerDay);

	return daysRemaining > 0 ? daysRemaining : 0;
}
