import type { DurableObject } from "cloudflare:workers";
import type { Sandbox } from "./index";

interface ExecuteRequest {
  command: string;
  args?: string[];
}

interface ExecuteResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  args: string[];
  timestamp: string;
}

interface SessionResponse {
  sessionId: string;
  message: string;
  timestamp: string;
}

interface SessionListResponse {
  sessions: Array<{
    sessionId: string;
    hasActiveProcess: boolean;
    createdAt: string;
  }>;
  count: number;
  timestamp: string;
}

interface CommandsResponse {
  availableCommands: string[];
  timestamp: string;
}

interface GitCheckoutRequest {
  repoUrl: string;
  branch?: string;
  targetDir?: string;
  sessionId?: string;
}

interface GitCheckoutResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  repoUrl: string;
  branch: string;
  targetDir: string;
  timestamp: string;
}

interface MkdirRequest {
  path: string;
  recursive?: boolean;
  sessionId?: string;
}

interface MkdirResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  path: string;
  recursive: boolean;
  timestamp: string;
}

interface PingResponse {
  message: string;
  timestamp: string;
}

interface StreamEvent {
  type: "command_start" | "output" | "command_complete" | "error";
  command?: string;
  args?: string[];
  stream?: "stdout" | "stderr";
  data?: string;
  success?: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  timestamp?: string;
}

interface HttpClientOptions {
  stub?: Sandbox;
  baseUrl?: string;
  port?: number;
  onCommandStart?: (command: string, args: string[]) => void;
  onOutput?: (
    stream: "stdout" | "stderr",
    data: string,
    command: string
  ) => void;
  onCommandComplete?: (
    success: boolean,
    exitCode: number,
    stdout: string,
    stderr: string,
    command: string,
    args: string[]
  ) => void;
  onError?: (error: string, command?: string, args?: string[]) => void;
  onStreamEvent?: (event: StreamEvent) => void;
}

export class HttpClient {
  private baseUrl: string;
  private options: HttpClientOptions;
  private sessionId: string | null = null;

  constructor(options: HttpClientOptions = {}) {
    this.options = {
      ...options,
    };
    this.baseUrl = this.options.baseUrl!;
  }

  private async doFetch(
    path: string,
    options?: RequestInit
  ): Promise<Response> {
    if (this.options.stub) {
      return this.options.stub.containerFetch(path, options, this.options.port);
    }
    return fetch(this.baseUrl + path, options);
  }
  // Public methods to set event handlers
  setOnOutput(
    handler: (
      stream: "stdout" | "stderr",
      data: string,
      command: string
    ) => void
  ): void {
    this.options.onOutput = handler;
  }

  setOnCommandComplete(
    handler: (
      success: boolean,
      exitCode: number,
      stdout: string,
      stderr: string,
      command: string,
      args: string[]
    ) => void
  ): void {
    this.options.onCommandComplete = handler;
  }

  setOnStreamEvent(handler: (event: StreamEvent) => void): void {
    this.options.onStreamEvent = handler;
  }

  // Public getter methods
  getOnOutput():
    | ((stream: "stdout" | "stderr", data: string, command: string) => void)
    | undefined {
    return this.options.onOutput;
  }

  getOnCommandComplete():
    | ((
        success: boolean,
        exitCode: number,
        stdout: string,
        stderr: string,
        command: string,
        args: string[]
      ) => void)
    | undefined {
    return this.options.onCommandComplete;
  }

  getOnStreamEvent(): ((event: StreamEvent) => void) | undefined {
    return this.options.onStreamEvent;
  }

  async createSession(): Promise<string> {
    try {
      const response = await this.doFetch(`/api/session/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: SessionResponse = await response.json();
      this.sessionId = data.sessionId;
      console.log(`[HTTP Client] Created session: ${this.sessionId}`);
      return this.sessionId;
    } catch (error) {
      console.error("[HTTP Client] Error creating session:", error);
      throw error;
    }
  }

  async listSessions(): Promise<SessionListResponse> {
    try {
      const response = await this.doFetch(`/api/session/list`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: SessionListResponse = await response.json();
      console.log(`[HTTP Client] Listed ${data.count} sessions`);
      return data;
    } catch (error) {
      console.error("[HTTP Client] Error listing sessions:", error);
      throw error;
    }
  }

  async execute(
    command: string,
    args: string[] = [],
    sessionId?: string
  ): Promise<ExecuteResponse> {
    try {
      const targetSessionId = sessionId || this.sessionId;

      const response = await this.doFetch(`/api/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command,
          args,
          sessionId: targetSessionId,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data: ExecuteResponse = await response.json();
      console.log(
        `[HTTP Client] Command executed: ${command}, Success: ${data.success}`
      );

      // Call the callback if provided
      this.options.onCommandComplete?.(
        data.success,
        data.exitCode,
        data.stdout,
        data.stderr,
        data.command,
        data.args
      );

      return data;
    } catch (error) {
      console.error("[HTTP Client] Error executing command:", error);
      this.options.onError?.(
        error instanceof Error ? error.message : "Unknown error",
        command,
        args
      );
      throw error;
    }
  }

  async executeStream(
    command: string,
    args: string[] = [],
    sessionId?: string
  ): Promise<void> {
    try {
      const targetSessionId = sessionId || this.sessionId;

      const response = await this.doFetch(`/api/execute/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command,
          args,
          sessionId: targetSessionId,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      if (!response.body) {
        throw new Error("No response body for streaming request");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = line.slice(6); // Remove 'data: ' prefix
                const event: StreamEvent = JSON.parse(eventData);

                console.log(`[HTTP Client] Stream event: ${event.type}`);
                this.options.onStreamEvent?.(event);

                switch (event.type) {
                  case "command_start":
                    console.log(
                      `[HTTP Client] Command started: ${
                        event.command
                      } ${event.args?.join(" ")}`
                    );
                    this.options.onCommandStart?.(
                      event.command!,
                      event.args || []
                    );
                    break;

                  case "output":
                    console.log(`[${event.stream}] ${event.data}`);
                    this.options.onOutput?.(
                      event.stream!,
                      event.data!,
                      event.command!
                    );
                    break;

                  case "command_complete":
                    console.log(
                      `[HTTP Client] Command completed: ${event.command}, Success: ${event.success}, Exit code: ${event.exitCode}`
                    );
                    this.options.onCommandComplete?.(
                      event.success!,
                      event.exitCode!,
                      event.stdout!,
                      event.stderr!,
                      event.command!,
                      event.args || []
                    );
                    break;

                  case "error":
                    console.error(
                      `[HTTP Client] Command error: ${event.error}`
                    );
                    this.options.onError?.(
                      event.error!,
                      event.command,
                      event.args
                    );
                    break;
                }
              } catch (parseError) {
                console.warn(
                  "[HTTP Client] Failed to parse stream event:",
                  parseError
                );
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error("[HTTP Client] Error in streaming execution:", error);
      this.options.onError?.(
        error instanceof Error ? error.message : "Unknown error",
        command,
        args
      );
      throw error;
    }
  }

  async gitCheckout(
    repoUrl: string,
    branch: string = "main",
    targetDir?: string,
    sessionId?: string
  ): Promise<GitCheckoutResponse> {
    try {
      const targetSessionId = sessionId || this.sessionId;

      const response = await this.doFetch(`/api/git/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repoUrl,
          branch,
          targetDir,
          sessionId: targetSessionId,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data: GitCheckoutResponse = await response.json();
      console.log(
        `[HTTP Client] Git checkout completed: ${repoUrl}, Success: ${data.success}, Target: ${data.targetDir}`
      );

      return data;
    } catch (error) {
      console.error("[HTTP Client] Error in git checkout:", error);
      throw error;
    }
  }

  async gitCheckoutStream(
    repoUrl: string,
    branch: string = "main",
    targetDir?: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const targetSessionId = sessionId || this.sessionId;

      const response = await this.doFetch(`/api/git/checkout/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repoUrl,
          branch,
          targetDir,
          sessionId: targetSessionId,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      if (!response.body) {
        throw new Error("No response body for streaming request");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = line.slice(6); // Remove 'data: ' prefix
                const event: StreamEvent = JSON.parse(eventData);

                console.log(
                  `[HTTP Client] Git checkout stream event: ${event.type}`
                );
                this.options.onStreamEvent?.(event);

                switch (event.type) {
                  case "command_start":
                    console.log(
                      `[HTTP Client] Git checkout started: ${
                        event.command
                      } ${event.args?.join(" ")}`
                    );
                    this.options.onCommandStart?.(
                      event.command!,
                      event.args || []
                    );
                    break;

                  case "output":
                    console.log(`[${event.stream}] ${event.data}`);
                    this.options.onOutput?.(
                      event.stream!,
                      event.data!,
                      event.command!
                    );
                    break;

                  case "command_complete":
                    console.log(
                      `[HTTP Client] Git checkout completed: ${event.command}, Success: ${event.success}, Exit code: ${event.exitCode}`
                    );
                    this.options.onCommandComplete?.(
                      event.success!,
                      event.exitCode!,
                      event.stdout!,
                      event.stderr!,
                      event.command!,
                      event.args || []
                    );
                    break;

                  case "error":
                    console.error(
                      `[HTTP Client] Git checkout error: ${event.error}`
                    );
                    this.options.onError?.(
                      event.error!,
                      event.command,
                      event.args
                    );
                    break;
                }
              } catch (parseError) {
                console.warn(
                  "[HTTP Client] Failed to parse git checkout stream event:",
                  parseError
                );
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error("[HTTP Client] Error in streaming git checkout:", error);
      this.options.onError?.(
        error instanceof Error ? error.message : "Unknown error",
        "git clone",
        [branch, repoUrl, targetDir || ""]
      );
      throw error;
    }
  }

  async mkdir(
    path: string,
    recursive: boolean = false,
    sessionId?: string
  ): Promise<MkdirResponse> {
    try {
      const targetSessionId = sessionId || this.sessionId;

      const response = await this.doFetch(`/api/mkdir`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path,
          recursive,
          sessionId: targetSessionId,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data: MkdirResponse = await response.json();
      console.log(
        `[HTTP Client] Directory created: ${path}, Success: ${data.success}, Recursive: ${data.recursive}`
      );

      return data;
    } catch (error) {
      console.error("[HTTP Client] Error creating directory:", error);
      throw error;
    }
  }

  async mkdirStream(
    path: string,
    recursive: boolean = false,
    sessionId?: string
  ): Promise<void> {
    try {
      const targetSessionId = sessionId || this.sessionId;

      const response = await this.doFetch(`/api/mkdir/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path,
          recursive,
          sessionId: targetSessionId,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      if (!response.body) {
        throw new Error("No response body for streaming request");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const eventData = line.slice(6); // Remove 'data: ' prefix
                const event: StreamEvent = JSON.parse(eventData);

                console.log(`[HTTP Client] Mkdir stream event: ${event.type}`);
                this.options.onStreamEvent?.(event);

                switch (event.type) {
                  case "command_start":
                    console.log(
                      `[HTTP Client] Mkdir started: ${
                        event.command
                      } ${event.args?.join(" ")}`
                    );
                    this.options.onCommandStart?.(
                      event.command!,
                      event.args || []
                    );
                    break;

                  case "output":
                    console.log(`[${event.stream}] ${event.data}`);
                    this.options.onOutput?.(
                      event.stream!,
                      event.data!,
                      event.command!
                    );
                    break;

                  case "command_complete":
                    console.log(
                      `[HTTP Client] Mkdir completed: ${event.command}, Success: ${event.success}, Exit code: ${event.exitCode}`
                    );
                    this.options.onCommandComplete?.(
                      event.success!,
                      event.exitCode!,
                      event.stdout!,
                      event.stderr!,
                      event.command!,
                      event.args || []
                    );
                    break;

                  case "error":
                    console.error(`[HTTP Client] Mkdir error: ${event.error}`);
                    this.options.onError?.(
                      event.error!,
                      event.command,
                      event.args
                    );
                    break;
                }
              } catch (parseError) {
                console.warn(
                  "[HTTP Client] Failed to parse mkdir stream event:",
                  parseError
                );
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error("[HTTP Client] Error in streaming mkdir:", error);
      this.options.onError?.(
        error instanceof Error ? error.message : "Unknown error",
        "mkdir",
        recursive ? ["-p", path] : [path]
      );
      throw error;
    }
  }

  async ping(): Promise<string> {
    try {
      const response = await this.doFetch(`/api/ping`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: PingResponse = await response.json();
      console.log(`[HTTP Client] Ping response: ${data.message}`);
      return data.timestamp;
    } catch (error) {
      console.error("[HTTP Client] Error pinging server:", error);
      throw error;
    }
  }

  async getCommands(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/commands`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: CommandsResponse = await response.json();
      console.log(
        `[HTTP Client] Available commands: ${data.availableCommands.length}`
      );
      return data.availableCommands;
    } catch (error) {
      console.error("[HTTP Client] Error getting commands:", error);
      throw error;
    }
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  clearSession(): void {
    this.sessionId = null;
  }
}

// Example usage and utility functions
export function createClient(options?: HttpClientOptions): HttpClient {
  return new HttpClient(options);
}

// Convenience function for quick command execution
export async function quickExecute(
  command: string,
  args: string[] = [],
  options?: HttpClientOptions
): Promise<ExecuteResponse> {
  const client = createClient(options);
  await client.createSession();

  try {
    return await client.execute(command, args);
  } finally {
    client.clearSession();
  }
}

// Convenience function for quick streaming command execution
export async function quickExecuteStream(
  command: string,
  args: string[] = [],
  options?: HttpClientOptions
): Promise<void> {
  const client = createClient(options);
  await client.createSession();

  try {
    await client.executeStream(command, args);
  } finally {
    client.clearSession();
  }
}

// Convenience function for quick git checkout
export async function quickGitCheckout(
  repoUrl: string,
  branch: string = "main",
  targetDir?: string,
  options?: HttpClientOptions
): Promise<GitCheckoutResponse> {
  const client = createClient(options);
  await client.createSession();

  try {
    return await client.gitCheckout(repoUrl, branch, targetDir);
  } finally {
    client.clearSession();
  }
}

// Convenience function for quick directory creation
export async function quickMkdir(
  path: string,
  recursive: boolean = false,
  options?: HttpClientOptions
): Promise<MkdirResponse> {
  const client = createClient(options);
  await client.createSession();

  try {
    return await client.mkdir(path, recursive);
  } finally {
    client.clearSession();
  }
}

// Convenience function for quick streaming git checkout
export async function quickGitCheckoutStream(
  repoUrl: string,
  branch: string = "main",
  targetDir?: string,
  options?: HttpClientOptions
): Promise<void> {
  const client = createClient(options);
  await client.createSession();

  try {
    await client.gitCheckoutStream(repoUrl, branch, targetDir);
  } finally {
    client.clearSession();
  }
}

// Convenience function for quick streaming directory creation
export async function quickMkdirStream(
  path: string,
  recursive: boolean = false,
  options?: HttpClientOptions
): Promise<void> {
  const client = createClient(options);
  await client.createSession();

  try {
    await client.mkdirStream(path, recursive);
  } finally {
    client.clearSession();
  }
}
