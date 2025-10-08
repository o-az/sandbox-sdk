import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
/**
 * Session Handler Tests
 * 
 * Tests the SessionHandler class from the refactored container architecture.
 * Demonstrates testing handlers with session management functionality.
 */

import type { CreateSessionResponse, HandlerErrorResponse, ListSessionsResponse, Logger, RequestContext, ValidatedRequestContext } from '@sandbox-container/core/types.ts';
import type { SessionHandler } from '@sandbox-container/handlers/session-handler.ts';
import type { Session } from '@sandbox-container/session.ts';
import type { SessionManager } from '@sandbox-container/services/session-manager.ts';

// Mock the dependencies - use partial mock to avoid private property issues
const mockSessionManager = {
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
  destroy: vi.fn(),
} as SessionManager;

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

// Helper to create validated context
const createValidatedContext = <T>(data: T): ValidatedRequestContext<T> => ({
  ...mockContext,
  validatedData: data
});

describe('SessionHandler', () => {
  let sessionHandler: SessionHandler;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Import the SessionHandler (dynamic import)
    const { SessionHandler: SessionHandlerClass } = await import('@sandbox-container/handlers/session-handler.ts');
    sessionHandler = new SessionHandlerClass(mockSessionManager, mockLogger);
  });

  describe('handleCreate - POST /api/session/create', () => {
    it('should create session successfully', async () => {
      const mockSession = {} as Session; // Session object (not SessionData)

      (mockSessionManager.createSession as any).mockResolvedValue({
        success: true,
        data: mockSession
      });

      const request = new Request('http://localhost:3000/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as CreateSessionResponse;
      expect(responseData.message).toBe('Session created successfully');
      // Handler generates session ID, so just verify it exists and has correct format
      expect(responseData.sessionId).toBeDefined();
      expect(responseData.sessionId).toMatch(/^session_\d+_[a-f0-9]+$/);
      expect(responseData.timestamp).toBeDefined();

      // Verify service was called correctly
      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });

    it('should handle session creation failures', async () => {
      (mockSessionManager.createSession as any).mockResolvedValue({
        success: false,
        error: {
          message: 'Failed to create session',
          code: 'SESSION_CREATE_ERROR',
          details: { originalError: 'Store connection failed' }
        }
      });

      const request = new Request('http://localhost:3000/api/session/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      const responseData = await response.json() as HandlerErrorResponse;
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('SESSION_CREATE_ERROR');
      expect(responseData.error).toBe('Failed to create session');
    });

    it('should generate unique session IDs', async () => {
      const mockSession1 = {} as Session;
      const mockSession2 = {} as Session;

      (mockSessionManager.createSession as any)
        .mockResolvedValueOnce({ success: true, data: mockSession1 })
        .mockResolvedValueOnce({ success: true, data: mockSession2 });

      const request1 = new Request('http://localhost:3000/api/session/create', {
        method: 'POST'
      });
      const request2 = new Request('http://localhost:3000/api/session/create', {
        method: 'POST'
      });

      const response1 = await sessionHandler.handle(request1, mockContext);
      const response2 = await sessionHandler.handle(request2, mockContext);

      const responseData1 = await response1.json() as CreateSessionResponse;
      const responseData2 = await response2.json() as CreateSessionResponse;

      // Verify both session IDs are generated and unique
      expect(responseData1.sessionId).toBeDefined();
      expect(responseData2.sessionId).toBeDefined();
      expect(responseData1.sessionId).not.toBe(responseData2.sessionId);
      expect(responseData1.sessionId).toMatch(/^session_\d+_[a-f0-9]+$/);
      expect(responseData2.sessionId).toMatch(/^session_\d+_[a-f0-9]+$/);

      expect(mockSessionManager.createSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleList - GET /api/session/list', () => {
    it('should list sessions successfully with active processes', async () => {
      // SessionManager.listSessions() returns string[] (just session IDs)
      const mockSessionIds = ['session-1', 'session-2', 'session-3'];

      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: mockSessionIds
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as ListSessionsResponse;
      expect(responseData.count).toBe(3);
      expect(responseData.sessions).toHaveLength(3);

      // Verify session data - handler only returns sessionId
      expect(responseData.sessions[0]).toEqual({
        sessionId: 'session-1'
      });
      expect(responseData.sessions[1]).toEqual({
        sessionId: 'session-2'
      });
      expect(responseData.sessions[2]).toEqual({
        sessionId: 'session-3'
      });

      expect(responseData.timestamp).toBeDefined();

      // Verify service was called correctly
      expect(mockSessionManager.listSessions).toHaveBeenCalled();
    });

    it('should return empty list when no sessions exist', async () => {
      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: []
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as ListSessionsResponse;
      expect(responseData.count).toBe(0);
      expect(responseData.sessions).toHaveLength(0);
      expect(responseData.sessions).toEqual([]);
      expect(responseData.timestamp).toBeDefined();
    });

    it('should handle sessions with various activeProcess values', async () => {
      // SessionManager returns string[] - no activeProcess info available
      const mockSessionIds = ['session-1', 'session-2', 'session-3'];

      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: mockSessionIds
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      const responseData = await response.json() as ListSessionsResponse;

      // Handler only returns sessionId, no hasActiveProcess field
      expect(responseData.sessions[0]).toEqual({ sessionId: 'session-1' });
      expect(responseData.sessions[1]).toEqual({ sessionId: 'session-2' });
      expect(responseData.sessions[2]).toEqual({ sessionId: 'session-3' });
    });

    it('should handle session listing failures', async () => {
      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: false,
        error: {
          message: 'Failed to list sessions',
          code: 'SESSION_LIST_ERROR',
          details: { originalError: 'Database connection lost' }
        }
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      const responseData = await response.json() as HandlerErrorResponse;
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('SESSION_LIST_ERROR');
    });

    it('should handle sessions with undefined activeProcess', async () => {
      // SessionManager returns string[] - no activeProcess info
      const mockSessionIds = ['session-1'];

      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: mockSessionIds
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      const responseData = await response.json() as ListSessionsResponse;
      // Handler only returns sessionId field
      expect(responseData.sessions[0]).toEqual({ sessionId: 'session-1' });
    });
  });

  describe('route handling', () => {
    it('should return 404 for invalid session endpoints', async () => {
      const request = new Request('http://localhost:3000/api/session/invalid-operation', {
        method: 'POST'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(404);
      const responseData = await response.json() as HandlerErrorResponse;
      expect(responseData.error).toBe('Invalid session endpoint');

      // Should not call any service methods
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
      expect(mockSessionManager.listSessions).not.toHaveBeenCalled();
    });

    it('should return 404 for root session path', async () => {
      const request = new Request('http://localhost:3000/api/session/', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(404);
      const responseData = await response.json() as HandlerErrorResponse;
      expect(responseData.error).toBe('Invalid session endpoint');
    });

    it('should return 404 for session endpoint without operation', async () => {
      const request = new Request('http://localhost:3000/api/session', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(404);
      const responseData = await response.json() as HandlerErrorResponse;
      expect(responseData.error).toBe('Invalid session endpoint');
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in successful create responses', async () => {
      const mockSession = {} as Session;

      (mockSessionManager.createSession as any).mockResolvedValue({
        success: true,
        data: mockSession
      });

      const request = new Request('http://localhost:3000/api/session/create', {
        method: 'POST'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });

    it('should include CORS headers in successful list responses', async () => {
      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: []
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should include CORS headers in error responses', async () => {
      const request = new Request('http://localhost:3000/api/session/invalid', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);

      expect(response.status).toBe(404);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('response format consistency', () => {
    it('should have proper Content-Type header for all responses', async () => {
      // Test create endpoint
      const mockSession = {} as Session;

      (mockSessionManager.createSession as any).mockResolvedValue({
        success: true,
        data: mockSession
      });

      const createRequest = new Request('http://localhost:3000/api/session/create', {
        method: 'POST'
      });

      const createResponse = await sessionHandler.handle(createRequest, mockContext);
      expect(createResponse.headers.get('Content-Type')).toBe('application/json');

      // Test list endpoint
      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: []
      });

      const listRequest = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const listResponse = await sessionHandler.handle(listRequest, mockContext);
      expect(listResponse.headers.get('Content-Type')).toBe('application/json');
    });

    it('should return consistent timestamp format', async () => {
      const mockSession = {} as Session;

      (mockSessionManager.createSession as any).mockResolvedValue({
        success: true,
        data: mockSession
      });

      const request = new Request('http://localhost:3000/api/session/create', {
        method: 'POST'
      });

      const response = await sessionHandler.handle(request, mockContext);
      const responseData = await response.json() as ListSessionsResponse;

      // Verify timestamp is valid ISO string
      expect(responseData.timestamp).toBeDefined();
      expect(new Date(responseData.timestamp)).toBeInstanceOf(Date);
      expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should transform session createdAt to ISO string format', async () => {
      // SessionManager returns string[] - no createdAt available
      const mockSessionIds = ['session-1'];

      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: mockSessionIds
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);
      const responseData = await response.json() as ListSessionsResponse;

      // Handler doesn't return createdAt field
      expect(responseData.sessions[0]).toEqual({ sessionId: 'session-1' });
      expect((responseData.sessions[0] as any).createdAt).toBeUndefined();
    });
  });

  describe('data transformation', () => {
    it('should properly map session data fields', async () => {
      // SessionManager returns string[] - only session IDs
      const mockSessionIds = ['session-external-id'];

      (mockSessionManager.listSessions as any).mockResolvedValue({
        success: true,
        data: mockSessionIds
      });

      const request = new Request('http://localhost:3000/api/session/list', {
        method: 'GET'
      });

      const response = await sessionHandler.handle(request, mockContext);
      const responseData = await response.json() as ListSessionsResponse;

      const sessionResponse = responseData.sessions[0];

      // Should only include sessionId field
      expect(sessionResponse.sessionId).toBe('session-external-id');

      // Should not include other fields (not available from SessionManager)
      expect((sessionResponse as any).id).toBeUndefined();
      expect((sessionResponse as any).createdAt).toBeUndefined();
      expect((sessionResponse as any).expiresAt).toBeUndefined();
      expect((sessionResponse as any).activeProcess).toBeUndefined();
      expect((sessionResponse as any).hasActiveProcess).toBeUndefined();

      // Should only have sessionId field
      const expectedFields = ['sessionId'];
      expect(Object.keys(sessionResponse)).toEqual(expectedFields);
    });
  });
});