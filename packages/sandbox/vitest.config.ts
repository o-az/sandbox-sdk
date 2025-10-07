import path from 'node:path';
import { createIntegrationTestConfig } from '@repo/vitest-config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: createIntegrationTestConfig(),
  resolve: {
    alias: {
      '@container': path.resolve(__dirname, '../sandbox-container/src'),
    },
  },
});