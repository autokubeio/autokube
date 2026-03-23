/**
 * Notification sending — server-only.
 * Handles SMTP (via nodemailer) and Apprise URL schemes.
 * Natively supports: Telegram, Discord, Slack, Generic Webhook (JSON/JSONS).
 */

import type { AppriseConfig, SmtpConfig, ResolvedChannel } from '../queries';

const TEST_TITLE = 'AutoKube Test Notification';
const TEST_BODY = 'This is a test notification from AutoKube — your channel is working correctly.';

/** Escape HTML special characters for Telegram HTML parse mode */
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape Markdown special characters for Discord */
function escapeMarkdown(text: string): string {
	return text.replace(/([*_~`|\\])/g, '\\$1');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a real alert notification through a resolved channel.
 * @param channel  The channel to send through (must have config)
 * @param title    Alert subject / title
 * @param body     Alert body text
 */
export async function sendAlert(
	channel: ResolvedChannel,
	title: string,
	body: string
): Promise<void> {
	try {
		if (channel.type === 'smtp') {
			await sendSmtp(channel.config as SmtpConfig, title, body);
		} else {
			await sendApprise(channel.config as AppriseConfig, title, body);
		}
	} catch (err) {
		console.error(`[Notify] Failed to send alert via "${channel.name}":`, err);
	}
}

async function sendSmtp(config: SmtpConfig, title: string, body: string): Promise<void> {
	const nodemailer = await import('nodemailer');
	const transporter = nodemailer.default.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth:
			config.username && config.password
				? { user: config.username, pass: config.password }
				: undefined
	});

	await transporter.sendMail({
		from: config.from_name ? `"${config.from_name}" <${config.from_email}>` : config.from_email,
		to: config.to_emails.join(', '),
		subject: title,
		text: body
	});
}

export async function sendTestSmtp(config: SmtpConfig): Promise<void> {
	await sendSmtp(config, TEST_TITLE, TEST_BODY);
}

export async function sendTestApprise(config: AppriseConfig): Promise<void> {
	await sendApprise(config, TEST_TITLE, TEST_BODY);
}

async function sendApprise(config: AppriseConfig, title: string, body: string): Promise<void> {
	const errors: string[] = [];
	for (const url of config.urls) {
		try {
			await sendAppriseUrl(url, title, body);
		} catch (err) {
			errors.push(String(err));
		}
	}
	if (errors.length > 0) throw new Error(errors.join('; '));
}

// ── Apprise URL dispatch ──────────────────────────────────────────────────────

async function sendAppriseUrl(url: string, title: string, body: string): Promise<void> {
	const lower = url.toLowerCase();

	if (lower.startsWith('tgram://')) {
		return sendTelegram(url, formatTelegramHtml(title, body));
	}

	if (lower.startsWith('discord://')) {
		return sendDiscord(url, title, body);
	}

	if (lower.startsWith('slack://')) {
		return sendSlack(url, title, body);
	}

	if (lower.startsWith('json://') || lower.startsWith('jsons://')) {
		return sendGenericWebhook(url, title, body);
	}

	// Generic fallback: Apprise REST API
	const appriseApiUrl = Bun.env.APPRISE_API_URL;
	if (appriseApiUrl) {
		const res = await fetch(`${appriseApiUrl}/notify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ urls: [url], title, body })
		});
		if (!res.ok) {
			const text = await res.text().catch(() => res.statusText);
			throw new Error(`Apprise API: ${res.status} ${text}`);
		}
		return;
	}

	throw new Error(
		`Unsupported Apprise URL scheme "${url.split(':')[0]}://". ` +
			`Set the APPRISE_API_URL environment variable to use an Apprise server for full support.`
	);
}

// ── Telegram ─────────────────────────────────────────────────────────────────

/**
 * Format title + body into Telegram HTML.
 * Converts lines with pattern "label: value" to bold labels.
 * Lines starting with 💬 become italic.
 * Other lines are escaped as-is.
 */
function formatTelegramHtml(title: string, body: string): string {
	const lines = body.split('\n').filter(Boolean);
	const htmlLines = lines.map((line) => {
		// 💬 message lines → italic
		const msgMatch = line.match(/^💬\s+(.+)$/u);
		if (msgMatch) {
			return `\n💬 <i>${escapeHtml(msgMatch[1])}</i>`;
		}
		// 🕐 timestamp → smaller/dimmer
		const timeMatch = line.match(/^🕐\s+(.+)$/u);
		if (timeMatch) {
			return `\n🕐 ${escapeHtml(timeMatch[1])}`;
		}
		// "emoji Label: value" → bold label
		const labelMatch = line.match(/^(.+?):\s+(.+)$/u);
		if (labelMatch) {
			return `${escapeHtml(labelMatch[1])}: <b>${escapeHtml(labelMatch[2])}</b>`;
		}
		return escapeHtml(line);
	});

	return `<b>${escapeHtml(title)}</b>\n${htmlLines.join('\n')}\n\nautokube.io`;
}

/** Parse tgram://TOKEN/CHATID[/CHATID2...] and send via Telegram Bot API. */
async function sendTelegram(url: string, html: string): Promise<void> {
	const path = url.replace(/^tgram:\/\//i, '');
	const parts = path.split('/').filter(Boolean);
	if (parts.length < 2) {
		throw new Error('Invalid tgram:// URL. Expected format: tgram://BOTTOKEN/CHATID');
	}

	const token = parts[0];
	const chatIds = parts.slice(1);

	for (const chatId of chatIds) {
		const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: html,
				parse_mode: 'HTML',
				link_preview_options: { is_disabled: true }
			})
		});
		const data = (await res.json()) as { ok: boolean; description?: string };
		if (!data.ok) {
			throw new Error(`Telegram API error: ${data.description ?? 'unknown error'}`);
		}
	}
}

// ── Discord ──────────────────────────────────────────────────────────────────

/**
 * Format title + body as a Discord embed.
 * Parses "label: value" lines into embed fields for rich rendering.
 */
function formatDiscordEmbed(
	title: string,
	body: string
): { title: string; description: string; color: number; fields: { name: string; value: string; inline: boolean }[]; footer: { text: string } } {
	const lines = body.split('\n').filter(Boolean);
	const fields: { name: string; value: string; inline: boolean }[] = [];
	const descriptionLines: string[] = [];

	for (const line of lines) {
		// "emoji Label: value" → embed field
		const labelMatch = line.match(/^(.+?):\s+(.+)$/u);
		if (labelMatch) {
			fields.push({
				name: labelMatch[1].trim(),
				value: escapeMarkdown(labelMatch[2].trim()),
				inline: true
			});
			continue;
		}
		// 💬 message lines → description
		const msgMatch = line.match(/^💬\s+(.+)$/u);
		if (msgMatch) {
			descriptionLines.push(`> _${escapeMarkdown(msgMatch[1])}_`);
			continue;
		}
		descriptionLines.push(escapeMarkdown(line));
	}

	// Use orange for warning emojis, blue otherwise
	const isWarning = title.includes('⚠️') || title.includes('🔴');
	const color = isWarning ? 0xff6600 : 0x3498db;

	return {
		title,
		description: descriptionLines.join('\n') || body,
		color,
		fields: fields.slice(0, 25), // Discord allows max 25 fields
		footer: { text: 'autokube.io' }
	};
}

/**
 * Parse discord://WebhookID/WebhookToken and send via Discord Webhook API.
 * URL format: discord://WebhookID/WebhookToken
 */
async function sendDiscord(url: string, title: string, body: string): Promise<void> {
	const path = url.replace(/^discord:\/\//i, '');
	const parts = path.split('/').filter(Boolean);
	if (parts.length < 2) {
		throw new Error(
			'Invalid discord:// URL. Expected format: discord://WebhookID/WebhookToken'
		);
	}

	const webhookId = parts[0];
	const webhookToken = parts[1];
	const embed = formatDiscordEmbed(title, body);

	const res = await fetch(
		`https://discord.com/api/webhooks/${webhookId}/${webhookToken}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'AutoKube',
				embeds: [embed]
			})
		}
	);

	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(`Discord Webhook error: ${res.status} ${text}`);
	}
}

// ── Slack ────────────────────────────────────────────────────────────────────

/**
 * Format title + body into Slack Block Kit blocks for rich rendering.
 */
function formatSlackBlocks(
	title: string,
	body: string
): { type: string; text?: { type: string; text: string }; elements?: { type: string; text: string }[]; fields?: { type: string; text: string }[] }[] {
	const lines = body.split('\n').filter(Boolean);
	const fields: { type: string; text: string }[] = [];
	const contextLines: string[] = [];

	for (const line of lines) {
		// "emoji Label: value" → section field
		const labelMatch = line.match(/^(.+?):\s+(.+)$/u);
		if (labelMatch) {
			fields.push({
				type: 'mrkdwn',
				text: `*${labelMatch[1].trim()}*\n${labelMatch[2].trim()}`
			});
			continue;
		}
		// 💬 message lines → context
		const msgMatch = line.match(/^💬\s+(.+)$/u);
		if (msgMatch) {
			contextLines.push(`_${msgMatch[1]}_`);
			continue;
		}
		contextLines.push(line);
	}

	const blocks: { type: string; text?: { type: string; text: string }; elements?: { type: string; text: string }[]; fields?: { type: string; text: string }[] }[] = [
		{
			type: 'header',
			text: { type: 'plain_text', text: title }
		}
	];

	// Add fields in groups of 10 (Slack limit per section)
	for (let i = 0; i < fields.length; i += 10) {
		blocks.push({
			type: 'section',
			fields: fields.slice(i, i + 10)
		});
	}

	if (contextLines.length > 0) {
		blocks.push({
			type: 'context',
			elements: [{ type: 'mrkdwn', text: contextLines.join('\n') }]
		});
	}

	blocks.push({
		type: 'context',
		elements: [{ type: 'mrkdwn', text: 'autokube.io' }]
	});

	return blocks;
}

/**
 * Parse slack://TokenA/TokenB/TokenC and send via Slack Incoming Webhook API.
 * URL format: slack://TokenA/TokenB/TokenC
 * Maps to: https://hooks.slack.com/services/TokenA/TokenB/TokenC
 */
async function sendSlack(url: string, title: string, body: string): Promise<void> {
	const path = url.replace(/^slack:\/\//i, '');
	const parts = path.split('/').filter(Boolean);
	if (parts.length < 3) {
		throw new Error(
			'Invalid slack:// URL. Expected format: slack://TokenA/TokenB/TokenC'
		);
	}

	const [tokenA, tokenB, tokenC] = parts;
	const webhookUrl = `https://hooks.slack.com/services/${tokenA}/${tokenB}/${tokenC}`;
	const blocks = formatSlackBlocks(title, body);

	const res = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			text: `${title}\n${body}`,
			blocks
		})
	});

	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(`Slack Webhook error: ${res.status} ${text}`);
	}
}

// ── Generic Webhook (JSON) ───────────────────────────────────────────────────

/**
 * Parse json:// or jsons:// URL and POST a JSON payload.
 * URL format: json://hostname[:port][/path]  (HTTP)
 *             jsons://hostname[:port][/path] (HTTPS)
 *
 * Sends a structured JSON payload with title, body, and metadata.
 */
async function sendGenericWebhook(url: string, title: string, body: string): Promise<void> {
	const isHttps = url.toLowerCase().startsWith('jsons://');
	const protocol = isHttps ? 'https' : 'http';
	// Strip the scheme and reconstruct as http(s)
	const rest = url.replace(/^jsons?:\/\//i, '');

	if (!rest) {
		throw new Error(
			'Invalid json:// URL. Expected format: json://hostname[:port][/path]'
		);
	}

	const webhookUrl = `${protocol}://${rest}`;

	const payload = {
		title,
		body,
		message: `${title}\n\n${body}`,
		source: 'autokube',
		timestamp: new Date().toISOString()
	};

	const res = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});

	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		throw new Error(`Webhook error: ${res.status} ${text}`);
	}
}
