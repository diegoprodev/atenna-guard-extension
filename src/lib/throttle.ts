/**
 * Creates a throttled version of a function using leading-edge throttling.
 * The function fires immediately on the first call, then ignores calls within
 * the throttle period until the period expires.
 *
 * @param fn - The function to throttle
 * @param delayMs - The throttle delay in milliseconds
 * @returns A throttled version of the function
 */
export function throttleLeadingEdge<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): T {
  let lastCallTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: any[]) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall >= delayMs) {
      // Throttle window has expired, execute immediately
      lastCallTime = now;
      fn(...args);
    } else if (!timeoutId) {
      // Within throttle window, schedule for trailing edge
      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        timeoutId = null;
        fn(...args);
      }, delayMs - timeSinceLastCall);
    }
    // Otherwise, there's already a timeout scheduled, ignore this call
  }) as T;
}
