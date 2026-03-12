import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { callAI, resolveProvider, type AiMessage } from '$lib/server/services/ai-service';
import {
	createChatSession,
	getChatSession,
	getChatMessages,
	addChatMessage,
	touchSession
} from '$lib/server/queries/ai-chat';

/**
 * System prompt — intentionally brief. No upfront cluster data.
 * The AI calls tools on demand. Session history is loaded from DB.
 */
const SYSTEM_PROMPT = `You are Kube, an expert Kubernetes assistant inside AutoKube.

You have tools to query the live cluster. ALWAYS use tools — never give generic advice.
Rule: if the user mentions a specific resource name, call get_resource FIRST to see its actual spec.

Tool selection guide:
- User mentions a specific pod/statefulset/deployment name → get_resource(kind, namespace, name)
- "why is X crashing/not working?" → get_resource first, then get_pod_logs
- "memory/CPU of X" → get_resource for limits + list_pod_metrics for live usage
- "are pods healthy?" → list_pods(namespace:all)
- "any issues?" → list_events(type:Warning)
- Namespace unknown? → call list_namespaces or list_pods first to find it

After getting tool results, give concrete actionable advice based on ACTUAL values.
Never suggest the user check something you can check yourself.

Formatting: **bold** key values, \`code\` for names/values, bullet points for lists, YAML blocks for config.`;

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('cluster', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { userMessage, sessionId: inSessionId, clusterContext, providerId } = body as {
			userMessage: string;
			sessionId?: string;
			clusterContext?: Record<string, unknown> & { id?: number };
			providerId?: number;
		};

		if (!userMessage?.trim()) return json({ error: 'Message is required' }, { status: 400 });

		const provider = await resolveProvider(providerId);
		if (!provider) return json({ error: 'No AI provider configured' }, { status: 400 });
		if (!provider.enabled) return json({ error: 'AI provider is disabled' }, { status: 400 });

		const clusterId = clusterContext?.id ? Number(clusterContext.id) : undefined;

		// ── Session management ────────────────────────────────────────────────
		let sessionId = inSessionId;

		if (sessionId) {
			const session = await getChatSession(sessionId);
			if (!session) sessionId = undefined;
		}

		if (!sessionId && clusterId) {
			const session = await createChatSession(clusterId, userMessage.slice(0, 60).trim());
			sessionId = session.id;
		}

		// ── Load history from DB — last 8 messages (4 pairs) to cap input tokens ──
		const dbMessages = sessionId ? await getChatMessages(sessionId, 8) : [];

		// ── Build AI message list ─────────────────────────────────────────────
		const identity = clusterContext
			? `Cluster: ${clusterContext.name} | Status: ${clusterContext.status} | Nodes: ${clusterContext.nodes} | Pods: ${clusterContext.runningPods}/${clusterContext.pods} running | Metrics: ${clusterContext.metricsAvailable ? 'yes' : 'no'}`
			: null;

		const fullMessages: AiMessage[] = [
			{ role: 'system', content: identity ? `${SYSTEM_PROMPT}\n\n${identity}` : SYSTEM_PROMPT },
			...dbMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
			{ role: 'user', content: userMessage }
		];

		// ── Call AI (tools auto-selected by userMessage keywords) ────────────
		const reply = await callAI(provider, fullMessages, { clusterId });

		// ── Persist to DB ─────────────────────────────────────────────────────
		if (sessionId) {
			await addChatMessage(sessionId, 'user', userMessage);
			await addChatMessage(sessionId, 'assistant', reply);
			await touchSession(sessionId);
		}

		return json({ success: true, message: reply, sessionId, providerName: provider.name });
	} catch (err) {
		console.error('[API] Chat failed:', err);
		const message = err instanceof Error ? err.message : 'Chat failed';
		return json({ success: false, error: message }, { status: 500 });
	}
};
