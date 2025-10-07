import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { createWorkersTestConfig } from '@repo/test-config/workers';

/**
 * Workers runtime test configuration
 * 
 * Tests the SDK code in Cloudflare Workers environment with Durable Objects.
 * Uses @cloudflare/vitest-pool-workers to run tests in workerd runtime.
 * 
 * Run with: npm test
 */
export default defineWorkersConfig({
  test: createWorkersTestConfig({
    include: ['tests/**/*.test.ts'],
    wranglerConfigPath: './wrangler.jsonc',
    durableObjects: {
      Sandbox: 'Sandbox',
    },
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov', 'json'],
      include: ['src/**/*.{ts,js}'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/tests/**',
        '**/__mocks__/**',
        '**/*.d.ts',
        '**/types.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 85,
        statements: 90,
        perFile: true,
      },
      clean: true,
      cleanOnRerun: true,
    },
  }),

  esbuild: {
    target: 'esnext',
  },
});