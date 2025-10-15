import { defineConfig } from 'vitest/config';

/**
 * E2E test configuration
 *
 * These tests run against deployed Cloudflare Workers (in CI) or local wrangler dev.
 * They validate true end-to-end behavior with real Durable Objects and containers.
 *
 * Run with: npm run test:e2e
 */
export default defineConfig({
  test: {
    name: 'e2e',
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],

    // Longer timeouts for E2E tests (wrangler startup, container operations)
    testTimeout: 120000, // 2 minutes per test
    hookTimeout: 60000, // 1 minute for beforeAll/afterAll
    teardownTimeout: 30000, // 30s for cleanup

    // Run tests serially to avoid port conflicts
    // Each test spawns its own wrangler dev instance or uses deployed worker
    pool: 'forks',
    maxConcurrency: 1,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
