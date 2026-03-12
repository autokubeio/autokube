import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Load .env file, overriding any shell-level env vars (e.g. DATABASE_URL from another project)
loadEnv({ override: true });

const databaseUrl = process.env.DATABASE_URL;
const dataDir = process.env.DATA_DIR || './data';
const isPostgres =
	!!databaseUrl &&
	(databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'));

export default isPostgres
	? defineConfig({
			dialect: 'postgresql',
			schema: './src/lib/server/db/schema-postgres.ts',
			out: './drizzle/pg',
			dbCredentials: { url: databaseUrl! }
		})
	: defineConfig({
			dialect: 'sqlite',
			schema: './src/lib/server/db/schema-sqlite.ts',
			out: './drizzle/sqlite',
			dbCredentials: { url: `file:${dataDir}/db/autokube.db` }
		});
