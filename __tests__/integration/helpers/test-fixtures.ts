import { randomUUID } from 'node:crypto';

/**
 * Generate unique sandbox ID for test isolation
 *
 * Each test should use a unique ID to prevent pollution between tests.
 */
export function createSandboxId(): string {
  return randomUUID();
}

/**
 * Fetch with timeout to prevent hanging tests
 *
 * Usage:
 * ```typescript
 * const res = await fetchOrTimeout(
 *   fetch('http://example.com'),
 *   5000
 * );
 * ```
 */
export async function fetchOrTimeout(
  fetchPromise: Promise<Response>,
  timeoutMs: number
): Promise<Response> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs)
  );

  return await Promise.race([fetchPromise, timeoutPromise]);
}

/**
 * Wait for condition with retries
 *
 * Note: Prefer using Vitest's built-in vi.waitFor() over this helper:
 * ```typescript
 * import { vi } from 'vitest';
 *
 * const response = await vi.waitFor(
 *   async () => {
 *     const res = await fetch(url);
 *     if (res.status !== 200) throw new Error('Not ready');
 *     return res;
 *   },
 *   { timeout: 10000 }
 * );
 * ```
 *
 * This helper is provided for cases where vi.waitFor() isn't suitable.
 */
export async function waitForCondition<T>(
  condition: () => Promise<T>,
  options: {
    timeout?: number;
    interval?: number;
    errorMessage?: string;
  } = {}
): Promise<T> {
  const timeout = options.timeout || 10000;
  const interval = options.interval || 500;
  const errorMessage = options.errorMessage || 'Condition not met within timeout';

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      return await condition();
    } catch (error) {
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  throw new Error(errorMessage);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
