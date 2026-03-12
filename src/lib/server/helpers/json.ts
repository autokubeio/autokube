// ── Database Helper Functions ───────────────────────────────────────────────

/**
 * Safely parse JSON string to object
 * @returns Parsed object or null if parsing fails
 */
export function parseJsonField<T = Record<string, unknown>>(json: string | null): T | null {
	if (!json) return null;
	try {
		return JSON.parse(json) as T;
	} catch {
		return null;
	}
}

/**
 * Safely stringify object to JSON string
 * @returns JSON string or null if stringification fails
 */
export function stringifyJsonField(data: unknown): string | null {
	if (!data) return null;
	try {
		return JSON.stringify(data);
	} catch {
		return null;
	}
}

/**
 * Parse JSON string array field
 * @returns Array or empty array if parsing fails
 */
export function parseJsonArrayField<T = string>(json: string | null): T[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * Ensure a value is not null, providing a default fallback
 */
export function withDefault<T>(value: T | null | undefined, defaultValue: T): T {
	return value ?? defaultValue;
}
