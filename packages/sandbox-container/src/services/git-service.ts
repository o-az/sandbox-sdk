// Git Operations Service
import type { CloneOptions, Logger, ServiceResult } from '../core/types';
import { GitManager } from '../managers/git-manager';
import { BunProcessAdapter } from '../adapters/bun-process-adapter';

export interface SecurityService {
  validateGitUrl(url: string): { isValid: boolean; errors: string[] };
  validatePath(path: string): { isValid: boolean; errors: string[] };
  sanitizePath(path: string): string;
}

export class GitService {
  private manager: GitManager;
  private adapter: BunProcessAdapter;

  constructor(
    private security: SecurityService,
    private logger: Logger,
    adapter?: BunProcessAdapter  // Injectable for testing
  ) {
    this.manager = new GitManager();
    this.adapter = adapter || new BunProcessAdapter();
  }

  async cloneRepository(repoUrl: string, options: CloneOptions = {}): Promise<ServiceResult<{ path: string; branch: string }>> {
    try {
      // Validate repository URL
      const urlValidation = this.security.validateGitUrl(repoUrl);
      if (!urlValidation.isValid) {
        return {
          success: false,
          error: {
            message: `Git URL validation failed: ${urlValidation.errors.join(', ')}`,
            code: 'INVALID_GIT_URL',
            details: { repoUrl, errors: urlValidation.errors },
          },
        };
      }

      // Generate target directory if not provided
      const targetDirectory = options.targetDir || this.manager.generateTargetDirectory(repoUrl);

      // Validate target directory path
      const pathValidation = this.security.validatePath(targetDirectory);
      if (!pathValidation.isValid) {
        return {
          success: false,
          error: {
            message: `Target directory validation failed: ${pathValidation.errors.join(', ')}`,
            code: 'INVALID_TARGET_PATH',
            details: { targetDirectory, errors: pathValidation.errors },
          },
        };
      }

      this.logger.info('Cloning repository', {
        repoUrl,
        targetDirectory,
        branch: options.branch
      });

      // Build git clone command (via manager)
      const args = this.manager.buildCloneArgs(repoUrl, targetDirectory, options);

      // Execute git clone (via adapter)
      const result = await this.adapter.execute(args[0], args.slice(1));

      if (result.exitCode !== 0) {
        this.logger.error('Git clone failed', undefined, {
          repoUrl,
          targetDirectory,
          exitCode: result.exitCode,
          stderr: result.stderr
        });

        return {
          success: false,
          error: {
            message: 'Git clone operation failed',
            code: this.manager.determineErrorCode('clone', result.stderr || 'Unknown error', result.exitCode),
            details: {
              repoUrl,
              targetDirectory,
              exitCode: result.exitCode,
              stderr: result.stderr,
              stdout: result.stdout
            },
          },
        };
      }

      const branchUsed = this.manager.getDefaultBranch(options);
      
      this.logger.info('Repository cloned successfully', {
        repoUrl,
        targetDirectory,
        branch: branchUsed
      });

      return {
        success: true,
        data: {
          path: targetDirectory,
          branch: branchUsed
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to clone repository', error instanceof Error ? error : undefined, { repoUrl, options });

      return {
        success: false,
        error: {
          message: 'Failed to clone repository',
          code: 'GIT_CLONE_ERROR',
          details: { repoUrl, options, originalError: errorMessage },
        },
      };
    }
  }

  async checkoutBranch(repoPath: string, branch: string): Promise<ServiceResult<void>> {
    try {
      // Validate repository path
      const pathValidation = this.security.validatePath(repoPath);
      if (!pathValidation.isValid) {
        return {
          success: false,
          error: {
            message: `Repository path validation failed: ${pathValidation.errors.join(', ')}`,
            code: 'INVALID_REPO_PATH',
            details: { repoPath, errors: pathValidation.errors },
          },
        };
      }

      // Validate branch name (via manager)
      const branchValidation = this.manager.validateBranchName(branch);
      if (!branchValidation.isValid) {
        return {
          success: false,
          error: {
            message: branchValidation.error || 'Invalid branch name',
            code: 'INVALID_BRANCH_NAME',
            details: { branch },
          },
        };
      }

      this.logger.info('Checking out branch', { repoPath, branch });

      // Build git checkout command (via manager)
      const args = this.manager.buildCheckoutArgs(branch);

      // Execute git checkout (via adapter)
      const result = await this.adapter.execute(args[0], args.slice(1), { cwd: repoPath });

      if (result.exitCode !== 0) {
        this.logger.error('Git checkout failed', undefined, {
          repoPath,
          branch,
          exitCode: result.exitCode,
          stderr: result.stderr
        });

        return {
          success: false,
          error: {
            message: 'Git checkout operation failed',
            code: this.manager.determineErrorCode('checkout', result.stderr || 'Unknown error', result.exitCode),
            details: {
              repoPath,
              branch,
              exitCode: result.exitCode,
              stderr: result.stderr,
              stdout: result.stdout
            },
          },
        };
      }

      this.logger.info('Branch checked out successfully', { repoPath, branch });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to checkout branch', error instanceof Error ? error : undefined, { repoPath, branch });

      return {
        success: false,
        error: {
          message: 'Failed to checkout branch',
          code: 'GIT_CHECKOUT_ERROR',
          details: { repoPath, branch, originalError: errorMessage },
        },
      };
    }
  }

  async getCurrentBranch(repoPath: string): Promise<ServiceResult<string>> {
    try {
      // Validate repository path
      const pathValidation = this.security.validatePath(repoPath);
      if (!pathValidation.isValid) {
        return {
          success: false,
          error: {
            message: `Repository path validation failed: ${pathValidation.errors.join(', ')}`,
            code: 'INVALID_REPO_PATH',
            details: { repoPath, errors: pathValidation.errors },
          },
        };
      }

      // Build git branch --show-current command (via manager)
      const args = this.manager.buildGetCurrentBranchArgs();

      // Execute command (via adapter)
      const result = await this.adapter.execute(args[0], args.slice(1), { cwd: repoPath });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: 'Failed to get current branch',
            code: this.manager.determineErrorCode('getCurrentBranch', result.stderr || 'Unknown error', result.exitCode),
            details: { repoPath, exitCode: result.exitCode },
          },
        };
      }

      const currentBranch = result.stdout.trim();

      return {
        success: true,
        data: currentBranch,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get current branch', error instanceof Error ? error : undefined, { repoPath });

      return {
        success: false,
        error: {
          message: 'Failed to get current branch',
          code: 'GIT_BRANCH_GET_ERROR',
          details: { repoPath, originalError: errorMessage },
        },
      };
    }
  }

  async listBranches(repoPath: string): Promise<ServiceResult<string[]>> {
    try {
      // Validate repository path
      const pathValidation = this.security.validatePath(repoPath);
      if (!pathValidation.isValid) {
        return {
          success: false,
          error: {
            message: `Repository path validation failed: ${pathValidation.errors.join(', ')}`,
            code: 'INVALID_REPO_PATH',
            details: { repoPath, errors: pathValidation.errors },
          },
        };
      }

      // Build git branch -a command (via manager)
      const args = this.manager.buildListBranchesArgs();

      // Execute command (via adapter)
      const result = await this.adapter.execute(args[0], args.slice(1), { cwd: repoPath });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: 'Failed to list branches',
            code: this.manager.determineErrorCode('listBranches', result.stderr || 'Unknown error', result.exitCode),
            details: { repoPath, exitCode: result.exitCode },
          },
        };
      }

      // Parse branch output (via manager)
      const branches = this.manager.parseBranchList(result.stdout);

      return {
        success: true,
        data: branches,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to list branches', error instanceof Error ? error : undefined, { repoPath });

      return {
        success: false,
        error: {
          message: 'Failed to list branches',
          code: 'GIT_BRANCH_LIST_ERROR',
          details: { repoPath, originalError: errorMessage },
        },
      };
    }
  }

}