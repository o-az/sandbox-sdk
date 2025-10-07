import { describe, test, expect } from 'vitest';
import { WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId } from './helpers/test-fixtures';

/**
 * Smoke test to verify integration test infrastructure
 *
 * This test validates that:
 * 1. WranglerDevRunner can start wrangler dev
 * 2. We can capture the URL
 * 3. Worker is running and responding
 * 4. We can cleanup properly
 *
 * NOTE: This is just infrastructure validation. Real SDK integration
 * tests will be in the workflow test suites (Phase 4 Step 2).
 */
describe('Integration Infrastructure Smoke Test', () => {
  describe('local', () => {
    test('should start wrangler dev and verify worker is running', async () => {
      // Step 1: Start wrangler dev pointing to minimal test worker
      // Uses published Docker image so no build context issues
      const runner = new WranglerDevRunner({
        cwd: 'tests/integration/test-worker',
      });

      // Step 2: Wait for wrangler to be ready and get URL
      const url = await runner.getUrl();
      expect(url).toBeDefined();
      expect(url).toMatch(/^https?:\/\//);

      // Step 3: Verify worker is running with health check
      const response = await fetch(`${url}/health`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe('ok');

      // Step 4: Verify stdout captured wrangler startup
      const stdout = runner.getStdout();
      expect(stdout).toContain('Ready on');

      // Step 5: Cleanup (no specific containers to stop for health check)
      await runner.stop();
    });
  });
});
