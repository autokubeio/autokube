/**
 * Example: Using 3 Kubernetes Authentication Methods
 *
 * This file demonstrates how to connect to Kubernetes clusters using:
 * 1. Kubeconfig (direct connection)
 * 2. Bearer Token (direct connection with API server + token)
 * 3. AutoKube Agent (proxied connection through in-cluster agent)
 */

import {
	parseKubeconfig,
	createBearerTokenConnection,
	createAgentConnection,
	buildConnectionConfig,
	k8sRequest,
	withConnection,
	type ConnectionConfig,
	type ListPodsResult
} from '$lib/server/services/kubernetes';

// ─── Example 1: Using Kubeconfig ────────────────────────────────────────────

async function exampleKubeconfig() {
	const kubeconfigContent = `
apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURCVENDQWUyZ0F3SUJBZ0lJVFR0c0xXaWF3djB3RFFZSktvWklodmNOQVFFTEJRQXdGVEVUTUJFR0ExVUUKQXhNS2EzVmlaWEp1WlhSbGN6QWVGdzB5TmpBeU1qWXhOekEzTVRKYUZ3MHpOakF5TWpReE56RXlNVEphTUJVeApFekFSQmdOVkJBTVRDbXQxWW1WeWJtVjBaWE13Z2dFaU1BMEdDU3FHU0liM0RRRUJBUVVBQTRJQkR3QXdnZ0VLCkFvSUJBUUMyQ3djTDRBamdBVXJ3azNYTnJEVnNvMnJINGs3bEwzaW5ML0xMeFV3eFZJWTA1WDlvcUQ1L3A2dVMKNVd3M0JOQ2w0SVJyUHFxOHVoalVDSkwxNzZJcFhPcGRTL1I0bDVKWVJxb05sYURaN053YVVjSVZ3VVlKYm5PdApNT0pCaWFOek9rdVluQlFGOFIwbEJzdzZmaTdzSi9RVE5qK3BuSW1uN0Y3b1JXc09hYjhZMUo1N1ZiWHhXZ2c0CmVZRUxFdUFIaWZqbkZlL3F2dkI4TGw3YUtoLzhVTXgzT1BFZWVqSWttSVNnc1A4TTFScDQ3b05aUEpUVllUcUMKa0ZJN1BCRnMxclk4UFlXTVhGU2M2VDUwQ2s1anprVmJVSzZyNG5qMCtoQnpOUTFNTXpSaU9EY1ZHMEc5bmNUNQo4VlAxRXMveitXbU1yTVlwMTBBR244Rkh5VFZsQWdNQkFBR2pXVEJYTUE0R0ExVWREd0VCL3dRRUF3SUNwREFQCkJnTlZIUk1CQWY4RUJUQURBUUgvTUIwR0ExVWREZ1FXQkJROVFndlFZOVpIZE5zL2NTREN2TlAwN1pkYzNqQVYKQmdOVkhSRUVEakFNZ2dwcmRXSmxjbTVsZEdWek1BMEdDU3FHU0liM0RRRUJDd1VBQTRJQkFRQnF2c08yZGszUgphM2p6RXZ4L0VQeDNVaDhPVjdDa2V3SVZnSlpSVnpzSVRuVHJyaFNPcGNHWko3cmdOVE1VbXhncTBPT0Z2V1l5ClVHbjFhMlJYTVJnWWNHMHRqdmpyRVRSWEpQRmI1NEJ6MEdibjRGZzNYRG85cWRKZW5EK3lBUEVwTTY1Q1RLYmoKbW1MWncvc2JxUlRrYWRNSUhTYTZpSkhnbndFb0l0UU8rMklWSTZyaXNCQ2FkblptSEF2ZGNFekRTTVlqRlAxagp1SDFRblA4MDRJOUhsY2tEYVFGRmt4VmR2c1hNZnN5MDZxQlRxMXlNbW1CUHRmRkcvZVJJRzczWkxXbnVGeXhZClJ1YVRQOXMrWWgxV0RkVGJ2L3RtVVpjYXh0dFFRdVIzQ0ZTZ2FkKzdDWGlYY0c1aXYrZjFoSWVaSXBEMTNSR2wKN2xwVHZXSXQ4ZURWCi0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K
    server: https://127.0.0.1:55020
  name: docker-desktop
contexts:
- context:
    cluster: docker-desktop
    user: docker-desktop
  name: docker-desktop
current-context: docker-desktop
kind: Config
preferences: {}
users:
- name: docker-desktop
  user:
    client-certificate-data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURLVENDQWhHZ0F3SUJBZ0lJZDZsdlRZMFhQTnd3RFFZSktvWklodmNOQVFFTEJRQXdGVEVUTUJFR0ExVUUKQXhNS2EzVmlaWEp1WlhSbGN6QWVGdzB5TmpBeU1qWXhOekEzTVRKYUZ3MHlOekF5TWpZeE56RXlNVEphTUR3eApIekFkQmdOVkJBb1RGbXQxWW1WaFpHMDZZMngxYzNSbGNpMWhaRzFwYm5NeEdUQVhCZ05WQkFNVEVHdDFZbVZ5CmJtVjBaWE10WVdSdGFXNHdnZ0VpTUEwR0NTcUdTSWIzRFFFQkFRVUFBNElCRHdBd2dnRUtBb0lCQVFDaWRpcHgKMHJhdmNaMkErYTFmbnFIOEFtem90akJxT1M5UmloNUxmKzVzQUdnU29pbVEzT2NCNXhKS3dXV1dUYUFsYjBmUwpYazUvQzRUVm5CcEZYL2tIbkhxQjdSeTVXM0xrYkh0RWdsOFk5UkZhYmpRKytQbVY1eGtYT3ZaRnlaZGNRTjBwCjdMeGtwMlROTHRPWDlXTTcrVnIrY09ac29XSkQzTFh1TUF6UjJqUkk3VjBIQXhpKy93VEFhd3dKTC8zaVdISmsKSEM2Zk80UElvY1c2R3lGN3NJVVpnZXJtQlRtUjEybUhVOHdhYzY2NWF1OUJQeUQxYkRRbGRRMDlOMWVSRk11cwpmUGIreXBJU1ZobHFKc3R1Nmk3SjhZRW9nOHRBSTQ4VlJ6SU02TmdQZFFvZHk0RkpOWndwYTNPV243b3MyVkx0Cngyam1CbUhNVllZaUNqV2JBZ01CQUFHalZqQlVNQTRHQTFVZER3RUIvd1FFQXdJRm9EQVRCZ05WSFNVRUREQUsKQmdnckJnRUZCUWNEQWpBTUJnTlZIUk1CQWY4RUFqQUFNQjhHQTFVZEl3UVlNQmFBRkQxQ0M5Qmoxa2QwMno5eApJTUs4MC9UdGwxemVNQTBHQ1NxR1NJYjNEUUVCQ3dVQUE0SUJBUUNkNi9maXZzUlRnSmR3VzdIS2h6VE8xSGEyCmlzTVFGelFZRno3QjduUnhyRWN5a2lqNlJzOUxQWkJLWnpiWkFabEl6NkQ4Vi91SXY4aVM0ZVZLL0tELzFRMWIKRnlESW5oM1hwamVZTUlzYnVXY0hQTU9KbnQyUkpIb1ZnSytGUjhwTXBwRmN5OTUwWTREeWhxdHBYUSs0YUtVeApnQnBPR0EzVDZIdTJwWkdid3psMzg5UFUyZ1V6b0xWMFVHSE1Ma0R2ekdrYytwSStmaGJwSEZGbmpLWVJycGRXCmZWdVhDQythcDFXZVZTT296YWltYzlTSVdXZWo3eTRIY0xjZjhSNklZZ0xGdkFTYWcrNC95THR0S2xGRTk4T0oKNitVVEpoU2FWOWhmeDh2cnBXUWY3Z2tIMHVXSllPQkFwNXpNcHpjTnB1Q2h0d0F0alFScDRXNnJ1RFZWCi0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K
    client-key-data: LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFcEFJQkFBS0NBUUVBb25ZcWNkSzJyM0dkZ1BtdFg1NmgvQUpzNkxZd2Fqa3ZVWW9lUzMvdWJBQm9FcUlwCmtOem5BZWNTU3NGbGxrMmdKVzlIMGw1T2Z3dUUxWndhUlYvNUI1eDZnZTBjdVZ0eTVHeDdSSUpmR1BVUldtNDAKUHZqNWxlY1pGenIyUmNtWFhFRGRLZXk4Wktka3pTN1RsL1ZqTy9sYS9uRG1iS0ZpUTl5MTdqQU0wZG8wU08xZApCd01ZdnY4RXdHc01DUy85NGxoeVpCd3VuenVEeUtIRnVoc2hlN0NGR1lIcTVnVTVrZGRwaDFQTUduT3V1V3J2ClFUOGc5V3cwSlhVTlBUZFhrUlRMckh6Mi9zcVNFbFlaYWliTGJ1b3V5ZkdCS0lQTFFDT1BGVWN5RE9qWUQzVUsKSGN1QlNUV2NLV3R6bHArNkxObFM3Y2RvNWdaaHpGV0dJZ28xbXdJREFRQUJBb0lCQVFDV1hvN3NxVjdEeG9KRQo1VlB1WkJLRUFlNngraWVYdWZRdElZem16ck5zTFhnbWZ3ZS8rR2Fzb1NhU0lLMFpVQ0lCWkIxeS9pempkRkx2CnI3dTFLSjZEeC9hd0dUcHo2Y3ZPMXdYRkpISkcxRlhLZ0tSRkFRZHFFdXRyVC95d0hXWEdVcGNoL2VkbHRuWWIKWDlNakhGSk1LWUZxYmk4b3Jyc1lHc29kZTBYeVdPM0pQeStCQi9MYjhIcTJ0bUhQbHZsb1RCWFFycnBVQktzagp0Z3FzcDJlMW9JczdLVXFWUTJzTDBMVUViOXlmc0d3Z0lVb2x1TmFGRkhlL3lXZDBuMmRvbHJNdjV5UFNzV2xEClc5d0lCTDNHcU9IOWtRb2FIMUVhcHhOUVdEanVzRE1vL0cxL0kweGpUeTFnajNkMjAxd2NRaFluVXc0NUJ1aVMKeHFFU2hNamhBb0dCQU5oek5rWm1CaDdZNE1MZXduMjE3SnU5T0Vrby90N1FhczVaemhFK0p5TlZhMW4wZVJZLwpFTnRXSm9EdGwvaHU5T3BoUHk2bW9qbFY0T2VKM2pGbVI0YmFzU0JvcFF2dmphMDZoNHdxR3ltTVhmVEc2UFRuCmpONzJuSmRZOC92MDJOS2p3S0FBYUF3K2NYNjdPUW9paFNOKzFPYWlxTnYyRE1Pbk5UR09BMENSQW9HQkFNQWwKanpZeUplOU5XcVNmazR1Ry9RQlFFdHpFckY4MFk4azJRTDVlbEZJcHczZGJPSnNQTnBNMzNVQ01DZzc3N1B4SApNd09zVWtlNWJXaFJPUFhBa01Qblllc2tJVy90cVBudytlMHV3WHBrenlaTC80NUhZY0pnR3VwSW9yTWlRaUFZCnRzbmIwWC9wT0h1bFZnS2FidmxhTURnK0dVb3EzNHJJbDBGWFp5bHJBb0dCQUttNUpienI4UzZ0QndrbTNVRHYKcnptcmxRQWhDa0V6RWh6K1pFdzIvVCtDa212MS9DREtrUEE4VEhMYVcwanQwRlFjcnd0b2xGbjdFaURjaFlNYwozVWRNSW9uMEpEOEl0NEkzRytSM2U5Y0hmd0VhRzc4MTljczdleXhlRHVycFlqOUJNaUVFVUpJUlFMT01JVHptCk5wblBzU2VzTWxaUVNFLyt4QUk0aGlwUkFvR0FldmFPVTR4OElreEtlWmQxZ0pEK1Q3anVtVUZ6WGVuVkFlc3EKTzZtakdZR0lpVlZqUURmWUlSWmJEUGVSYUUxb04zb0k5NHpMaXdMck5ScmxiTCt5NU91cUNpU3hFVVB5SXlGSApqN1dnTTRkWDJaWkJFUGcxWTRMRk5yRU5EYjRhdXhlVndsQmVIWkZPaURJaWZMLy96S3NldUo5azU4WFFFS3lWCnYwY0R5Y2tDZ1lCQnMzdEFvL2V5b0UvNTQwSWVXNW50SklPMUsvQjMzNmFSWDJ3UzVCSGxSLytCK3BpdGdzVXYKSkYyRGlURFU2cEwzaE1peEFHSGk5QVlkQXNzVUVVR2dPWm1lNFBIN3drb2F0TmRBTk0ydnJWbnpVelc4Uy83cwpHbDNtVCtqNFVadVlpSkhWVmFVVG5BY0gvUXIwSGpzbDRnci9mRVlBSXI4R291ZnJuZ0UxRVE9PQotLS0tLUVORCBSU0EgUFJJVkFURSBLRVktLS0tLQo=
`;

	try {
		// Parse kubeconfig
		const config = parseKubeconfig(kubeconfigContent);

		// Make API request
		const pods = await k8sRequest<ListPodsResult>(config, '/api/v1/pods', 15000);

		console.log('Pods via kubeconfig:', pods);
	} catch (error) {
		console.error('Kubeconfig error:', error);
	}
}

// ─── Example 2: Using Bearer Token ──────────────────────────────────────────

async function exampleBearerToken() {
	try {
		// Create bearer token connection
		const config = createBearerTokenConnection(
			'https://k8s.example.com:6443', // API server URL
			'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1...', // Bearer token
			'production-cluster', // Cluster name
			{
				skipTLSVerify: false, // Skip TLS verification (not recommended for production)
				ca: 'LS0tLS1CRUdJTi...' // Optional: CA certificate (base64)
			}
		);

		// Make API request
		const namespaces = await k8sRequest(config, '/api/v1/namespaces');

		console.log('Namespaces via bearer token:', namespaces);
	} catch (error) {
		console.error('Bearer token error:', error);
	}
}

// ─── Example 3: Using AutoKube Agent ────────────────────────────────────────

async function exampleAgent() {
	try {
		// Create agent connection
		// Agent connects TO AutoKube (reverse proxy model - no URL needed)
		const config = createAgentConnection(
			'autokube_agent_token_61dd844c9176a6fd1798ae593b3eb637', // Agent token
			'production-cluster' // Cluster name
		);

		// Make API request (proxied through agent)
		const deployments = await k8sRequest(config, '/apis/apps/v1/namespaces/default/deployments');

		console.log('Deployments via agent:', deployments);
	} catch (error) {
		console.error('Agent error:', error);
	}
}

// ─── Example 4: Using Database Cluster Record ───────────────────────────────

async function exampleFromDatabase() {
	// Simulate cluster record from database
	const clusterRecord = {
		name: 'production-cluster',
		authType: 'agent' as const,
		agentUrl: null, // Not used - agent connects TO AutoKube
		agentToken: 'autokube_agent_token_xxx',
		apiServer: null,
		kubeconfig: null,
		context: null,
		bearerToken: null,
		tlsCa: null,
		tlsSkipVerify: false
	};

	try {
		// Build connection config from database record
		// Automatically detects auth type and creates appropriate config
		const config = buildConnectionConfig(clusterRecord);

		// Use with generic connection wrapper
		const result = await withConnection(config, async (conn) => {
			return k8sRequest(conn, '/api/v1/nodes');
		});

		if (result.success) {
			console.log('Nodes:', result.data);
		} else {
			console.error('Error:', result.error);
		}
	} catch (error) {
		console.error('Database cluster error:', error);
	}
}

// ─── Example 5: High-Level API Usage ────────────────────────────────────────

import { listPods } from '$lib/server/services/kubernetes';

async function exampleHighLevelAPI() {
	// When using high-level functions, they use makeClusterRequest internally
	// which supports all three connection types (kubeconfig, bearer-token, agent)

	const clusterId = 1; // Database cluster ID

	// List pods in a specific namespace
	const podsResult = await listPods(clusterId, 'default');
	if (podsResult.success) {
		console.log('Pods:', podsResult.pods);
	}

	// List all pods across all namespaces
	const allPodsResult = await listPods(clusterId, 'all');
	if (allPodsResult.success) {
		console.log('All Pods:', allPodsResult.pods);
	}
}

// ─── Example 6: Agent Installation ──────────────────────────────────────────

/**
 * To install AutoKube agent in your cluster:
 *
 * 1. Configure in AutoKube UI:
 *    - Go to Settings → Clusters → Add Cluster
 *    - Select "AutoKube Agent" as auth type
 *    - Enter cluster name
 *    - Token is auto-generated
 *
 * 2. Copy Helm command from AutoKube UI:
 *    helm repo add autokube https://charts.autokube.io
 *    helm install autokube-agent autokube/autokube-agent \
 *      --namespace autokube-system \
 *      --create-namespace \
 *      --set url=https://autokube.io \
 *      --set token=autokube_agent_token_xxx
 *
 * 3. Verify installation:
 *    kubectl get pods -n autokube-system
 *    kubectl logs -f deployment/autokube-agent -n autokube-system
 *
 * 4. Agent automatically connects and registers:
 *    - Agent connects TO AutoKube (reverse proxy)
 *    - No Ingress/LoadBalancer needed
 *    - Firewall-friendly (outbound HTTPS only)
 *    - Cluster appears as "Connected" in AutoKube UI
 *
 * See AGENT_SETUP.md for detailed instructions
 */

// ─── Example 7: Switching Between Auth Methods ─────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function exampleSwitchAuthMethods(cluster: any) {
	let config: ConnectionConfig;

	// Dynamic auth method selection based on cluster configuration
	switch (cluster.authType) {
		case 'kubeconfig':
			config = parseKubeconfig(cluster.kubeconfig!, cluster.context);
			break;

		case 'bearer-token':
			config = createBearerTokenConnection(cluster.apiServer!, cluster.bearerToken!, cluster.name, {
				skipTLSVerify: cluster.tlsSkipVerify ?? false,
				ca: cluster.tlsCa ?? undefined
			});
			break;

		case 'agent':
			// Agent connects TO AutoKube - no URL needed
			config = createAgentConnection(cluster.agentToken!, cluster.name);
			break;

		default:
			throw new Error(`Unsupported auth type: ${cluster.authType}`);
	}

	// Use the same API regardless of auth method
	const pods = await k8sRequest(config, '/api/v1/pods');
	console.log('Pods:', pods);
}

// ─── Run Examples ───────────────────────────────────────────────────────────

if (import.meta.main) {
	console.log('=== Kubernetes Authentication Examples ===\n');

	// Uncomment to run examples:
	await exampleKubeconfig();
	// await exampleBearerToken();
	// await exampleAgent();
	// await exampleFromDatabase();
	// await exampleHighLevelAPI();
}

export {
	exampleKubeconfig,
	exampleBearerToken,
	exampleAgent,
	exampleFromDatabase,
	exampleHighLevelAPI,
	exampleSwitchAuthMethods
};
