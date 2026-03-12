/**
 * SSH Key Operations
 * Database operations for managing SSH key pairs
 */

import { db, eq, asc, sshKeys, type SshKey } from '../db';
import { encrypt, decrypt } from '../helpers';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Decrypt the private-key column of a raw row. */
function mapSshKeyRow(row: typeof sshKeys.$inferSelect): SshKey {
	return { ...row, privateKey: decrypt(row.privateKey) || '' };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listSshKeys(): Promise<SshKey[]> {
	const rows = await db.select().from(sshKeys).orderBy(asc(sshKeys.createdAt));
	return rows.map(mapSshKeyRow);
}

export async function findSshKey(id: number): Promise<SshKey | undefined> {
	const [row] = await db.select().from(sshKeys).where(eq(sshKeys.id, id));
	return row ? mapSshKeyRow(row) : undefined;
}

export async function insertSshKey(input: {
	name: string;
	description?: string;
	keyType: 'ed25519' | 'rsa';
	publicKey: string;
	privateKey: string;
	fingerprint: string;
}): Promise<SshKey> {
	const [row] = await db
		.insert(sshKeys)
		.values({
			name: input.name,
			description: input.description,
			keyType: input.keyType,
			publicKey: input.publicKey,
			privateKey: encrypt(input.privateKey) || '',
			fingerprint: input.fingerprint
		})
		.returning();

	return mapSshKeyRow(row);
}

export async function patchSshKey(
	id: number,
	input: { name?: string; description?: string }
): Promise<SshKey | undefined> {
	const [row] = await db
		.update(sshKeys)
		.set({
			name: input.name,
			description: input.description,
			updatedAt: new Date().toISOString()
		})
		.where(eq(sshKeys.id, id))
		.returning();

	return row ? mapSshKeyRow(row) : undefined;
}

export async function destroySshKey(id: number): Promise<void> {
	await db.delete(sshKeys).where(eq(sshKeys.id, id));
}
