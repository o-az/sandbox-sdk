#!/usr/bin/env node

import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';
import * as vm from 'node:vm';
import { CONFIG } from '../../../config';
import type { RichOutput } from '../../process-pool';

// Create CommonJS-like globals for the sandbox
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const sandbox = {
  console: console,
  process: process,
  require: require,
  Buffer: Buffer,
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearTimeout: clearTimeout,
  clearInterval: clearInterval,
  setImmediate: setImmediate,
  clearImmediate: clearImmediate,
  global: global,
  __dirname: __dirname,
  __filename: __filename
};

const context = vm.createContext(sandbox);

console.log(JSON.stringify({ status: "ready" }));

rl.on('line', async (line: string) => {
  try {
    const request = JSON.parse(line);
    const { code, executionId, timeout } = request;

    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;

    let stdout = '';
    let stderr = '';

    (process.stdout.write as any) = (chunk: string | Buffer, encoding?: BufferEncoding, callback?: () => void) => {
      stdout += chunk.toString();
      if (callback) callback();
      return true;
    };

    (process.stderr.write as any) = (chunk: string | Buffer, encoding?: BufferEncoding, callback?: () => void) => {
      stderr += chunk.toString();
      if (callback) callback();
      return true;
    };

    let result: unknown;
    let success = true;

    try {
      // Use provided timeout, or fall back to config (which may be undefined = unlimited)
      const effectiveTimeout = timeout ?? CONFIG.VM_EXECUTION_TIMEOUT_MS;
      const options: vm.RunningScriptOptions = {
        filename: `<execution-${executionId}>`,
      };

      // Only add timeout if specified (undefined = unlimited)
      if (effectiveTimeout !== undefined) {
        options.timeout = effectiveTimeout;
      }

      result = vm.runInContext(code, context, options);

    } catch (error: unknown) {
      const err = error as Error;
      stderr += err.stack || err.toString();
      success = false;
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
    
    const outputs: RichOutput[] = [];
    
    if (result !== undefined) {
      if (typeof result === 'object' && result !== null) {
        outputs.push({
          type: 'json',
          data: JSON.stringify(result, null, 2),
          metadata: {}
        });
      } else {
        outputs.push({
          type: 'text',
          data: util.inspect(result, { showHidden: false, depth: null, colors: false }),
          metadata: {}
        });
      }
    }
    
    const response = {
      stdout,
      stderr,
      success,
      executionId,
      outputs
    };
    
    console.log(JSON.stringify(response));
    
  } catch (error: unknown) {
    const err = error as Error;
    console.log(JSON.stringify({
      stdout: '',
      stderr: `Error processing request: ${err.message}`,
      success: false,
      executionId: 'unknown',
      outputs: []
    }));
  }
});

process.on('SIGTERM', () => {
  rl.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  rl.close();
  process.exit(0);
});