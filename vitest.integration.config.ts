import { defineConfig } from 'vitest/config';
import { createIntegrationTestConfig } from '@repo/vitest-config';
import path from 'node:path';

/**
 * Integration test configuration for E2E tests
 *
 * These tests run against real wrangler dev with real Durable Objects and containers.
 * They are slower than unit tests but validate true end-to-end behavior.
 *
 * Run with: npm run test:integration
 */
export default defineConfig({
  test: {
    ...createIntegrationTestConfig({
      include: ['__tests__/integration/**/*.test.ts'],
      name: 'e2e-integration',
    }),

    // Longer timeouts for integration tests (wrangler startup, container operations)
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
      '~': path.resolve(__dirname, 'packages/sandbox/src'),
      '@container': path.resolve(__dirname, 'packages/sandbox-container/src'),
    },
  },
});
