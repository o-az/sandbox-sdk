---
"@cloudflare/sandbox": patch
"@repo/sandbox-container": patch
---

Fix indefinite hangs in file and git operations by adding comprehensive timeout support

**Root Cause (Issue #166):**
File operations like `listFiles()` could hang indefinitely when underlying shell commands (e.g., `find`, `git clone`) took too long or never completed. This was caused by missing timeout parameters in `executeInSession` calls throughout the codebase.

**Changes:**

1. **Added per-command timeout support:**
   - Extended `Session.ExecOptions` to support `timeoutMs` parameter
   - Updated `SessionManager.executeInSession()` to accept options object: `{ cwd?, timeoutMs? }`
   - Per-command timeouts now override session-level defaults properly

2. **Added timeouts to all file operations (13 operations in file-service.ts):**
   - Quick operations (5s): `stat`, `exists`, `mkdir`, `delete`
   - Medium operations (10s): `rename`
   - I/O-heavy operations (30s): `read`, `write`, `move`, `listFiles`, `readFileStream`
   - Documented timeout strategy in FileService class documentation

3. **Added timeouts to all git operations (4 operations in git-service.ts):**
   - Clone operations (5min): `cloneRepository` - large repos can take significant time
   - Checkout operations (30s): `checkoutBranch` - can be slow with large repos
   - Quick operations (10s): `getCurrentBranch`, `listBranches`

4. **Added timeout to process operations:**
   - `ProcessService.executeCommand()` now properly passes timeout through

**Impact:**
- Fixes issue #166 where `listFiles()` with options would hang indefinitely
- Prevents similar hangs in all file, git, and process operations
- Improves reliability for operations on large directories, slow filesystems, network mounts, or during high I/O load
- Timeout strategy is documented and tiered based on operation complexity