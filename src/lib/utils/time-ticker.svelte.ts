/**
 * Time Ticker - Reactive current time that updates automatically
 * Similar to Angular pipes that auto-update time-ago displays
 */

/**
 * Create a reactive time ticker that updates at specified interval
 * @param intervalMs - Update interval in milliseconds (default: 10000 = 10 seconds)
 * @returns Reactive state with current time and cleanup function
 * 
 * @example
 * const ticker = createTimeTicker(10000);
 * $effect(() => {
 *   console.log('Time updated:', ticker.now);
 * });
 * onDestroy(() => ticker.stop());
 */
export function createTimeTicker(intervalMs = 10000) {
	let now = $state(Date.now());
	let intervalId: ReturnType<typeof setInterval> | null = null;

	function start() {
		if (intervalId) return; // Already running
		intervalId = setInterval(() => {
			now = Date.now();
		}, intervalMs);
	}

	function stop() {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	// Auto-start on creation
	start();

	return {
		get now() {
			return now;
		},
		start,
		stop
	};
}

/**
 * Calculate age from ISO timestamp with current time reference
 * @param createdAt - ISO timestamp string
 * @param currentTime - Current time in milliseconds (from ticker)
 * @returns Formatted age (e.g., "5d", "2h", "30m", "45s")
 * 
 * @example
 * const ticker = createTimeTicker();
 * $derived(calculateAgeWithTicker(namespace.createdAt, ticker.now))
 */
export function calculateAgeWithTicker(createdAt: string, currentTime: number): string {
	const created = Date.parse(createdAt);
	const diffMs = currentTime - created;

	if (diffMs < 0) return '0s'; // Future date

	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHr = Math.floor(diffMin / 60);
	const diffDay = Math.floor(diffHr / 24);

	if (diffDay > 0) return `${diffDay}d`;
	if (diffHr > 0) return `${diffHr}h`;
	if (diffMin > 0) return `${diffMin}m`;
	return `${diffSec}s`;
}
