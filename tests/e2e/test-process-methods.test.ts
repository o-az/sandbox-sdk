import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { getTestWorkerUrl, WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId, createTestHeaders } from './helpers/test-fixtures';

/**
 * Test to verify if Process methods work within the test worker
 * (before serialization over HTTP)
 *
 * This tests whether the Process object's methods (kill, getStatus, getLogs)
 * can be called in the test worker context before the object is serialized.
 *
 * If this works, it suggests the duplication in sandbox.ts might be unnecessary.
 */
describe('Process Method Tests', () => {
  describe('local', () => {
    let runner: WranglerDevRunner | null = null;
    let workerUrl: string;

    beforeAll(async () => {
      const result = await getTestWorkerUrl();
      workerUrl = result.url;
      runner = result.runner;
    });

    afterAll(async () => {
      if (runner) {
        await runner.stop();
      }
    });

    test('should be able to call Process methods in test worker', async () => {
      const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

      console.log('\n🧪 Testing if Process methods work in test worker...\n');

      const response = await fetch(`${workerUrl}/api/test/process-methods`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
      const result = await response.json() as any;

      console.log('Test Results:', JSON.stringify(result, null, 2));

      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();

      const { results } = result;

      // Check each method test
      console.log('\n📊 Method Test Results:');
      console.log(`  getStatus(): ${results.getStatusWorks ? '✅ WORKS' : '❌ FAILS'}`);
      if (results.getStatusWorks) {
        console.log(`    → Status value: ${results.statusValue}`);
      } else {
        console.log(`    → Error: ${results.getStatusError}`);
      }

      console.log(`  getLogs(): ${results.getLogsWorks ? '✅ WORKS' : '❌ FAILS'}`);
      if (results.getLogsWorks) {
        console.log(`    → Logs retrieved successfully`);
      } else {
        console.log(`    → Error: ${results.getLogsError}`);
      }

      console.log(`  kill(): ${results.killWorks ? '✅ WORKS' : '❌ FAILS'}`);
      if (results.killWorks) {
        console.log(`    → Process killed successfully`);
        console.log(`    → Status after kill: ${results.statusAfterKill}`);
      } else {
        console.log(`    → Error: ${results.killError}`);
      }

      console.log('\n');

      // If all methods work, the duplication in sandbox.ts is unnecessary!
      if (results.getStatusWorks && results.getLogsWorks && results.killWorks) {
        console.log('✅ ALL METHODS WORK! The duplication in sandbox.ts may be unnecessary.');
        console.log('   Test worker can use rich Process API, E2E tests get serialized data.\n');
      } else {
        console.log('⚠️  Some methods failed. The current implementation might be needed.\n');
      }

      // Cleanup
      await fetch(`${workerUrl}/cleanup`, {
        method: 'POST',
        headers,
      });
    }, 60000);
  });
});
