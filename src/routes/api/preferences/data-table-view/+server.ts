import { json, type RequestHandler } from '@sveltejs/kit';
import { authorize } from '$lib/server/services/authorize';
import type { ColumnSetting } from '$lib/components/data-table-view/types';
import {
	getDataTableConfigs,
	setDataTableConfig,
	removeDataTableConfig,
	resetDataTableConfigs
} from '$lib/server/queries/preferences';

// GET - retrieve all data table configs
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	try {
		const userId = auth.authEnabled ? auth.user?.id : undefined;
		const dataTableConfigs = await getDataTableConfigs(userId);

		return json({ preferences: dataTableConfigs });
	} catch (error) {
		console.error('Failed to get data table configs:', error);
		return json({ error: 'Failed to get data table configs' }, { status: 500 });
	}
};

// POST - update data table configs for a specific table
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const body = await request.json();
		const { tableName, columns } = body as { tableName?: string; columns?: ColumnSetting[] };

		if (!tableName || typeof tableName !== 'string') {
			return json({ error: 'tableName is required' }, { status: 400 });
		}

		if (!columns || !Array.isArray(columns)) {
			return json({ error: 'columns array is required' }, { status: 400 });
		}

		// Validate column structure
		for (const col of columns) {
			if (typeof col.id !== 'string' || typeof col.visible !== 'boolean') {
				return json(
					{ error: 'Each column must have id (string) and visible (boolean)' },
					{ status: 400 }
				);
			}
		}

		const userId = auth.authEnabled ? auth.user?.id : undefined;
		await setDataTableConfig(tableName, { columns }, userId);

		const dataTableConfigs = await getDataTableConfigs(userId);
		return json({ preferences: dataTableConfigs });
	} catch (error) {
		console.error('Failed to save data table configs:', error);
		return json({ error: 'Failed to save data table configs' }, { status: 500 });
	}
};

// DELETE - reset data table configs (single table or all)
export const DELETE: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const tableName = url.searchParams.get('tableName');
		const userId = auth.authEnabled ? auth.user?.id : undefined;

		if (tableName) {
			await removeDataTableConfig(tableName, userId);
		} else {
			await resetDataTableConfigs(userId);
		}

		const dataTableConfigs = await getDataTableConfigs(userId);
		return json({ preferences: dataTableConfigs });
	} catch (error) {
		console.error('Failed to reset data table configs:', error);
		return json({ error: 'Failed to reset data table configs' }, { status: 500 });
	}
};

