import { defineConfig } from 'drizzle-kit';

const dataDir = process.env.DATA_DIR || './data';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema-sqlite.ts',
	out: './drizzle/sqlite',
	dbCredentials: { url: `file:${dataDir}/db/autokube.db` }
});
