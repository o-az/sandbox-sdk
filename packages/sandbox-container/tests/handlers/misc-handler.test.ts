import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { ErrorResponse } from '@repo/shared/errors';
import type { Logger, RequestContext, ValidatedRequestContext } from '@sandbox-container/core/types';
import { MiscHandler } from '@sandbox-container/handlers/misc-handler';

// Response types matching new format
interface SuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

interface PingData {
  message: string;
  timestamp: string;
  requestId: string;
}

interface CommandsData {
  availableCommands: string[];
  timestamp: string;
}

// Mock the dependencies
const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock request context
const mockContext: RequestContext = {
  requestId: 'req-123',
  timestamp: new Date(),
  corsHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
  sessionId: 'session-456',
};

describe('MiscHandler', () => {
  let miscHandler: MiscHandler;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    miscHandler = new MiscHandler(mockLogger);
  });

  describe('handleRoot - GET /', () => {
    it('should return welcome message with text/plain content type', async () => {
      const request = new Request('http://localhost:3000/', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Hello from Bun server! 🚀');
      expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    });

    it('should include CORS headers in root response', async () => {
      const request = new Request('http://localhost:3000/', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });

    it('should handle different HTTP methods on root', async () => {
      const methods = ['GET', 'POST', 'PUT', 'DELETE'];
      
      for (const method of methods) {
        const request = new Request('http://localhost:3000/', {
          method
        });

        const response = await miscHandler.handle(request, mockContext);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('Hello from Bun server! 🚀');
      }
    });
  });

  describe('handlePing - GET /api/ping', () => {
    it('should return pong response with JSON content type', async () => {
      const request = new Request('http://localhost:3000/api/ping', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const responseData = await response.json() as SuccessResponse<PingData>;
      expect(responseData.success).toBe(true);
      expect(responseData.data.message).toBe('pong');
      expect(responseData.data.requestId).toBe('req-123');
      expect(responseData.data.timestamp).toBeDefined();
      expect(responseData.timestamp).toBeDefined();

      // Verify timestamp format
      expect(responseData.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(responseData.data.timestamp)).toBeInstanceOf(Date);
      expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include CORS headers in ping response', async () => {
      const request = new Request('http://localhost:3000/api/ping', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });

    it('should handle ping requests with different HTTP methods', async () => {
      const methods = ['GET', 'POST', 'PUT'];

      for (const method of methods) {
        vi.clearAllMocks(); // Clear mocks between iterations

        const request = new Request('http://localhost:3000/api/ping', {
          method
        });

        const response = await miscHandler.handle(request, mockContext);

        expect(response.status).toBe(200);
        const responseData = await response.json() as SuccessResponse<PingData>;
        expect(responseData.success).toBe(true);
        expect(responseData.data.message).toBe('pong');
      }
    });

    it('should return unique timestamps for multiple ping requests', async () => {
      const request1 = new Request('http://localhost:3000/api/ping', {
        method: 'GET'
      });
      const request2 = new Request('http://localhost:3000/api/ping', {
        method: 'GET'
      });

      const response1 = await miscHandler.handle(request1, mockContext);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 5));
      const response2 = await miscHandler.handle(request2, mockContext);

      const responseData1 = await response1.json() as SuccessResponse<PingData>;
      const responseData2 = await response2.json() as SuccessResponse<PingData>;

      expect(responseData1.data.timestamp).not.toBe(responseData2.data.timestamp);
      expect(new Date(responseData1.data.timestamp).getTime()).toBeLessThan(
        new Date(responseData2.data.timestamp).getTime()
      );
    });
  });

  describe('handleCommands - GET /api/commands', () => {
    it('should return list of available commands', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const responseData = await response.json() as SuccessResponse<CommandsData>;
      expect(responseData.success).toBe(true);
      expect(responseData.data.availableCommands).toBeDefined();
      expect(Array.isArray(responseData.data.availableCommands)).toBe(true);
      expect(responseData.data.availableCommands.length).toBeGreaterThan(0);
      expect(responseData.data.timestamp).toBeDefined();
      expect(responseData.timestamp).toBeDefined();
    });

    it('should include expected common commands', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);
      const responseData = await response.json() as SuccessResponse<CommandsData>;

      const expectedCommands = [
        'ls', 'pwd', 'echo', 'cat', 'grep', 'find',
        'whoami', 'date', 'uptime', 'ps', 'top',
        'df', 'du', 'free', 'node', 'npm', 'git',
        'curl', 'wget'
      ];

      for (const command of expectedCommands) {
        expect(responseData.data.availableCommands).toContain(command);
      }

      // Verify exact count matches implementation
      expect(responseData.data.availableCommands).toHaveLength(19);
    });

    it('should return consistent command list across requests', async () => {
      const request1 = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });
      const request2 = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response1 = await miscHandler.handle(request1, mockContext);
      const response2 = await miscHandler.handle(request2, mockContext);

      const responseData1 = await response1.json() as SuccessResponse<CommandsData>;
      const responseData2 = await response2.json() as SuccessResponse<CommandsData>;

      expect(responseData1.data.availableCommands).toEqual(responseData2.data.availableCommands);
      expect(responseData1.data.availableCommands.length).toBe(responseData2.data.availableCommands.length);
    });

    it('should include CORS headers in commands response', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });

    it('should return proper timestamp format', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);
      const responseData = await response.json() as SuccessResponse<CommandsData>;

      expect(responseData.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(responseData.data.timestamp)).toBeInstanceOf(Date);
      expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should include essential system commands', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);
      const responseData = await response.json() as SuccessResponse<CommandsData>;

      const essentialCommands = ['ls', 'cat', 'echo', 'pwd', 'whoami'];
      for (const command of essentialCommands) {
        expect(responseData.data.availableCommands).toContain(command);
      }
    });

    it('should include development tools', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);
      const responseData = await response.json() as SuccessResponse<CommandsData>;

      const devTools = ['node', 'npm', 'git'];
      for (const tool of devTools) {
        expect(responseData.data.availableCommands).toContain(tool);
      }
    });

    it('should include network utilities', async () => {
      const request = new Request('http://localhost:3000/api/commands', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);
      const responseData = await response.json() as SuccessResponse<CommandsData>;

      const networkUtils = ['curl', 'wget'];
      for (const util of networkUtils) {
        expect(responseData.data.availableCommands).toContain(util);
      }
    });
  });

  describe('route handling', () => {
    it('should return 500 for invalid endpoints', async () => {
      const request = new Request('http://localhost:3000/invalid-endpoint', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      const responseData = await response.json() as ErrorResponse;
      expect(responseData.message).toBe('Invalid endpoint');
      expect(responseData.code).toBeDefined();
      expect(responseData.httpStatus).toBe(500);
      expect(responseData.timestamp).toBeDefined();
      expect(responseData.context).toBeDefined();
    });

    it('should return 500 for non-existent API endpoints', async () => {
      const request = new Request('http://localhost:3000/api/nonexistent', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      const responseData = await response.json() as ErrorResponse;
      expect(responseData.message).toBe('Invalid endpoint');
      expect(responseData.code).toBeDefined();
      expect(responseData.httpStatus).toBe(500);
      expect(responseData.timestamp).toBeDefined();
      expect(responseData.context).toBeDefined();
    });

    it('should include CORS headers in error responses', async () => {
      const request = new Request('http://localhost:3000/invalid', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('response format consistency', () => {
    it('should have consistent JSON response structure for API endpoints', async () => {
      const apiEndpoints = [
        { path: '/api/ping', expectedFields: ['message', 'timestamp', 'requestId'] },
        { path: '/api/commands', expectedFields: ['availableCommands', 'timestamp'] }
      ];

      for (const endpoint of apiEndpoints) {
        const request = new Request(`http://localhost:3000${endpoint.path}`, {
          method: 'GET'
        });

        const response = await miscHandler.handle(request, mockContext);
        const responseData = await response.json() as SuccessResponse<any>;

        // Verify success wrapper structure
        expect(responseData.success).toBe(true);
        expect(responseData.data).toBeDefined();
        expect(responseData.timestamp).toBeDefined();
        expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        // Verify all expected fields are present in data
        for (const field of endpoint.expectedFields) {
          expect(responseData.data).toHaveProperty(field);
        }

        // Verify data timestamp is properly formatted
        expect(responseData.data.timestamp).toBeDefined();
        expect(responseData.data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    });

    it('should have proper Content-Type headers for different response types', async () => {
      const endpoints = [
        { path: '/', expectedContentType: 'text/plain; charset=utf-8' },
        { path: '/api/ping', expectedContentType: 'application/json' },
        { path: '/api/commands', expectedContentType: 'application/json' }
      ];

      for (const endpoint of endpoints) {
        const request = new Request(`http://localhost:3000${endpoint.path}`, {
          method: 'GET'
        });

        const response = await miscHandler.handle(request, mockContext);
        expect(response.headers.get('Content-Type')).toBe(endpoint.expectedContentType);
      }
    });

    it('should handle requests with different context properties', async () => {
      const alternativeContext: RequestContext = {
        requestId: 'req-alternative-456',
        timestamp: new Date(),
        corsHeaders: {
          'Access-Control-Allow-Origin': 'https://example.com',
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Authorization',
        },
        sessionId: 'session-alternative',
      };

      const request = new Request('http://localhost:3000/api/ping', {
        method: 'GET'
      });

      const response = await miscHandler.handle(request, alternativeContext);
      const responseData = await response.json() as SuccessResponse<PingData>;

      expect(responseData.success).toBe(true);
      expect(responseData.data.requestId).toBe('req-alternative-456');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization');
    });
  });

  describe('no service dependencies', () => {
    it('should work without any service dependencies', async () => {
      // MiscHandler only requires logger, no other services
      const simpleLogger: Logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      };

      const independentHandler = new MiscHandler(simpleLogger);

      const request = new Request('http://localhost:3000/api/ping', {
        method: 'GET'
      });

      const response = await independentHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as SuccessResponse<PingData>;
      expect(responseData.success).toBe(true);
      expect(responseData.data.message).toBe('pong');
    });
  });
});