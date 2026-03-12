/**
 * Get current ISO timestamp
 */
export function getCurrentTimestamp(): string {
	return new Date().toISOString();
}
