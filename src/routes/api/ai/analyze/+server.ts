import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/services/authorize';
import { callAI, resolveProvider, type AiMessage } from '$lib/server/services/ai-service';

const SYSTEM_PROMPT = `You are a Kubernetes log analyst. Analyze the provided pod logs and return a structured JSON analysis.
Focus on identifying errors, exceptions, warnings, crashes, or unusual patterns.

Respond ONLY with a JSON object matching this schema (no markdown, no explanation outside JSON):
{
  "summary": "Brief 1-2 sentence summary of what the logs show",
  "status": "healthy|warning|error|critical",
  "errors": [
    {
      "line": "the relevant log line (trimmed)",
      "explanation": "what this error means",
      "severity": "critical|error|warning|info"
    }
  ],
  "rootCause": "Most likely root cause in 1-3 sentences, or null if logs look healthy",
  "suggestions": ["Actionable fix suggestion 1", "Actionable fix suggestion 2"],
  "nextSteps": ["Immediate action 1", "Immediate action 2"]
}`;

const FOLLOWUP_PROMPT = `You are a Kubernetes expert helping analyze pod logs. The user has already seen a structured analysis and wants to ask a follow-up question about the logs.
Answer clearly and helpfully, using Markdown formatting (code blocks, bullet lists, bold text) where appropriate.
Be concise but thorough. If you reference specific log lines, quote them in code blocks.`;

interface AnalysisResult {
	summary: string;
	status: string;
	errors: Array<{ line: string; explanation: string; severity: string }>;
	rootCause: string | null;
	suggestions: string[];
	nextSteps: string[];
}

/** Strip markdown code fences that some models wrap around JSON output. */
function extractJson(raw: string): string {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) return fenced[1].trim();
	return raw.trim();
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('cluster', 'read'))) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { providerId, logs, podName, namespace, clusterName, question } = body;

		if (!logs) return json({ error: 'Logs are required' }, { status: 400 });

		const provider = await resolveProvider(providerId ? Number(providerId) : undefined);
		if (!provider) return json({ error: 'No AI provider configured' }, { status: 400 });
		if (!provider.enabled) return json({ error: 'AI provider is disabled' }, { status: 400 });

		const logContext = [
			`Pod: ${podName ?? 'unknown'}`,
			`Namespace: ${namespace ?? 'unknown'}`,
			`Cluster: ${clusterName ?? 'unknown'}`,
			'',
			'--- LOGS START ---',
			(logs as string).slice(0, 50000),
			'--- LOGS END ---'
		].join('\n');

		// ── Follow-up question mode ──────────────────────────────────
		if (question) {
			const messages: AiMessage[] = [
				{ role: 'system', content: FOLLOWUP_PROMPT },
				{ role: 'user', content: `${logContext}\n\nQuestion: ${question}` }
			];
			const answer = await callAI(provider, messages, {});
			return json({ success: true, answer, providerName: provider.name });
		}

		// ── Full analysis mode ───────────────────────────────────────
		const messages: AiMessage[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: logContext }
		];

		// No tools for log analysis — pure JSON response
		const raw = await callAI(provider, messages, {});
		const analysis = JSON.parse(extractJson(raw)) as AnalysisResult;

		return json({ success: true, analysis, providerName: provider.name });
	} catch (err) {
		console.error('[API] AI analysis failed:', err);
		const message = err instanceof Error ? err.message : 'Analysis failed';
		return json({ success: false, error: message }, { status: 500 });
	}
};
