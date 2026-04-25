/**
 * Database connection, migration, and seeding.
 */

import { config as loadDotEnv } from 'dotenv';

// Override DATABASE_URL from .env so a system-level DATABASE_URL from another
// project (e.g. SQL Server) doesn't silently switch us to SQLite mode.
loadDotEnv({ override: true });

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema-sqlite';
import * as pgSchema from './schema-postgres';
import { mkdirSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';

// ── Environment ─────────────────────────────────────────────────────────────

const databaseUrl = Bun.env.DATABASE_URL;
const dataDir = Bun.env.DATA_DIR || './data';
const dbPath = `${dataDir}/db/autokube.db`;

export const isPostgres =
	!!databaseUrl &&
	(databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'));
export const isSqlite = !isPostgres;
export const DB_TYPE: 'postgres' | 'sqlite' = isPostgres ? 'postgres' : 'sqlite';

// ── Connection ──────────────────────────────────────────────────────────────

type DrizzleDB = ReturnType<typeof drizzle>;
let db: DrizzleDB;

if (isPostgres) {
	const client = postgres(databaseUrl!);
	db = drizzlePg(client, { schema: pgSchema }) as unknown as DrizzleDB;
} else {
	try {
		mkdirSync(dirname(dbPath), { recursive: true });
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
			console.error('Failed to create db directory:', err);
	}

	const sqlite = new Database(dbPath);
	sqlite.exec('PRAGMA journal_mode = WAL');
	db = drizzle(sqlite, { schema });
}

export { db };
export { eq, and, or, desc, asc, like, sql, inArray, isNull, isNotNull } from 'drizzle-orm';
export * from './schema';

// ── Logging ─────────────────────────────────────────────────────────────────

const SEPARATOR = '─'.repeat(60);

const log = {
	step: (msg: string) => console.log(`  ◦ ${msg}`),
	ok: (msg: string) => console.log(`  ✓ ${msg}`),
	fail: (msg: string) => console.error(`  ✗ ${msg}`),
	banner: (title: string) => {
		console.log('\n' + SEPARATOR);
		console.log(`  ${title}`);
	},
	end: () => console.log(SEPARATOR + '\n')
};

/** Format an unknown error into a string message. */
function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ── System Roles ────────────────────────────────────────────────────────────

interface SystemRole {
	name: string;
	description: string;
	permissions: Record<string, string[]>;
}

const SYSTEM_ROLES: readonly SystemRole[] = [
	{
		name: 'Admin',
		description: 'Full access to all resources',
		permissions: {
			// System
			settings: ['view', 'edit'],
			users: ['view', 'create', 'edit', 'delete'],
			clusters: ['view', 'create', 'edit', 'delete'],
			audit_logs: ['view', 'export'],
			notifications: ['view', 'edit'],
			license: ['view', 'edit'],
			activity: ['view'],
			// Cluster / Kubernetes
			pods: ['view', 'create', 'delete', 'exec', 'logs'],
			deployments: ['view', 'create', 'edit', 'delete', 'scale', 'restart'],
			jobs: ['view', 'create', 'delete'],
			services: ['view', 'create', 'edit', 'delete'],
			ingress: ['view', 'create', 'edit', 'delete'],
			gateway: ['view', 'create', 'edit', 'delete'],
			config: ['view', 'create', 'edit', 'delete'],
			volumes: ['view', 'create', 'edit', 'delete'],
			nodes: ['view', 'cordon', 'drain'],
			namespaces: ['view', 'create', 'delete'],
			events: ['view'],
			access_control: ['view', 'edit'],
			custom_resources: ['view', 'create', 'edit', 'delete']
		}
	},
	{
		name: 'Operator',
		description: 'Can manage workloads and view all resources',
		permissions: {
			// System
			settings: ['view'],
			users: ['view'],
			clusters: ['view'],
			audit_logs: ['view'],
			notifications: ['view'],
			license: ['view'],
			activity: ['view'],
			// Cluster / Kubernetes
			pods: ['view', 'create', 'delete', 'exec', 'logs'],
			deployments: ['view', 'create', 'edit', 'delete', 'scale', 'restart'],
			jobs: ['view', 'create', 'delete'],
			services: ['view', 'create', 'edit', 'delete'],
			ingress: ['view', 'create', 'edit', 'delete'],
			gateway: ['view', 'create', 'edit', 'delete'],
			config: ['view', 'create', 'edit'],
			volumes: ['view', 'create', 'edit'],
			nodes: ['view', 'cordon'],
			namespaces: ['view'],
			events: ['view'],
			access_control: ['view'],
			custom_resources: ['view', 'create', 'edit']
		}
	},
	{
		name: 'Viewer',
		description: 'Read-only access to all resources',
		permissions: {
			// System
			settings: [],
			users: [],
			clusters: ['view'],
			audit_logs: [],
			notifications: ['view'],
			license: [],
			activity: ['view'],
			// Cluster / Kubernetes
			pods: ['view', 'logs'],
			deployments: ['view'],
			jobs: ['view'],
			services: ['view'],
			ingress: ['view'],
			gateway: ['view'],
			config: ['view'],
			volumes: ['view'],
			nodes: ['view'],
			namespaces: ['view'],
			events: ['view'],
			access_control: ['view'],
			custom_resources: ['view']
		}
	}
];

// ── Initialization ──────────────────────────────────────────────────────────

/** Run Drizzle migrations (SQLite) then seed system roles. */
export async function initializeDatabase(): Promise<void> {
	log.banner('Initializing database…');

	if (isSqlite) {
		const migrationsFolder = join(process.cwd(), 'drizzle/sqlite');
		const backupPath = `${dbPath}.pre-migrate`;

		if (existsSync(dbPath)) {
			copyFileSync(dbPath, backupPath);
			log.step('Created pre-migration backup');
		}

		try {
			migrate(db, { migrationsFolder });
			log.step('Migrations applied');
			if (existsSync(backupPath)) unlinkSync(backupPath);
		} catch (error) {
			handleMigrationFailure(backupPath, error);
		}
	}

	await seedDatabase();
}

/** Restore from backup on migration failure, then re-throw. */
function handleMigrationFailure(backupPath: string, error: unknown): never {
	log.fail(`Migration failed: ${errorMessage(error)}`);

	if (existsSync(backupPath)) {
		try {
			copyFileSync(backupPath, dbPath);
			log.step('Restored database from pre-migration backup');
		} catch (restoreError) {
			log.fail(`Failed to restore backup: ${errorMessage(restoreError)}`);
		}
	} else {
		log.fail('No backup available to restore');
	}

	throw error;
}

/** Create or update system roles with the canonical permission sets. */
export async function seedDatabase(): Promise<void> {
	log.banner('Seeding database…');

	const existing = await db.select().from(schema.roles);

	if (existing.length === 0) {
		await db.insert(schema.roles).values(
			SYSTEM_ROLES.map((role) => ({
				name: role.name,
				description: role.description,
				isSystem: true,
				permissions: JSON.stringify(role.permissions)
			}))
		);
		log.step('Created system roles');
	} else {
		const now = new Date().toISOString();

		for (const role of SYSTEM_ROLES) {
			await db
				.update(schema.roles)
				.set({ permissions: JSON.stringify(role.permissions), updatedAt: now })
				.where(eq(schema.roles.name, role.name));
		}
		log.step('Updated system role permissions');
	}

	// Seed auth_settings singleton if missing
	const [authRow] = await db.select().from(schema.authSettings).limit(1);
	if (!authRow) {
		await db.insert(schema.authSettings).values({
			authEnabled: false,
			defaultProvider: 'local',
			sessionTimeout: 86400
		});
		log.step('Created default auth settings');
	}

	log.ok(`Database initialized (${isPostgres ? 'PostgreSQL' : 'SQLite'})`);
	log.end();
}
