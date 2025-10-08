# End-to-End Test Plan for Sandbox SDK

**Goal**: Comprehensive integration testing of all SDK methods in realistic workflows that match production usage patterns from the README.

**Date**: 2024-10-08
**Status**: ✅ Phase 2 In Progress - 20/20 tests passing

## Test Summary

**Phase 1 Complete** (12/12 tests):
- `git-clone-workflow.test.ts` - 5 tests for Git operations
- `process-lifecycle-workflow.test.ts` - 7 tests for process management and port exposure

**Phase 2 In Progress** (8/8 tests):
- `file-operations-workflow.test.ts` - 8 tests for file system operations

**Total**: 20/20 tests passing (100%)

**SDK Methods Covered:** 19 methods tested across 19 test scenarios
- Git: `gitCheckout()`
- Files: `writeFile()`, `readFile()`, `mkdir()`, `deleteFile()`, `renameFile()`, `moveFile()`
- Processes: `startProcess()`, `listProcesses()`, `getProcess()`, `killProcess()`, `killAllProcesses()`, `getProcessLogs()`, `streamProcessLogs()`
- Ports: `exposePort()`, `getExposedPorts()`, port proxying via `proxyToSandbox()`
- Commands: `exec()`

**Real Bugs Found & Fixed:**
1. Process listing broken (incorrect sessionId filtering)
2. Port validation too restrictive (blocked common dev ports)
3. Preview URL routing not configured
4. Local dev port exposure missing
5. URL concatenation creating double slashes
6. mkdir missing recursive option in test-worker
7. deleteFile incorrectly accepting directories (fixed with IS_DIRECTORY validation)

---

## SDK API Coverage Matrix

### ✅ Currently Tested
**Basic Operations:**
- `exec()` - Command execution (git-clone-workflow.test.ts)
- `writeFile()` / `readFile()` - File I/O (git-clone-workflow.test.ts, process-lifecycle-workflow.test.ts, file-operations-workflow.test.ts)
- `gitCheckout()` - Git clone with branches (git-clone-workflow.test.ts)

**File Operations:**
- `mkdir()` - Create directories with recursive support (file-operations-workflow.test.ts)
- `deleteFile()` - Delete files only (directories return IS_DIRECTORY error) (file-operations-workflow.test.ts)
- `renameFile()` - Rename files (file-operations-workflow.test.ts)
- `moveFile()` - Move files between directories (file-operations-workflow.test.ts)

**Process Management:**
- `startProcess()` - Background process execution (process-lifecycle-workflow.test.ts)
- `listProcesses()` - List all running processes (process-lifecycle-workflow.test.ts)
- `getProcess(id)` - Get process status and details (process-lifecycle-workflow.test.ts)
- `killProcess(id)` - Terminate specific process (process-lifecycle-workflow.test.ts)
- `killAllProcesses()` - Cleanup all processes (process-lifecycle-workflow.test.ts)
- `streamProcessLogs(id)` - Stream process logs via SSE (process-lifecycle-workflow.test.ts)
- `getProcessLogs(id)` - Get accumulated logs (process-lifecycle-workflow.test.ts)

**Port Management:**
- `exposePort()` - Expose ports with preview URLs (process-lifecycle-workflow.test.ts)
- `getExposedPorts()` - List exposed ports (process-lifecycle-workflow.test.ts)
- Port proxying - HTTP requests to exposed services (process-lifecycle-workflow.test.ts)

### ❌ Not Yet Tested (High Priority)
**Command Execution:**
- `execStream()` - Streaming command output
- Streaming with callbacks (`exec()` with `stream: true`)

**Port Management:**
- `unexposePort()` - Remove port exposure

**Session Management:**
- `createSession()` - Create isolated execution contexts
- Multiple sessions with different environments
- Session isolation verification
- `setEnvVars()` - Set environment variables

**Code Interpreter (Future):**
- `createCodeContext()` - Create Python/JS contexts
- `runCode()` - Execute code with rich outputs
- `runCodeStream()` - Streaming code execution
- `listCodeContexts()` - List active contexts
- `deleteCodeContext()` - Cleanup contexts

---

## Test Scenarios (Organized by Realistic Workflows)

### Scenario 1: **Git-to-Production Workflow** ✅ Complete (5/5 tests passing)
**README Example**: "Build and Test Code" (lines 473-494)
**Test File**: `git-clone-workflow.test.ts`

**Complete Flow:**
```
Clone repo → Verify files → Check branches → Validate content
```

**Tests:**
- ✅ Clone public repository to default directory
- ✅ Clone to custom target directory
- ✅ Clone specific branch
- ✅ Verify repository content and structure
- ✅ Session state persistence across operations

---

### Scenario 2: **Process Lifecycle & Port Exposure** ✅ Complete (7/7 tests passing)
**README Examples**: "Run a Node.js App" (443-471), "Expose Services" (516-538)
**Test File**: `process-lifecycle-workflow.test.ts`

**Complete Flow:**
```
Write server code → Start process → Monitor logs → Expose port → HTTP requests → Cleanup
```

**Tests:**
- ✅ Start background process and verify it runs
- ✅ List all running processes
- ✅ Get process logs after execution
- ✅ Stream process logs in real-time (SSE)
- ✅ Expose port and verify HTTP access via preview URL
- ✅ Kill all processes at once
- ✅ Complete workflow: write → start → monitor → expose → request → cleanup

**SDK Methods Tested:**
- `writeFile()` - Write Bun server code
- `startProcess()` - Start background server
- `listProcesses()` - List all processes
- `getProcess(id)` - Check process status
- `getProcessLogs(id)` - Get accumulated logs
- `streamProcessLogs(id)` - Stream logs via SSE
- `killProcess(id)` - Terminate specific process
- `killAllProcesses()` - Cleanup all processes
- `exposePort()` - Get preview URL
- `getExposedPorts()` - List exposed ports
- Port proxying - Actual HTTP requests to exposed services

---

### Scenario 3: **File System Operations** ✅ Complete (8/8 tests passing)
**Realistic Use Case**: Project scaffolding and file manipulation

**Complete Flow:**
```
Create directory structure → Write files → Rename/move → Verify → Cleanup
```

**Tests:**
- ✅ Create nested directories with recursive option
- ✅ Write files in subdirectories and read them back
- ✅ Rename files (README.txt → README.md)
- ✅ Move files between directories (source/ → destination/)
- ✅ Delete files with deleteFile()
- ✅ Reject deleting directories with deleteFile (IS_DIRECTORY error validation)
- ✅ Delete directories recursively using exec('rm -rf')
- ✅ Complete project scaffolding workflow (create → write → rename → move → cleanup)

**SDK Methods Tested:**
- `mkdir()` - Create nested directories with `recursive: true`
- `writeFile()` - Write files in subdirectories
- `readFile()` - Verify file content
- `renameFile()` - Rename files
- `moveFile()` - Move files between directories
- `deleteFile()` - Delete files only (strict file-only validation)
- `exec()` - Verify file system state and delete directories

**Test File**: `tests/e2e/file-operations-workflow.test.ts` (560 lines)

---

### Scenario 5: **Port Exposure and Proxying** ❌ Not Started
**README Example**: "Expose Services with Preview URLs" (lines 516-538)

**Complete Flow:**
```
Write server → Start server → Expose port → HTTP request → Unexpose → Verify removal
```

**SDK Methods to Test:**
- `writeFile()` - Create server code
- `startProcess()` - Start Bun server
- `exposePort()` - Get preview URL
- HTTP GET/POST to preview URL (verify proxying works)
- `getExposedPorts()` - List active ports
- `unexposePort()` - Remove exposure
- Verify 404 after unexpose

**Test File**: `port-exposure-workflow.test.ts` (to create)

---

### Scenario 6: **Session Isolation** ❌ Not Started
**README Example**: "Session Management" (lines 711-754)

**Complete Flow:**
```
Create multiple sessions → Run commands in each → Verify isolation → Cleanup
```

**SDK Methods to Test:**
- `createSession()` - Create isolated contexts
- `session.exec()` - Execute in specific session
- Verify environment variables don't leak
- Verify working directory isolation
- Verify file system isolation

**Test File**: `session-isolation-workflow.test.ts` (to create)

---

### Scenario 7: **Streaming Operations** ❌ Not Started
**README Example**: "AsyncIterable Streaming Support" (lines 636-661)

**Complete Flow:**
```
Start long command → Stream output in real-time → Handle events → Completion
```

**SDK Methods to Test:**
- `execStream()` - Stream command output
- `parseSSEStream()` - Parse SSE events
- Event types: start, stdout, stderr, complete, error
- `streamProcessLogs()` - Stream from background process
- Handle stream interruption

**Test File**: `streaming-workflow.test.ts` (to create)

---

### Scenario 8: **Error Handling and Edge Cases** ❌ Not Started
**Realistic Use Case**: Validate SDK behavior under failure conditions

**Complete Flow:**
```
Invalid commands → Nonexistent files → Bad permissions → Process crashes
```

**SDK Methods to Test:**
- `exec()` with failing commands (exit code != 0)
- `readFile()` with nonexistent paths
- `gitCheckout()` with invalid repos
- `startProcess()` with invalid commands
- `killProcess()` with nonexistent IDs
- Error message quality and codes

**Test File**: `error-scenarios-workflow.test.ts` (to create)

---

### Scenario 9: **Environment Variables** ❌ Not Started
**README Example**: `setEnvVars()` (lines 210-230)

**Complete Flow:**
```
Set env vars → Verify in commands → Create session with env → Verify isolation
```

**SDK Methods to Test:**
- `setEnvVars()` - Set global environment
- Verify with `exec("echo $VAR")`
- `createSession()` with custom env
- Verify session-specific env doesn't leak

**Test File**: `environment-workflow.test.ts` (to create)

---

### Scenario 10: **Code Interpreter** ❌ Future (Not in Current Scope)
**README Example**: "Code Interpreter" (lines 265-381)

**Complete Flow:**
```
Create Python context → Run code → Get rich outputs → Switch to JS → Cleanup
```

**SDK Methods to Test:**
- `createCodeContext()` - Python and JavaScript
- `runCode()` - Execute with callbacks
- Rich output formats (PNG, HTML, JSON)
- `listCodeContexts()` - Enumerate
- `deleteCodeContext()` - Cleanup

**Test File**: `code-interpreter-workflow.test.ts` (future)

---

## Test Worker Implementation Status

### Current Test Worker Endpoints (tests/e2e/test-worker/index.ts)
```
✅ POST /api/execute                  - exec()
✅ POST /api/git/clone                - gitCheckout()
✅ POST /api/file/read                - readFile()
✅ POST /api/file/write               - writeFile()
✅ proxyToSandbox()                   - Preview URL routing (CRITICAL for port exposure)
```

**Process Management (Phase 1 - Complete):**
```
✅ POST   /api/process/start          - startProcess()
✅ GET    /api/process/list           - listProcesses()
✅ GET    /api/process/:id            - getProcess(id)
✅ DELETE /api/process/:id            - killProcess(id)
✅ POST   /api/process/kill-all       - killAllProcesses()
✅ GET    /api/process/:id/logs       - getProcessLogs(id)
✅ GET    /api/process/:id/stream     - streamProcessLogs(id) [SSE]
```

**Port Management (Phase 1 - Complete):**
```
✅ POST   /api/port/expose            - exposePort()
✅ GET    /api/port/list              - getExposedPorts() (via GET /api/exposed-ports)
```

**File Operations (Phase 2 - Complete):**
```
✅ POST   /api/file/mkdir            - mkdir()
✅ DELETE /api/file/delete           - deleteFile()
✅ POST   /api/file/rename           - renameFile()
✅ POST   /api/file/move             - moveFile()
```

### Missing Endpoints (Need to Add)

**Port Management:**
```
❌ DELETE /api/port/:port            - unexposePort()
```

**Streaming:**
```
❌ GET    /api/execute/stream        - execStream() [SSE]
```

**Session Management:**
```
❌ POST   /api/session/create        - createSession()
❌ POST   /api/session/:id/exec      - session.exec()
```

**Environment:**
```
❌ POST   /api/env/set               - setEnvVars()
```

---

## Implementation Priority

### Phase 1: Core Workflows ✅ COMPLETE (12/12 tests passing)
1. ✅ **Git Clone Workflow** - git-clone-workflow.test.ts (5/5 tests)
2. ✅ **Process Lifecycle & Port Exposure** - process-lifecycle-workflow.test.ts (7/7 tests)

**Completed**: Primary README examples and process/port management patterns.

**Bugs Fixed During Implementation:**
- **Bug #1**: `listProcesses()` returning empty (sessionId filtering removed - processes are sandbox-scoped)
- **Bug #2**: Port validation too restrictive (relaxed to only block port 3000)
- **Bug #3**: Missing `proxyToSandbox()` in test worker (preview URL routing)
- **Bug #4**: Missing `EXPOSE 8080` in Dockerfile (local dev requirement)
- **Bug #5**: Double-slash in URL concatenation (fixed with URL constructor)

### Phase 2: Advanced Features (In Progress - 8/8 tests passing)
3. ✅ **File Operations** - file-operations-workflow.test.ts (8/8 tests)
4. **Streaming Operations** - streaming-workflow.test.ts (not started)
5. **Session Isolation** - session-isolation-workflow.test.ts (not started)
6. **Environment Variables** - environment-workflow.test.ts (not started)

**File Operations Completed**: Full CRUD operations for file system with nested directories, renaming, moving, and strict file-only deletion.

**Bugs Fixed During Implementation:**
- **Bug #6**: mkdir missing recursive option in test-worker (added support for `recursive: true`)
- **Bug #7**: deleteFile incorrectly accepting directories (added IS_DIRECTORY validation to enforce file-only deletion)

**Design Decision**: deleteFile() now strictly validates that the target is a file, not a directory. Directory deletion must be done via `exec('rm -rf <path>')`. This prevents accidental deletion of entire directory trees and follows Unix conventions (similar to fs.unlink vs fs.rm).

**Remaining**: Streaming, session isolation, and environment variable testing.

### Phase 3: Robustness
7. **Error Scenarios** - error-scenarios-workflow.test.ts
8. **Edge Cases** - Additional tests in existing files

**Why**: Ensures SDK fails gracefully and provides good error messages.

### Future: Code Interpreter
- Requires separate planning due to complexity
- Python/JavaScript runtime testing
- Rich output format validation

---

## Success Criteria

**Coverage:**
- ✅ All 25+ SDK methods have integration tests
- ✅ All README examples are tested as workflows
- ✅ Both happy paths and error cases covered

**Quality:**
- ✅ Tests use realistic workflows (not just API calls)
- ✅ Tests validate actual behavior (process runs, ports work, files persist)
- ✅ Tests are maintainable (clear scenarios, good naming)

**Performance:**
- ✅ Full E2E suite runs in < 5 minutes
- ✅ Individual workflows timeout appropriately (30s-2m depending on complexity)

---

## Test Design Principles

1. **Test Workflows, Not APIs**: Each test should represent a real user journey
2. **Validate Behavior, Not Responses**: Check that processes actually run, ports actually work
3. **Use Realistic Examples**: Match README examples and production patterns
4. **Proper Cleanup**: Every test cleans up (kill processes, delete files)
5. **Meaningful Assertions**: Don't just check status=200, verify actual outcomes

---

## Notes

- E2E tests use **real wrangler dev** + **real Docker containers** = slow but accurate
- Unit tests (packages/sandbox/tests/) remain fast and comprehensive
- E2E tests complement unit tests by validating full system integration
- Each E2E test should run independently (unique sandbox IDs)
