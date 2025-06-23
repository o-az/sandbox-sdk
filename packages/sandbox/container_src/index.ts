import { spawn } from "node:child_process";
import { serve } from "bun";

interface ExecuteRequest {
  command: string;
  args?: string[];
}

interface GitCheckoutRequest {
  repoUrl: string;
  branch?: string;
  targetDir?: string;
  sessionId?: string;
}

interface MkdirRequest {
  path: string;
  recursive?: boolean;
  sessionId?: string;
}

interface SessionData {
  sessionId: string;
  activeProcess: any | null;
  createdAt: Date;
}

// In-memory session storage (in production, you'd want to use a proper database)
const sessions = new Map<string, SessionData>();

// Generate a unique session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Clean up old sessions (older than 1 hour)
function cleanupOldSessions() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const [sessionId, session] of sessions.entries()) {
    if (session.createdAt < oneHourAgo && !session.activeProcess) {
      sessions.delete(sessionId);
      console.log(`[Server] Cleaned up old session: ${sessionId}`);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldSessions, 10 * 60 * 1000);

const server = serve({
  fetch(req: Request) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Handle CORS
    const corsHeaders = {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    };

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 200 });
    }

    try {
      // Handle different routes
      switch (pathname) {
        case "/":
          return new Response("Hello from Bun server! 🚀", {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...corsHeaders,
            },
          });

        case "/api/hello":
          return new Response(
            JSON.stringify({
              message: "Hello from API!",
              timestamp: new Date().toISOString(),
            }),
            {
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
            }
          );

        case "/api/users":
          if (req.method === "GET") {
            return new Response(
              JSON.stringify([
                { id: 1, name: "Alice" },
                { id: 2, name: "Bob" },
                { id: 3, name: "Charlie" },
              ]),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          } else if (req.method === "POST") {
            return new Response(
              JSON.stringify({
                message: "User created successfully",
                method: "POST",
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }
          break;

        case "/api/session/create":
          if (req.method === "POST") {
            const sessionId = generateSessionId();
            const sessionData: SessionData = {
              activeProcess: null,
              createdAt: new Date(),
              sessionId,
            };
            sessions.set(sessionId, sessionData);

            console.log(`[Server] Created new session: ${sessionId}`);

            return new Response(
              JSON.stringify({
                message: "Session created successfully",
                sessionId,
                timestamp: new Date().toISOString(),
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }
          break;

        case "/api/session/list":
          if (req.method === "GET") {
            const sessionList = Array.from(sessions.values()).map(
              (session) => ({
                createdAt: session.createdAt.toISOString(),
                hasActiveProcess: !!session.activeProcess,
                sessionId: session.sessionId,
              })
            );

            return new Response(
              JSON.stringify({
                count: sessionList.length,
                sessions: sessionList,
                timestamp: new Date().toISOString(),
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }
          break;

        case "/api/execute":
          if (req.method === "POST") {
            return handleExecuteRequest(req, corsHeaders);
          }
          break;

        case "/api/execute/stream":
          if (req.method === "POST") {
            return handleStreamingExecuteRequest(req, corsHeaders);
          }
          break;

        case "/api/ping":
          if (req.method === "GET") {
            return new Response(
              JSON.stringify({
                message: "pong",
                timestamp: new Date().toISOString(),
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }
          break;

        case "/api/commands":
          if (req.method === "GET") {
            return new Response(
              JSON.stringify({
                availableCommands: [
                  "ls",
                  "pwd",
                  "echo",
                  "cat",
                  "grep",
                  "find",
                  "whoami",
                  "date",
                  "uptime",
                  "ps",
                  "top",
                  "df",
                  "du",
                  "free",
                ],
                timestamp: new Date().toISOString(),
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            );
          }
          break;

        case "/api/git/checkout":
          if (req.method === "POST") {
            return handleGitCheckoutRequest(req, corsHeaders);
          }
          break;

        case "/api/git/checkout/stream":
          if (req.method === "POST") {
            return handleStreamingGitCheckoutRequest(req, corsHeaders);
          }
          break;

        case "/api/mkdir":
          if (req.method === "POST") {
            return handleMkdirRequest(req, corsHeaders);
          }
          break;

        case "/api/mkdir/stream":
          if (req.method === "POST") {
            return handleStreamingMkdirRequest(req, corsHeaders);
          }
          break;

        default:
          return new Response("Not Found", {
            headers: corsHeaders,
            status: 404,
          });
      }
    } catch (error) {
      console.error("[Server] Error handling request:", error);
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 500,
        }
      );
    }
  },
  port: 3000,
} as any);

async function handleExecuteRequest(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await req.json()) as ExecuteRequest & { sessionId?: string };
    const { command, args = [], sessionId } = body;

    if (!command || typeof command !== "string") {
      return new Response(
        JSON.stringify({
          error: "Command is required and must be a string",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Basic safety check - prevent dangerous commands
    const dangerousCommands = [
      "rm",
      "rmdir",
      "del",
      "format",
      "shutdown",
      "reboot",
    ];
    const lowerCommand = command.toLowerCase();

    if (
      dangerousCommands.some((dangerous) => lowerCommand.includes(dangerous))
    ) {
      return new Response(
        JSON.stringify({
          error: "Dangerous command not allowed",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    console.log(`[Server] Executing command: ${command} ${args.join(" ")}`);

    const result = await executeCommand(command, args, sessionId);

    return new Response(
      JSON.stringify({
        args,
        command,
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.success,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("[Server] Error in handleExecuteRequest:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to execute command",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

async function handleStreamingExecuteRequest(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await req.json()) as ExecuteRequest & { sessionId?: string };
    const { command, args = [], sessionId } = body;

    if (!command || typeof command !== "string") {
      return new Response(
        JSON.stringify({
          error: "Command is required and must be a string",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Basic safety check - prevent dangerous commands
    const dangerousCommands = [
      "rm",
      "rmdir",
      "del",
      "format",
      "shutdown",
      "reboot",
    ];
    const lowerCommand = command.toLowerCase();

    if (
      dangerousCommands.some((dangerous) => lowerCommand.includes(dangerous))
    ) {
      return new Response(
        JSON.stringify({
          error: "Dangerous command not allowed",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    console.log(
      `[Server] Executing streaming command: ${command} ${args.join(" ")}`
    );

    const stream = new ReadableStream({
      start(controller) {
        const child = spawn(command, args, {
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Store the process reference for cleanup if sessionId is provided
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.activeProcess = child;
        }

        let stdout = "";
        let stderr = "";

        // Send command start event
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              args,
              command,
              timestamp: new Date().toISOString(),
              type: "command_start",
            })}\n\n`
          )
        );

        child.stdout?.on("data", (data) => {
          const output = data.toString();
          stdout += output;

          // Send real-time output
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                command,
                data: output,
                stream: "stdout",
                type: "output",
              })}\n\n`
            )
          );
        });

        child.stderr?.on("data", (data) => {
          const output = data.toString();
          stderr += output;

          // Send real-time error output
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                command,
                data: output,
                stream: "stderr",
                type: "output",
              })}\n\n`
            )
          );
        });

        child.on("close", (code) => {
          // Clear the active process reference
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            session.activeProcess = null;
          }

          console.log(
            `[Server] Command completed: ${command}, Exit code: ${code}`
          );

          // Send command completion event
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                args,
                command,
                exitCode: code,
                stderr,
                stdout,
                success: code === 0,
                timestamp: new Date().toISOString(),
                type: "command_complete",
              })}\n\n`
            )
          );

          controller.close();
        });

        child.on("error", (error) => {
          // Clear the active process reference
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            session.activeProcess = null;
          }

          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                args,
                command,
                error: error.message,
                type: "error",
              })}\n\n`
            )
          );

          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("[Server] Error in handleStreamingExecuteRequest:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to execute streaming command",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

async function handleGitCheckoutRequest(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await req.json()) as GitCheckoutRequest;
    const { repoUrl, branch = "main", targetDir, sessionId } = body;

    if (!repoUrl || typeof repoUrl !== "string") {
      return new Response(
        JSON.stringify({
          error: "Repository URL is required and must be a string",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Validate repository URL format
    const urlPattern =
      /^(https?:\/\/|git@|ssh:\/\/).*\.git$|^https?:\/\/.*\/.*$/;
    if (!urlPattern.test(repoUrl)) {
      return new Response(
        JSON.stringify({
          error: "Invalid repository URL format",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Generate target directory if not provided
    const checkoutDir =
      targetDir ||
      `repo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(
      `[Server] Checking out repository: ${repoUrl} to ${checkoutDir}`
    );

    const result = await executeGitCheckout(
      repoUrl,
      branch,
      checkoutDir,
      sessionId
    );

    return new Response(
      JSON.stringify({
        branch,
        exitCode: result.exitCode,
        repoUrl,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.success,
        targetDir: checkoutDir,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("[Server] Error in handleGitCheckoutRequest:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to checkout repository",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

async function handleStreamingGitCheckoutRequest(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await req.json()) as GitCheckoutRequest;
    const { repoUrl, branch = "main", targetDir, sessionId } = body;

    if (!repoUrl || typeof repoUrl !== "string") {
      return new Response(
        JSON.stringify({
          error: "Repository URL is required and must be a string",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Validate repository URL format
    const urlPattern =
      /^(https?:\/\/|git@|ssh:\/\/).*\.git$|^https?:\/\/.*\/.*$/;
    if (!urlPattern.test(repoUrl)) {
      return new Response(
        JSON.stringify({
          error: "Invalid repository URL format",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Generate target directory if not provided
    const checkoutDir =
      targetDir ||
      `repo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(
      `[Server] Checking out repository: ${repoUrl} to ${checkoutDir}`
    );

    const stream = new ReadableStream({
      start(controller) {
        const child = spawn(
          "git",
          ["clone", "-b", branch, repoUrl, checkoutDir],
          {
            shell: true,
            stdio: ["pipe", "pipe", "pipe"],
          }
        );

        // Store the process reference for cleanup if sessionId is provided
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.activeProcess = child;
        }

        let stdout = "";
        let stderr = "";

        // Send command start event
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              args: [branch, repoUrl, checkoutDir],
              command: "git clone",
              timestamp: new Date().toISOString(),
              type: "command_start",
            })}\n\n`
          )
        );

        child.stdout?.on("data", (data) => {
          const output = data.toString();
          stdout += output;

          // Send real-time output
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                command: "git clone",
                data: output,
                stream: "stdout",
                type: "output",
              })}\n\n`
            )
          );
        });

        child.stderr?.on("data", (data) => {
          const output = data.toString();
          stderr += output;

          // Send real-time error output
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                command: "git clone",
                data: output,
                stream: "stderr",
                type: "output",
              })}\n\n`
            )
          );
        });

        child.on("close", (code) => {
          // Clear the active process reference
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            session.activeProcess = null;
          }

          console.log(
            `[Server] Command completed: git clone, Exit code: ${code}`
          );

          // Send command completion event
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                args: [branch, repoUrl, checkoutDir],
                command: "git clone",
                exitCode: code,
                stderr,
                stdout,
                success: code === 0,
                timestamp: new Date().toISOString(),
                type: "command_complete",
              })}\n\n`
            )
          );

          controller.close();
        });

        child.on("error", (error) => {
          // Clear the active process reference
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            session.activeProcess = null;
          }

          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                args: [branch, repoUrl, checkoutDir],
                command: "git clone",
                error: error.message,
                type: "error",
              })}\n\n`
            )
          );

          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error(
      "[Server] Error in handleStreamingGitCheckoutRequest:",
      error
    );
    return new Response(
      JSON.stringify({
        error: "Failed to checkout repository",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

async function handleMkdirRequest(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await req.json()) as MkdirRequest;
    const { path, recursive = false, sessionId } = body;

    if (!path || typeof path !== "string") {
      return new Response(
        JSON.stringify({
          error: "Path is required and must be a string",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Basic safety check - prevent dangerous paths
    const dangerousPatterns = [
      /^\/$/, // Root directory
      /^\/etc/, // System directories
      /^\/var/, // System directories
      /^\/usr/, // System directories
      /^\/bin/, // System directories
      /^\/sbin/, // System directories
      /^\/boot/, // System directories
      /^\/dev/, // System directories
      /^\/proc/, // System directories
      /^\/sys/, // System directories
      /^\/tmp\/\.\./, // Path traversal attempts
      /\.\./, // Path traversal attempts
    ];

    if (dangerousPatterns.some((pattern) => pattern.test(path))) {
      return new Response(
        JSON.stringify({
          error: "Dangerous path not allowed",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    console.log(
      `[Server] Creating directory: ${path} (recursive: ${recursive})`
    );

    const result = await executeMkdir(path, recursive, sessionId);

    return new Response(
      JSON.stringify({
        exitCode: result.exitCode,
        path,
        recursive,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.success,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    console.error("[Server] Error in handleMkdirRequest:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to create directory",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

async function handleStreamingMkdirRequest(
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await req.json()) as MkdirRequest;
    const { path, recursive = false, sessionId } = body;

    if (!path || typeof path !== "string") {
      return new Response(
        JSON.stringify({
          error: "Path is required and must be a string",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    // Basic safety check - prevent dangerous paths
    const dangerousPatterns = [
      /^\/$/, // Root directory
      /^\/etc/, // System directories
      /^\/var/, // System directories
      /^\/usr/, // System directories
      /^\/bin/, // System directories
      /^\/sbin/, // System directories
      /^\/boot/, // System directories
      /^\/dev/, // System directories
      /^\/proc/, // System directories
      /^\/sys/, // System directories
      /^\/tmp\/\.\./, // Path traversal attempts
      /\.\./, // Path traversal attempts
    ];

    if (dangerousPatterns.some((pattern) => pattern.test(path))) {
      return new Response(
        JSON.stringify({
          error: "Dangerous path not allowed",
        }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
          status: 400,
        }
      );
    }

    console.log(
      `[Server] Creating directory: ${path} (recursive: ${recursive})`
    );

    const stream = new ReadableStream({
      start(controller) {
        const args = recursive ? ["-p", path] : [path];
        const child = spawn("mkdir", args, {
          shell: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Store the process reference for cleanup if sessionId is provided
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.activeProcess = child;
        }

        let stdout = "";
        let stderr = "";

        // Send command start event
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({
              args,
              command: "mkdir",
              timestamp: new Date().toISOString(),
              type: "command_start",
            })}\n\n`
          )
        );

        child.stdout?.on("data", (data) => {
          const output = data.toString();
          stdout += output;

          // Send real-time output
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                command: "mkdir",
                data: output,
                stream: "stdout",
                type: "output",
              })}\n\n`
            )
          );
        });

        child.stderr?.on("data", (data) => {
          const output = data.toString();
          stderr += output;

          // Send real-time error output
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                command: "mkdir",
                data: output,
                stream: "stderr",
                type: "output",
              })}\n\n`
            )
          );
        });

        child.on("close", (code) => {
          // Clear the active process reference
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            session.activeProcess = null;
          }

          console.log(`[Server] Command completed: mkdir, Exit code: ${code}`);

          // Send command completion event
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                args,
                command: "mkdir",
                exitCode: code,
                stderr,
                stdout,
                success: code === 0,
                timestamp: new Date().toISOString(),
                type: "command_complete",
              })}\n\n`
            )
          );

          controller.close();
        });

        child.on("error", (error) => {
          // Clear the active process reference
          if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId)!;
            session.activeProcess = null;
          }

          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                args,
                command: "mkdir",
                error: error.message,
                type: "error",
              })}\n\n`
            )
          );

          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("[Server] Error in handleStreamingMkdirRequest:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to create directory",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
        status: 500,
      }
    );
  }
}

function executeCommand(
  command: string,
  args: string[],
  sessionId?: string
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Store the process reference for cleanup if sessionId is provided
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.activeProcess = child;
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // Clear the active process reference
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.activeProcess = null;
      }

      console.log(`[Server] Command completed: ${command}, Exit code: ${code}`);

      resolve({
        exitCode: code || 0,
        stderr,
        stdout,
        success: code === 0,
      });
    });

    child.on("error", (error) => {
      // Clear the active process reference
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.activeProcess = null;
      }

      reject(error);
    });
  });
}

function executeGitCheckout(
  repoUrl: string,
  branch: string,
  targetDir: string,
  sessionId?: string
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve, reject) => {
    // First, clone the repository
    const cloneChild = spawn(
      "git",
      ["clone", "-b", branch, repoUrl, targetDir],
      {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Store the process reference for cleanup if sessionId is provided
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.activeProcess = cloneChild;
    }

    let stdout = "";
    let stderr = "";

    cloneChild.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    cloneChild.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    cloneChild.on("close", (code) => {
      // Clear the active process reference
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.activeProcess = null;
      }

      if (code === 0) {
        console.log(
          `[Server] Repository cloned successfully: ${repoUrl} to ${targetDir}`
        );
        resolve({
          exitCode: code || 0,
          stderr,
          stdout,
          success: true,
        });
      } else {
        console.error(
          `[Server] Failed to clone repository: ${repoUrl}, Exit code: ${code}`
        );
        resolve({
          exitCode: code || 1,
          stderr,
          stdout,
          success: false,
        });
      }
    });

    cloneChild.on("error", (error) => {
      // Clear the active process reference
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.activeProcess = null;
      }

      console.error(`[Server] Error cloning repository: ${repoUrl}`, error);
      reject(error);
    });
  });
}

function executeMkdir(
  path: string,
  recursive: boolean,
  sessionId?: string
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve, reject) => {
    const args = recursive ? ["-p", path] : [path];
    const mkdirChild = spawn("mkdir", args, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Store the process reference for cleanup if sessionId is provided
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.activeProcess = mkdirChild;
    }

    let stdout = "";
    let stderr = "";

    mkdirChild.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    mkdirChild.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    mkdirChild.on("close", (code) => {
      // Clear the active process reference
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.activeProcess = null;
      }

      if (code === 0) {
        console.log(`[Server] Directory created successfully: ${path}`);
        resolve({
          exitCode: code || 0,
          stderr,
          stdout,
          success: true,
        });
      } else {
        console.error(
          `[Server] Failed to create directory: ${path}, Exit code: ${code}`
        );
        resolve({
          exitCode: code || 1,
          stderr,
          stdout,
          success: false,
        });
      }
    });

    mkdirChild.on("error", (error) => {
      // Clear the active process reference
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.activeProcess = null;
      }

      console.error(`[Server] Error creating directory: ${path}`, error);
      reject(error);
    });
  });
}

console.log(`🚀 Bun server running on http://localhost:${server.port}`);
console.log(`📡 HTTP API endpoints available:`);
console.log(`   POST /api/session/create - Create a new session`);
console.log(`   GET  /api/session/list - List all sessions`);
console.log(`   POST /api/execute - Execute a command (non-streaming)`);
console.log(`   POST /api/execute/stream - Execute a command (streaming)`);
console.log(`   POST /api/git/checkout - Checkout a git repository`);
console.log(
  `   POST /api/git/checkout/stream - Checkout a git repository (streaming)`
);
console.log(`   POST /api/mkdir - Create a directory`);
console.log(`   POST /api/mkdir/stream - Create a directory (streaming)`);
console.log(`   GET  /api/ping - Health check`);
console.log(`   GET  /api/commands - List available commands`);
