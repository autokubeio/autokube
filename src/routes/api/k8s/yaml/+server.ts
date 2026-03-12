import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getResourceYaml, updateResourceYaml } from '$lib/server/services/kubernetes/yaml-ops';
import { findCluster } from '$lib/server/queries/clusters';
import { buildApiPath } from '$lib/server/services/kubernetes/resource-paths';
import { authorize } from '$lib/server/services/authorize';

export const GET: RequestHandler = async ({ url, cookies}) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('clusters', 'read')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}
	try {
		const clusterIdParam = url.searchParams.get('cluster');
		const resourceType = url.searchParams.get('resourceType');
		const resourceName = url.searchParams.get('name');
		const namespace = url.searchParams.get('namespace');
		
		if (!clusterIdParam) {
			return json({ 
				success: false, 
				error: 'Cluster ID is required' 
			}, { status: 400 });
		}

		if (!resourceType) {
			return json({ 
				success: false, 
				error: 'Resource type is required' 
			}, { status: 400 });
		}

		if (!resourceName) {
			return json({ 
				success: false, 
				error: 'Resource name is required' 
			}, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ 
				success: false, 
				error: 'Invalid cluster ID' 
			}, { status: 400 });
		}

		// Load cluster from database
		const cluster = await findCluster(clusterId);
		
		if (!cluster) {
			return json({ 
				success: false, 
				error: 'Cluster not found' 
			}, { status: 404 });
		}

		// Build API path for the resource
		try {
			const apiPath = buildApiPath(resourceType, resourceName, namespace || undefined);
			
			// Fetch resource YAML from cluster
			const result = await getResourceYaml(clusterId, apiPath);
			
			return json(result);
		} catch (error) {
			return json({ 
				success: false, 
				error: error instanceof Error ? error.message : 'Failed to build API path' 
			}, { status: 400 });
		}
	} catch (error) {
		console.error('Error fetching resource YAML:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Failed to fetch resource YAML' },
			{ status: 500 }
		);
	}
};

export const PUT: RequestHandler = async ({ url, request }) => {
	try {
		const clusterIdParam = url.searchParams.get('cluster');
		const resourceType = url.searchParams.get('resourceType');
		const resourceName = url.searchParams.get('name');
		const namespace = url.searchParams.get('namespace');
		
		if (!clusterIdParam) {
			return json({ 
				success: false, 
				error: 'Cluster ID is required' 
			}, { status: 400 });
		}

		if (!resourceType) {
			return json({ 
				success: false, 
				error: 'Resource type is required' 
			}, { status: 400 });
		}

		if (!resourceName) {
			return json({ 
				success: false, 
				error: 'Resource name is required' 
			}, { status: 400 });
		}

		const clusterId = parseInt(clusterIdParam);
		if (isNaN(clusterId)) {
			return json({ 
				success: false, 
				error: 'Invalid cluster ID' 
			}, { status: 400 });
		}

		// Parse request body
		const body = await request.json();
		const { yaml } = body;

		if (!yaml) {
			return json({ 
				success: false, 
				error: 'YAML content is required' 
			}, { status: 400 });
		}

		// Load cluster from database
		const cluster = await findCluster(clusterId);
		
		if (!cluster) {
			return json({ 
				success: false, 
				error: 'Cluster not found' 
			}, { status: 404 });
		}

		// Build API path for the resource
		try {
			const apiPath = buildApiPath(resourceType, resourceName, namespace || undefined);
			
			// Update resource YAML in cluster
			const result = await updateResourceYaml(clusterId, apiPath, yaml);
			
			return json(result);
		} catch (error) {
			return json({ 
				success: false, 
				error: error instanceof Error ? error.message : 'Failed to build API path' 
			}, { status: 400 });
		}
	} catch (error) {
		console.error('Error updating resource YAML:', error);
		return json(
			{ success: false, error: error instanceof Error ? error.message : 'Failed to update resource YAML' },
			{ status: 500 }
		);
	}
};
