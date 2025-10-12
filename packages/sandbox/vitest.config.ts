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
  }),

  esbuild: {
    target: 'esnext',
  },
});
