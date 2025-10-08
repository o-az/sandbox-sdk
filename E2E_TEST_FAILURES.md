# E2E Test Failures - Historical Record (ALL BUGS FIXED ✅)

**Date**: 2025-10-08
**Branch**: refactor-with-tests
**Status**: ✅ **ALL BUGS FIXED** - 12/12 tests passing

**Context**: During Phase 1 E2E test implementation, tests revealed real bugs in the refactored codebase. This document preserves the investigation process and architectural insights learned.

---

## Final Test Status

**All Passing**: 12/12 tests (100%)
- ✅ git-clone-workflow.test.ts: 5/5 tests passing
- ✅ process-lifecycle-workflow.test.ts: 7/7 tests passing

---

## Bug #1: listProcesses() Returns Empty Array ✅ ROOT CAUSE FOUND

**Symptom**: `listProcesses()` returns `[]` even when multiple processes are running

**Affected Tests**:
- `should list all running processes` - Starts 2 sleep processes, list returns 0
- `should kill all processes at once` - Starts 3 sleep processes, list returns 0

**Test Evidence**:
```typescript
// Start 2 processes with sleep 60
const process1Response = await fetch('/api/process/start', {
  body: JSON.stringify({ command: 'sleep 60', sessionId: sandboxId })
});
const process2Response = await fetch('/api/process/start', {
  body: JSON.stringify({ command: 'sleep 60', sessionId: sandboxId })
});

// List returns []
const listResponse = await fetch('/api/process/list?sessionId=${sandboxId}');
const listData = await listResponse.json();
console.log(listData.length); // Expected: >= 2, Actual: 0
```

**Container Logs Show**:
```javascript
// Starting process - NO sessionId in options
[INFO] Starting process {"command":"sleep 60","options":{}}

// Listing processes - sessionId IS provided
[INFO] Listing processes {"sessionId":"sandbox-c520980b-0cfe-4e95-bdd3-5b5c869d2992"}
```

**Initial Investigation** (WRONG APPROACH):
1. ❌ Thought: Processes created without sessionId, so filtering doesn't match
2. ❌ Attempted Fix: Modified `process-handler.ts` to extract sessionId from context
3. ❌ Problem: This assumes sessionId filtering is correct design

**Root Cause Analysis - Session Semantics**:

After reviewing README.md Session Management section (lines 711-776):

**Key Insight**: Sessions are like **terminal panes**, not process isolation boundaries.

- **What Sessions ARE**: Isolated shell contexts with different:
  - Working directories (cwd)
  - Environment variables
  - Command history/state

- **What Sessions ARE NOT**: Process ownership boundaries

**Real-World Analogy**:
```bash
# Terminal 1
$ cd /app && node server.js &  # Start background process

# Terminal 2
$ ps aux | grep node           # Can see the server process!
$ kill <pid>                   # Can kill it from different terminal
```

**In Linux**: Background processes are **system-wide**, visible and controllable from any terminal.

**In Sandbox SDK**: Background processes should be **sandbox-wide**, visible and controllable from any session.

**The Design Error**:
```typescript
// Current (WRONG) - processes filtered by sessionId
async listProcesses(filters?: ProcessFilters): Promise<ProcessRecord[]> {
  let processes = Array.from(this.processes.values());

  if (filters?.sessionId) {
    processes = processes.filter(p => p.sessionId === filters.sessionId);
  }

  return processes;
}
```

**Why This Is Wrong**:
1. Sessions are execution contexts (shells), not process namespaces
2. A process started in session1 should be visible/killable from session2
3. The process store is already scoped to the Durable Object (sandbox)
4. Adding sessionId filtering defeats cross-session process management

**Use Case That Breaks**:
```typescript
const sandbox = getSandbox(env.Sandbox, "my-app");

// Session 1: Start a server
const devSession = await sandbox.createSession({ name: "dev" });
await devSession.startProcess("node server.js");

// Session 2: Try to kill the server (e.g., for monitoring/cleanup)
const opsSession = await sandbox.createSession({ name: "ops" });
const processes = await opsSession.listProcesses();
// RETURNS [] because server has devSession's sessionId!
```

**The Correct Fix**:
- Remove sessionId filtering from `listProcesses()` entirely
- Processes should be sandbox-scoped, not session-scoped
- All sessions in a sandbox should see all processes

**Files to Fix**:
- `packages/sandbox-container/src/services/process-service.ts:65-91` - Remove sessionId filter
- `packages/sandbox-container/src/handlers/process-handler.ts:106` - Remove sessionId from filters
- Tests should pass without modification

---

## Bug #2: exposePort() Validation Error ✅ ROOT CAUSE FOUND

**Symptom**: `exposePort()` throws "Validation Error" despite providing all required parameters

**Affected Tests**:
- `should expose port and verify HTTP access`
- `should handle complete workflow: write → start → monitor → expose → request → cleanup`

**Test Evidence**:
```typescript
// Write Bun server to /workspace/app.js
await sandbox.writeFile('/workspace/app.js', serverCode);

// Start server on port 3000
const startResponse = await sandbox.startProcess('bun run /workspace/app.js');

// Expose port - FAILS HERE
const exposeResponse = await fetch('/api/port/expose', {
  body: JSON.stringify({
    port: 3000,  // ❌ BLOCKED PORT
    name: 'test-server',
    sessionId: sandboxId
  })
});
// Response: 500 Internal Server Error
// Error: [Container] Command error: Validation Error
```

**Root Cause**:

Found in `packages/sandbox-container/src/security/security-service.ts:248-250`:

```typescript
// Additional high-risk ports
if (port === 3000) {
  errors.push('Port 3000 is reserved for the container control plane');
}
```

**Why Port 3000 is Blocked**:
- Port 3000 is the container's HTTP control plane port
- Used for all container API endpoints (`/api/process/start`, `/api/file/write`, etc.)
- Exposing it would create a conflict with the control plane
- Security validation correctly rejects it

**The Correct Fix**:
- Use a port NOT in the RESERVED_PORTS list
- Port must be between 1024-65535 (user ports)
- **Blocked ports**:
  - System: 22 (SSH), 25 (SMTP), 53 (DNS), 80 (HTTP), 443 (HTTPS), etc.
  - Databases: 3306 (MySQL), 5432 (PostgreSQL), 6379 (Redis), 27017 (MongoDB)
  - Container/orchestration: 2375, 2376 (Docker), 6443 (K8s), **8080** (alt HTTP), 9000
  - Container control plane: **3000** (special case)
- **Safe development ports**: 4000, 5000, 7000, 8000

**Files Fixed**:
- `tests/e2e/process-lifecycle-workflow.test.ts:313` - Changed Bun.serve port: 3000 → 8080 → 4000
- `tests/e2e/process-lifecycle-workflow.test.ts:322` - Updated log message
- `tests/e2e/process-lifecycle-workflow.test.ts:367` - Changed exposePort call: 3000 → 8080 → 4000
- `tests/e2e/process-lifecycle-workflow.test.ts:458` - Changed complete workflow port: 8080 → 4000
- `tests/e2e/process-lifecycle-workflow.test.ts:526` - Changed complete workflow exposePort: 8080 → 4000
- `tests/e2e/process-lifecycle-workflow.test.ts:549` - Updated log assertion: 8080 → 4000

---

## Investigation Priority

1. **Bug #1 (listProcesses)** - Higher priority, blocking multiple tests
2. **Bug #2 (exposePort)** - Important but only blocks 2 tests

---

## Debug Strategy

### For Bug #1 (listProcesses):
1. Add logging to `test-worker/index.ts` to see what sessionId is being used
2. Check `ProcessService.listProcesses()` to see how it queries the store
3. Verify session parameter is passed correctly through the stack
4. Check if processes are actually being created in the store

### For Bug #2 (exposePort):
1. Check what "Validation Error" actually means (which validation failed?)
2. Add detailed error logging to see validation failure reason
3. Verify port is actually listening before exposing
4. Check hostname format requirements

---

## Notes

- All passing tests use simple operations (exec, readFile, writeFile, gitCheckout)
- Failures are in **advanced features** introduced in refactor:
  - Process management (listing, killing)
  - Port exposure and proxying
- This suggests refactor broke these features or introduced stricter validation

---

## Next Steps

1. Start with Bug #1 - add logging and trace through listProcesses() call
2. Once Bug #1 fixed, tackle Bug #2 with better error messages
3. Re-run full test suite to verify fixes
4. Continue with remaining Phase 1 scenarios (File Operations workflow)
