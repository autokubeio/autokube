import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { makeClusterRequest, testConnectionCredentials } from '$lib/server/services/kubernetes';
import { authorize } from '$lib/server/services/authorize';

/**
 * POST /api/clusters/test-connection
 * Test cluster connection - supports both existing clusters and new credentials
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const body = await request.json();
		const {
			clusterId,
			authType,
			kubeconfig,
			context,
			apiServer,
			bearerToken,
			tlsSkipVerify,
			agentToken
		} = body;

		// Test existing cluster by ID
		if (clusterId) {
			const result = await makeClusterRequest<{ major: string; minor: string }>(
				clusterId,
				'/version',
				10000
			);

			if (result.success && result.data) {
				const version =
					result.data.major && result.data.minor
						? `${result.data.major}.${result.data.minor}`
						: 'Unknown';

				return json({
					success: true,
					version,
					message: 'Connection successful'
				});
			}

			return json({
				success: false,
				error: result.error ?? 'Connection failed'
			});
		}

		// Test new connection with provided credentials
		if (!authType) {
			return json({
				success: false,
				error: 'Either clusterId or authType must be provided'
			});
		}

		const result = await testConnectionCredentials({
			authType,
			kubeconfig,
			context,
			apiServer,
			bearerToken,
			tlsSkipVerify,
			agentToken
		});

		if (result.success && result.data) {
			return json({
				success: true,
				version: result.data.version,
				message: 'Connection successful'
			});
		}

		return json({
			success: false,
			error: result.error ?? 'Connection failed'
		});
	} catch (error) {
		console.error('[API] Test connection error:', error);
		return json({
			success: false,
			error: error instanceof Error ? error.message : 'Unexpected error'
		});
	}
};
