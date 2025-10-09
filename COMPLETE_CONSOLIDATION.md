# Complete Execution Consolidation Plan

## Goal
Consolidate ALL command execution in the codebase to use SessionManager for a unified, session-aware execution model.

## Why This Matters
**User Experience**: Users can `cd` into a directory, then all subsequent operations (commands, git, files) execute in that context. No need to specify `cwd` on every call.

**Architecture**: Single execution path = simpler code, easier testing, consistent behavior.

## Execution Surfaces Found

### ✅ Already Consolidated
1. **ProcessService** - Uses SessionManager (Phases 1-7 complete)
2. **Session class** - Foundation layer with Bun.spawn + FIFO
3. **InterpreterService** - Separate system (code interpreter with process pool)
4. **SecurityServiceAdapter** - No execution (validation only)

### 🔄 Needs Consolidation
5. **GitService** - Currently uses BunProcessAdapter
6. **FileService** - Currently uses BunFileAdapter which uses BunProcessAdapter

### 🗑️ To Delete
7. **BunProcessAdapter** - After git/file consolidation
8. **BunFileAdapter** - After file consolidation
9. **Test helper methods** - InMemoryProcessStore.clear()/size()

---

## Implementation Plan

### Phase 8: Remove Test-Only Helper Methods ⏳
**File**: `/packages/sandbox-container/src/services/process-service.ts` (lines 82-90)

**Remove**:
```typescript
// Helper methods for testing
clear(): void {
  this.processes.clear();
}

size(): number {
  return this.processes.size;
}
```

**Reason**: Violates "no test-only code paths" principle.

**Tests should use**:
- `list()` then `delete()` for each process
- `list().length` for count

---

### Phase 9: Consolidate GitService ⏳

**Current Architecture**:
```typescript
class GitService {
  private adapter: BunProcessAdapter;

  async cloneRepository(repoUrl, options) {
    const args = this.manager.buildCloneArgs(...);
    const result = await this.adapter.execute(args[0], args.slice(1));
    // ...
  }
}
```

**Target Architecture**:
```typescript
class GitService {
  private sessionManager: SessionManager;

  constructor(security, logger, sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  async cloneRepository(repoUrl, options: CloneOptions) {
    const sessionId = options.sessionId || 'default';
    const command = `git clone ${options.branch ? `--branch ${options.branch}` : ''} ${repoUrl} ${targetDir}`;

    const result = await this.sessionManager.executeInSession(
      sessionId,
      command,
      options.cwd
    );
    // ...
  }
}
```

**Changes Needed**:
1. Replace `BunProcessAdapter` with `SessionManager` in constructor
2. Update all methods:
   - `cloneRepository()` - line 67, 97
   - `checkoutBranch()` - line 174
   - `getCurrentBranch()` - line 239
   - `listBranches()` - line 292
3. Change from `adapter.execute(command, args)` to `sessionManager.executeInSession(sessionId, command, cwd)`
4. Use `options.sessionId || 'default'` for session selection
5. Build full command strings instead of args arrays

**Benefits**:
- Git operations inherit session's current directory
- Git operations can use session's environment variables
- User can `cd /workspace/repo` then do `git status` naturally

**Note**: CloneOptions already has `sessionId?: string` field (types.ts:316)!

---

### Phase 10: Consolidate FileService ⏳

**Current Architecture**:
```typescript
class FileService {
  private adapter: BunFileAdapter;

  async delete(path) {
    const result = await this.adapter.deleteFile(path);
    // ...
  }
}

class BunFileAdapter {
  private processAdapter: BunProcessAdapter;

  async deleteFile(path) {
    return await this.processAdapter.execute('rm', [path]);
  }

  async exists(path) {
    const result = await this.processAdapter.execute('test', ['-e', path]);
    return result.exitCode === 0;
  }
}
```

**Target Architecture**:
```typescript
class FileService {
  private sessionManager: SessionManager;

  constructor(security, logger, sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  async delete(path, sessionId = 'default') {
    const result = await this.sessionManager.executeInSession(
      sessionId,
      `rm "${path}"`,  // Properly escape paths
      undefined  // Use session's current directory
    );
    // ...
  }

  async exists(path, sessionId = 'default') {
    const result = await this.sessionManager.executeInSession(
      sessionId,
      `test -e "${path}"`,
      undefined
    );
    return result.data.exitCode === 0;
  }

  async read(path, sessionId = 'default') {
    // Use Bun.file() directly - no session needed for direct API
    const file = Bun.file(path);
    const content = await file.text();
    return { content, size: content.length };
  }
}
```

**Changes Needed**:
1. Replace `BunFileAdapter` with `SessionManager` in constructor
2. Add `sessionId?: string` to all method options (ReadOptions, WriteOptions, etc.)
3. Shell commands → SessionManager:
   - `exists()` - `test -e` command
   - `deleteFile()` - `rm` command
   - `renameFile()` - `mv` command
   - `createDirectory()` - `mkdir` command
   - `getStats()` - `stat` command
4. Keep direct Bun APIs in FileService:
   - `Bun.file()` for reading
   - `Bun.write()` for writing
5. Proper path escaping for shell commands

**Request Type Updates**:
Add `sessionId` to validation schemas (validation/schemas.ts):
```typescript
export const readFileRequestSchema = z.object({
  path: z.string(),
  encoding: z.string().optional(),
  sessionId: z.string().optional(),
});

export const writeFileRequestSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.string().optional(),
  mode: z.string().optional(),
  sessionId: z.string().optional(),
});

// Same for: DeleteFileRequest, RenameFileRequest, MoveFileRequest, MkdirRequest
```

**Benefits**:
- File operations use session's current directory
- User can `cd /workspace/project` then `readFile('config.json')`
- No need to specify absolute paths every time

---

### Phase 11: Delete BunProcessAdapter ⏳

**Files to Delete**:
- `/packages/sandbox-container/src/adapters/bun-process-adapter.ts`
- `/packages/sandbox-container/tests/adapters/bun-process-adapter.test.ts`

**Verify Zero Usage**:
```bash
grep -r "BunProcessAdapter" packages/sandbox-container/src --exclude-dir=adapters
```

Should return 0 results after Phases 9-10.

---

### Phase 12: Delete BunFileAdapter ⏳

**Files to Delete**:
- `/packages/sandbox-container/src/adapters/bun-file-adapter.ts`
- `/packages/sandbox-container/tests/adapters/bun-file-adapter.test.ts`

**Verify Zero Usage**:
```bash
grep -r "BunFileAdapter" packages/sandbox-container/src --exclude-dir=adapters
```

Should return 0 results after Phase 10.

---

### Phase 13: Update All Tests ⏳

**Tests to Update**:
1. `/tests/services/process-service.test.ts` - Already identified
2. `/tests/services/git-service.test.ts` - Replace mock adapter with mock SessionManager
3. `/tests/services/file-service.test.ts` - Replace mock adapter with mock SessionManager

**Mock SessionManager Pattern**:
```typescript
const mockSessionManager = {
  executeInSession: vi.fn(),
  executeStreamInSession: vi.fn(),
  killCommand: vi.fn(),
  setEnvVars: vi.fn(),
  getSession: vi.fn(),
  createSession: vi.fn(),
} as Partial<SessionManager>;
```

---

### Phase 14: Verification ⏳

**Run all tests**:
```bash
npm run typecheck              # TypeScript compilation
npm run test:unit              # Container unit tests
npm run test:container         # Container integration tests
npm run test:e2e               # E2E tests (streaming operations)
```

**Verify**:
- All 9/9 streaming operation tests pass
- All unit tests pass with mocked SessionManager
- No `bash -c` workarounds needed in tests
- Shell features work naturally (pipes, redirects, loops, variables)
- Session state persists (cd, export) across operations

**Test session-aware operations**:
```typescript
// ProcessService
await executor.exec('cd /workspace/project');
await executor.exec('echo $PWD');  // Should show /workspace/project

// GitService
await git.cloneRepository('...', { sessionId: 'mysession' });
await executor.exec('cd /workspace/repo', { sessionId: 'mysession' });
await git.getCurrentBranch('/workspace/repo', { sessionId: 'mysession' });

// FileService
await executor.exec('cd /workspace/project', { sessionId: 'mysession' });
await file.read('config.json', { sessionId: 'mysession' });  // Reads from /workspace/project/config.json
```

---

## Architecture After Consolidation

### Execution Flow
```
Client SDK
    ↓
Durable Object
    ↓
Container Handlers
    ↓
Services (Process/Git/File)
    ↓
SessionManager ←← ALL execution goes through here
    ↓
Session (FIFO + Bun.spawn)
    ↓
Bash subprocess
```

### Key Principles
1. **Single execution path** - SessionManager only
2. **Session-aware** - All operations can use session context (cd, export)
3. **No divergent paths** - Zero legacy code
4. **No test-only code** - Production paths only
5. **Consistent patterns** - Same approach everywhere

### File Count Reduction
**Before**:
- BunProcessAdapter + tests (2 files)
- BunFileAdapter + tests (2 files)
- Test helper methods in ProcessService

**After**:
- Deleted all (5 items removed)
- ~400 lines of code eliminated
- Single execution model

---

## Risks & Mitigations

### Risk 1: File Path Escaping
**Issue**: Shell commands need proper path escaping
**Mitigation**: Use FileManager helper for escaping, test with spaces/special chars

### Risk 2: Breaking API Changes
**Issue**: Adding `sessionId` to file operation requests
**Mitigation**: Make it optional, default to 'default' session

### Risk 3: Performance
**Issue**: Every file op goes through bash session
**Mitigation**: Session reuse is fast, FIFO overhead minimal, but keep Bun.file() for reads

### Risk 4: Test Complexity
**Issue**: Mocking SessionManager more complex than adapter
**Mitigation**: Create shared test utilities for SessionManager mocks

---

## Success Criteria

✅ Zero usage of BunProcessAdapter
✅ Zero usage of BunFileAdapter
✅ Zero test-only code paths
✅ All tests passing with SessionManager
✅ Session state persists across all operation types
✅ No `bash -c` workarounds needed
✅ Unified execution model documented
✅ Reduced codebase complexity

---

## Timeline

- Phase 8: Remove test helpers (15 min)
- Phase 9: GitService consolidation (1 hour)
- Phase 10: FileService consolidation (1.5 hours)
- Phase 11-12: Delete adapters (15 min)
- Phase 13: Update tests (2 hours)
- Phase 14: Verification (1 hour)

**Total**: ~6 hours of focused work

---

## Related Documents

- `EXEC_CONSOLIDATION.md` - Original ProcessService consolidation plan
- `EXEC_TRACE_ANALYSIS.md` - Method traces for ProcessService
- `EXEC_KILLING_ANALYSIS.md` - Command killing solution design
- `CONSOLIDATION_SUMMARY.md` - High-level overview

This document supersedes the original consolidation plan with the complete scope across all services.
