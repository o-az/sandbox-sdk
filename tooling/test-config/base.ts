import type { UserConfig } from 'vitest/config';

/**
 * Base test configuration shared across all Vitest tests
 */
export const baseTestConfig: UserConfig['test'] = {
  globals: true,
  environment: 'node',
  testTimeout: 10000,
  hookTimeout: 10000,
  teardownTimeout: 10000,
  isolate: true,
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: false,
    },
  },
};

/**
 * Create a test configuration for E2E tests
 * Used for end-to-end tests that run against real wrangler + Docker
 */
export function createE2ETestConfig(options?: {
  include?: string[];
  name?: string;
}): UserConfig['test'] {
  return {
    ...baseTestConfig,
    name: options?.name || 'e2e-tests',
    include: options?.include || ['tests/e2e/**/*.test.ts'],
  };
}
