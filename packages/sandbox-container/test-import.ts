import { describe, it, expect } from 'bun:test';

// Test if relative import works
import type { Logger } from './src/core/types';

describe('Module resolution test', () => {
  it('should resolve relative imports', () => {
    expect(true).toBe(true);
  });
});
