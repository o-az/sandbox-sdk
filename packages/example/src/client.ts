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
  // This is a client-side only field to help with async requests
  _requestId?: string;
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
  private _requestCounter = 0;
  private _requestResolvers = new Map<
    string,
    (message: WebSocketMessage) => void
  >();

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
          if (
            message._requestId &&
            this._requestResolvers.has(message._requestId)
          ) {
            this._requestResolvers.get(message._requestId)!(message);
            this._requestResolvers.delete(message._requestId);
            return;
          }
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
          if (
            message._requestId &&
            this._requestResolvers.has(message._requestId)
          ) {
            this._requestResolvers.get(message._requestId)!(message);
            this._requestResolvers.delete(message._requestId);
            return;
          }
          this.options.onPong?.(message.timestamp!);
          break;

        case "list":
          console.log("List response:", message.data);
          if (
            message._requestId &&
            this._requestResolvers.has(message._requestId)
          ) {
            this._requestResolvers.get(message._requestId)!(message);
            this._requestResolvers.delete(message._requestId);
            return;
          }
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

  private _makeRequest<T>(
    message: Omit<WebSocketMessage, "_requestId">,
    responseType: WebSocketMessage["type"]
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = `req-${this._requestCounter++}`;
      const requestMessage = { ...message, _requestId: requestId };

      this._requestResolvers.set(requestId, (response) => {
        if (response.type === responseType) {
          resolve(response.data as T);
        } else if (response.type === "error") {
          reject(new Error(response.error));
        }
      });

      this.send(requestMessage);
    });
  }

  send(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error("WebSocket is not connected");
    }
  }

  async execute(
    command: string,
    args: string[] = []
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return this._makeRequest(
      {
        type: "execute",
        data: { command, args },
      },
      "command_complete"
    );
  }

  async ping(): Promise<string> {
    const response = await this._makeRequest<{ timestamp: string }>(
      { type: "ping" },
      "pong"
    );
    return response.timestamp;
  }

  async list(): Promise<any> {
    return this._makeRequest({ type: "list" }, "list");
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
    return await client.execute(command, args);
  } finally {
    client.disconnect();
  }
}
