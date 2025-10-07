import type { Mock } from "bun:test";
import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { BunProcessAdapter, ExecutionResult } from '@sandbox-container/adapters/bun-process-adapter.ts';
import type { CloneOptions, Logger } from '@sandbox-container/core/types.ts';
import type { GitService, SecurityService } from '@sandbox-container/services/git-service.ts';

// Properly typed mock dependencies
const mockSecurityService: SecurityService = {
  validateGitUrl: vi.fn() as Mock<(url: string) => { isValid: boolean; errors: string[] }>,
  validatePath: vi.fn() as Mock<(path: string) => { isValid: boolean; errors: string[] }>,
  sanitizePath: vi.fn() as Mock<(path: string) => string>,
};

const mockLogger: Logger = {
  info: vi.fn() as Mock<(message: string, meta?: Record<string, unknown>) => void>,
  error: vi.fn() as Mock<(message: string, error?: Error, meta?: Record<string, unknown>) => void>,
  warn: vi.fn() as Mock<(message: string, meta?: Record<string, unknown>) => void>,
  debug: vi.fn() as Mock<(message: string, meta?: Record<string, unknown>) => void>,
};

// Properly typed mock BunProcessAdapter
const mockAdapter: BunProcessAdapter = {
  execute: vi.fn() as Mock<(command: string, args: string[], cwd?: string) => Promise<ExecutionResult>>,
  spawn: vi.fn() as Mock<(command: string, args: string[], cwd?: string) => any>,
} as BunProcessAdapter;

describe('GitService', () => {
  let GitServiceClass: typeof GitService;
  let gitService: GitService;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Set up default successful security validations
    (mockSecurityService.validateGitUrl as Mock).mockReturnValue({
      isValid: true,
      errors: []
    });
    (mockSecurityService.validatePath as Mock).mockReturnValue({
      isValid: true,
      errors: []
    });

    // Import the GitService (dynamic import)
    const module = await import('@sandbox-container/services/git-service.ts');
    GitServiceClass = module.GitService;
    gitService = new GitServiceClass(mockSecurityService, mockLogger, mockAdapter);
  });

  describe('cloneRepository', () => {
    it('should clone repository successfully with default options', async () => {
      // Mock successful git clone
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 0,
        stdout: 'Cloning into target-dir...',
        stderr: '',
      });

      const result = await gitService.cloneRepository('https://github.com/user/repo.git');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toMatch(/^\/tmp\/git-clone-repo-\d+-[a-z0-9]+$/);
        expect(result.data.branch).toBe('main');
      }

      // Verify security validations were called
      expect(mockSecurityService.validateGitUrl).toHaveBeenCalledWith('https://github.com/user/repo.git');
      expect(mockSecurityService.validatePath).toHaveBeenCalledWith(
        expect.stringMatching(/^\/tmp\/git-clone-repo-\d+-[a-z0-9]+$/)
      );

      // Verify git clone command was executed
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'git',
        ['clone', 'https://github.com/user/repo.git', expect.stringMatching(/^\/tmp\/git-clone-repo-\d+-[a-z0-9]+$/)]
      );
    });

    it('should clone repository with custom branch and target directory', async () => {
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 0,
        stdout: 'Cloning...',
        stderr: '',
      });

      const options: CloneOptions = {
        branch: 'develop',
        targetDir: '/tmp/custom-target'
      };

      const result = await gitService.cloneRepository('https://github.com/user/repo.git', options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe('/tmp/custom-target');
        expect(result.data.branch).toBe('develop');
      }

      // Verify git clone command includes branch option
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'git',
        ['clone', '--branch', 'develop', 'https://github.com/user/repo.git', '/tmp/custom-target']
      );
    });

    it('should return error when git URL validation fails', async () => {
      (mockSecurityService.validateGitUrl as Mock).mockReturnValue({
        isValid: false,
        errors: ['Invalid URL scheme', 'URL not in allowlist']
      });

      const result = await gitService.cloneRepository('ftp://malicious.com/repo.git');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_GIT_URL');
        expect(result.error.message).toContain('Invalid URL scheme');
        expect(result.error.details?.errors).toEqual([
          'Invalid URL scheme',
          'URL not in allowlist'
        ]);
      }

      // Should not attempt git clone
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return error when target directory validation fails', async () => {
      (mockSecurityService.validatePath as Mock).mockReturnValue({
        isValid: false,
        errors: ['Path outside sandbox', 'Path contains invalid characters']
      });

      const result = await gitService.cloneRepository(
        'https://github.com/user/repo.git',
        { targetDir: '/malicious/../path' }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_TARGET_PATH');
        expect(result.error.details?.errors).toContain('Path outside sandbox');
      }

      // Should not attempt git clone
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return error when git clone command fails', async () => {
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: repository not found',
      });

      const result = await gitService.cloneRepository('https://github.com/user/nonexistent.git');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('REPO_NOT_FOUND');
        expect(result.error.details?.exitCode).toBe(128);
        expect(result.error.details?.stderr).toContain('repository not found');
      }
    });

    it('should handle spawn errors gracefully', async () => {
      const spawnError = new Error('Command not found');
      (mockAdapter.execute as Mock).mockRejectedValue(spawnError);

      const result = await gitService.cloneRepository('https://github.com/user/repo.git');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('GIT_CLONE_ERROR');
        expect(result.error.details?.originalError).toBe('Command not found');
      }
    });
  });

  describe('checkoutBranch', () => {
    it('should checkout branch successfully', async () => {
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 0,
        stdout: 'Switched to branch develop',
        stderr: '',
      });

      const result = await gitService.checkoutBranch('/tmp/repo', 'develop');

      expect(result.success).toBe(true);

      // Verify git checkout command was executed with correct cwd
      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'git',
        ['checkout', 'develop'],
        { cwd: '/tmp/repo' }
      );
    });

    it('should return error when branch name is empty', async () => {
      const result = await gitService.checkoutBranch('/tmp/repo', '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_BRANCH_NAME');
        expect(result.error.message).toBe('Branch name cannot be empty');
      }

      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return error when git checkout fails', async () => {
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: "error: pathspec 'nonexistent' did not match",
      });

      const result = await gitService.checkoutBranch('/tmp/repo', 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('GIT_INVALID_REF');
        expect(result.error.details?.stderr).toContain('did not match');
      }
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch successfully', async () => {
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 0,
        stdout: 'main\n',
        stderr: '',
      });

      const result = await gitService.getCurrentBranch('/tmp/repo');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('main');
      }

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'git',
        ['branch', '--show-current'],
        { cwd: '/tmp/repo' }
      );
    });
  });

  describe('listBranches', () => {
    it('should list branches successfully and parse output correctly', async () => {
      const branchOutput = `  develop
* main
  feature/auth
  remotes/origin/HEAD -> origin/main
  remotes/origin/develop
  remotes/origin/main
  remotes/origin/feature/auth`;

      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 0,
        stdout: branchOutput,
        stderr: '',
      });

      const result = await gitService.listBranches('/tmp/repo');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([
          'develop',
          'main',
          'feature/auth',
          'HEAD -> origin/main'
        ]);

        // Should not include duplicates or HEAD references
        expect(result.data).not.toContain('HEAD');
        expect(result.data.filter(b => b === 'main')).toHaveLength(1);
      }

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'git',
        ['branch', '-a'],
        { cwd: '/tmp/repo' }
      );
    });

    it('should return error when git branch command fails', async () => {
      (mockAdapter.execute as Mock).mockResolvedValue({
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a git repository',
      });

      const result = await gitService.listBranches('/tmp/not-a-repo');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_A_GIT_REPO');
        expect(result.error.details?.exitCode).toBe(128);
      }
    });
  });
});
