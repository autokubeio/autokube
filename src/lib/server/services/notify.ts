/**
 * Notification sending — server-only.
 * Handles SMTP (via nodemailer) and Apprise URL schemes.
 */

import type { AppriseConfig, SmtpConfig, ResolvedChannel } from '../queries';

const TEST_TITLE = 'AutoKube Test Notification';
const TEST_BODY = 'This is a test notification from AutoKube — your channel is working correctly.';

/** Escape HTML special characters for Telegram HTML parse mode */
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

	// Generic fallback: Apprise REST API
	const appriseApiUrl = process.env.APPRISE_API_URL;
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
