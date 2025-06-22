interface ExecuteRequest {
  command: string;
  args?: string[];
}

interface WebSocketMessage {
  type:
    | "execute"
    | "ping"
    | "list"
    | "connected"
    | "command_start"
    | "output"
    | "command_complete"
    | "error"
    | "pong";
  data?: any;
  error?: string;
  command?: string;
  args?: string[];
  timestamp?: string;
}

interface WebSocketClientOptions {
  url?: string;
  onConnected?: (sessionId: string) => void;
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
  onPong?: (timestamp: string) => void;
  onList?: (data: any) => void;
  onClose?: () => void;
  onOpen?: () => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  protected options: WebSocketClientOptions;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(options: WebSocketClientOptions = {}) {
    this.options = {
      url: "ws://localhost:3000",
      ...options,
    };
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

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url!);

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;
          this.options.onOpen?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          console.log("WebSocket disconnected");
          this.options.onClose?.();
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: string) {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      switch (message.type) {
        case "connected":
          console.log("Session established:", message.data?.sessionId);
          this.options.onConnected?.(message.data?.sessionId);
          break;

        case "command_start":
          console.log(
            "Command started:",
            message.data?.command,
            message.data?.args
          );
          this.options.onCommandStart?.(
            message.data?.command,
            message.data?.args || []
          );
          break;

        case "output":
          console.log(`[${message.data?.stream}] ${message.data?.data}`);
          this.options.onOutput?.(
            message.data?.stream,
            message.data?.data,
            message.data?.command
          );
          break;

        case "command_complete":
          console.log(
            "Command completed:",
            message.data?.success,
            "Exit code:",
            message.data?.exitCode
          );
          this.options.onCommandComplete?.(
            message.data?.success,
            message.data?.exitCode,
            message.data?.stdout,
            message.data?.stderr,
            message.data?.command,
            message.data?.args || []
          );
          break;

        case "error":
          console.error("Server error:", message.error);
          this.options.onError?.(message.error!, message.command, message.args);
          break;

        case "pong":
          console.log("Pong received:", message.timestamp);
          this.options.onPong?.(message.timestamp!);
          break;

        case "list":
          console.log("List response:", message.data);
          this.options.onList?.(message.data);
          break;

        default:
          console.warn("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );

      setTimeout(() => {
        this.connect().catch((error) => {
          console.error("Reconnection failed:", error);
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error("Max reconnection attempts reached");
    }
  }

  send(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error("WebSocket is not connected");
    }
  }

  execute(command: string, args: string[] = []): void {
    this.send({
      type: "execute",
      data: { command, args },
    });
  }

  ping(): void {
    this.send({ type: "ping" });
  }

  list(): void {
    this.send({ type: "list" });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Example usage and utility functions
export function createClient(
  options?: WebSocketClientOptions
): WebSocketClient {
  return new WebSocketClient(options);
}

export async function executeCommand(
  client: WebSocketClient,
  command: string,
  args: string[] = []
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let exitCode = -1;
    let success = false;

    // Store original handlers
    const originalOnOutput = client.getOnOutput();
    const originalOnComplete = client.getOnCommandComplete();

    // Set temporary handlers for this command
    client.setOnOutput((stream, data) => {
      if (stream === "stdout") {
        stdout += data;
      } else {
        stderr += data;
      }
      originalOnOutput?.(stream, data, command);
    });

    client.setOnCommandComplete(
      (cmdSuccess, code, cmdStdout, cmdStderr, cmd, cmdArgs) => {
        success = cmdSuccess;
        exitCode = code;
        stdout = cmdStdout;
        stderr = cmdStderr;

        originalOnComplete?.(
          cmdSuccess,
          code,
          cmdStdout,
          cmdStderr,
          cmd,
          cmdArgs
        );
        resolve({ success, stdout, stderr, exitCode });
      }
    );

    client.execute(command, args);
  });
}

// Convenience function for quick command execution
export async function quickExecute(
  command: string,
  args: string[] = [],
  options?: WebSocketClientOptions
): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const client = createClient(options);
  await client.connect();

  try {
    return await executeCommand(client, command, args);
  } finally {
    client.disconnect();
  }
}
