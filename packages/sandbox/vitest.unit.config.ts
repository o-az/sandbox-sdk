import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Base configuration
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
    isolate: true,

    // Test patterns
    include: ['tests/**/*.test.ts'],

    // Coverage configuration - using Istanbul (V8 not supported in workerd)
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov', 'json'],

      include: [
        'src/**/*.{ts,js}',
      ],

      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/tests/**',
        '**/__mocks__/**',
        '**/*.d.ts',
        '**/types.ts',
      ],

      // Coverage thresholds for unit tests
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

    maxConcurrency: 5,

    // Workers pool configuration
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          // Configure Durable Objects for testing
          durableObjects: {
            Sandbox: 'Sandbox',
          },
        },
      },
    },
  },

  esbuild: {
    target: 'esnext',
  },
});