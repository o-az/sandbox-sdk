/**
 * Create a test configuration for Workers runtime tests
 * Uses @cloudflare/vitest-pool-workers to test code in Workers environment
 */
export function createWorkersTestConfig(options?: {
  include?: string[];
  wranglerConfigPath?: string;
  durableObjects?: Record<string, string>;
}) {
  return {
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    isolate: true,
    include: options?.include || ['tests/**/*.test.ts'],
    maxConcurrency: 5,
    poolOptions: {
      workers: {
        wrangler: {
          configPath: options?.wranglerConfigPath || './wrangler.jsonc',
        },
        miniflare: {
          durableObjects: options?.durableObjects || {},
        },
      },
    },
  } as const;
}
