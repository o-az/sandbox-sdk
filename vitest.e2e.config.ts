import { defineConfig } from 'vitest/config';
import { createE2ETestConfig } from '@repo/test-config';
import path from 'node:path';

/**
 * E2E test configuration
 *
 * These tests run against real wrangler dev with real Durable Objects and containers.
 * They are slower than other tests but validate true end-to-end behavior.
 *
 * Run with: npm run test:e2e
 */
export default defineConfig({
  test: {
    ...createE2ETestConfig({
      include: ['tests/e2e/**/*.test.ts'],
      name: 'e2e',
    }),

    // Longer timeouts for E2E tests (wrangler startup, container operations)
    testTimeout: 300000, // 5 minutes per test (wrangler dev + Docker can be slow)
    hookTimeout: 120000, // 2 minutes for beforeAll/afterAll
    teardownTimeout: 30000, // 30s for cleanup

    // Run tests serially to avoid port conflicts
    // Each test spawns its own wrangler dev instance
    maxConcurrency: 1,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },

  resolve: {
    alias: {
      '@container': path.resolve(__dirname, 'packages/sandbox-container/src'),
    },
  },
});
