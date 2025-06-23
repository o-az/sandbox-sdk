import { spawn } from "node:child_process";
import { serve } from "bun";

interface ExecuteRequest {
  command: string;
  args?: string[];
}

interface WebSocketMessage {
  type: "execute" | "ping" | "list";
  data?: ExecuteRequest;
  _requestId?: string;
}

interface WebSocketData {
  sessionId: string;
  activeProcess: any | null;
}

const server = serve({
  port: 3000,
  fetch(req: Request) {
    // upgrade the request to a WebSocket
    if (server.upgrade(req)) {
      return; // do not return a Response
    }
    const url = new URL(req.url);

    // Handle different routes
    switch (url.pathname) {
      case "/":
        return new Response("Hello from Bun server! 🚀", {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });

      case "/api/hello":
        return new Response(
          JSON.stringify({
            message: "Hello from API!",
            timestamp: new Date().toISOString(),
          }),
          {
            headers: { "Content-Type": "application/json" },
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
              headers: { "Content-Type": "application/json" },
            }
          );
        } else if (req.method === "POST") {
          return new Response(
            JSON.stringify({
              message: "User created successfully",
              method: "POST",
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }
        break;

      default:
        return new Response("Not Found", { status: 404 });
    }
  },
  websocket: {
    message(ws: Bun.ServerWebSocket<WebSocketData>, message) {
      try {
        const parsedMessage = JSON.parse(
          message.toString()
        ) as WebSocketMessage;

        console.log(
          `[Server] Received message:`,
          parsedMessage.type,
          parsedMessage._requestId
        );

        switch (parsedMessage.type) {
          case "execute":
            if (parsedMessage.data) {
              handleCommandExecution(
                ws,
                parsedMessage.data,
                parsedMessage._requestId
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "No command data provided",
                  _requestId: parsedMessage._requestId,
                })
              );
            }
            break;

          case "ping":
            ws.send(
              JSON.stringify({
                type: "pong",
                timestamp: new Date().toISOString(),
                _requestId: parsedMessage._requestId,
              })
            );
            break;

          case "list":
            // Send available commands or current session info
            ws.send(
              JSON.stringify({
                type: "list",
                data: {
                  availableCommands: [
                    "ls",
                    "pwd",
                    "echo",
                    "cat",
                    "grep",
                    "find",
                  ],
                  sessionId: (ws.data as WebSocketData).sessionId || "unknown",
                  timestamp: new Date().toISOString(),
                },
                _requestId: parsedMessage._requestId,
              })
            );
            break;

          default:
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Unknown message type",
                _requestId: parsedMessage._requestId,
              })
            );
        }
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: "Invalid JSON message",
          })
        );
      }
    },

    close(ws: Bun.ServerWebSocket<WebSocketData>) {
      console.log("[Server] WebSocket closed for session:", ws.data?.sessionId);
      // Clean up any running processes for this session
      const wsData = ws.data;
      if (wsData.activeProcess) {
        console.log(
          "[Server] Killing active process for session:",
          wsData.sessionId
        );
        wsData.activeProcess.kill();
      }
    },

    // drain(ws: Bun.ServerWebSocket<WebSocketData>) {
    //   console.log("WebSocket drained");
    // },

    open(ws: Bun.ServerWebSocket<WebSocketData>) {
      console.log("[Server] WebSocket opened");
      // Generate a session ID for this connection
      const wsData: WebSocketData = {
        sessionId: `session_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
        activeProcess: null,
      };
      ws.data = wsData;

      console.log("[Server] Created session:", wsData.sessionId);

      // Send welcome message
      ws.send(
        JSON.stringify({
          type: "connected",
          data: {
            sessionId: wsData.sessionId,
            message:
              "WebSocket session established. Send commands via 'execute' messages.",
            timestamp: new Date().toISOString(),
          },
        })
      );
    },
  },
});

function handleCommandExecution(
  ws: Bun.ServerWebSocket<WebSocketData>,
  request: ExecuteRequest,
  _requestId?: string
): void {
  const { command, args = [] } = request;

  console.log(
    `[Server] Executing command:`,
    command,
    args,
    `RequestId:`,
    _requestId
  );

  if (!command || typeof command !== "string") {
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Command is required and must be a string",
        _requestId,
      })
    );
    return;
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

  if (dangerousCommands.some((dangerous) => lowerCommand.includes(dangerous))) {
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Dangerous command not allowed",
        _requestId,
      })
    );
    return;
  }

  // Send command start notification
  ws.send(
    JSON.stringify({
      type: "command_start",
      data: {
        command: command,
        args: args,
        timestamp: new Date().toISOString(),
      },
      _requestId,
    })
  );

  const child = spawn(command, args, {
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Store the process reference for cleanup
  const wsData = ws.data as WebSocketData;
  wsData.activeProcess = child;

  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (data) => {
    const output = data.toString();
    stdout += output;

    // Send real-time output
    ws.send(
      JSON.stringify({
        type: "output",
        data: {
          stream: "stdout",
          data: output,
          command: command,
        },
        _requestId,
      })
    );
  });

  child.stderr?.on("data", (data) => {
    const output = data.toString();
    stderr += output;

    // Send real-time error output
    ws.send(
      JSON.stringify({
        type: "output",
        data: {
          stream: "stderr",
          data: output,
          command: command,
        },
        _requestId,
      })
    );
  });

  child.on("close", (code) => {
    // Clear the active process reference
    wsData.activeProcess = null;

    console.log(
      `[Server] Command completed:`,
      command,
      `Exit code:`,
      code,
      `RequestId:`,
      _requestId
    );

    ws.send(
      JSON.stringify({
        type: "command_complete",
        data: {
          success: code === 0,
          exitCode: code,
          stdout: stdout,
          stderr: stderr,
          command: command,
          args: args,
          timestamp: new Date().toISOString(),
        },
        _requestId,
      })
    );
  });

  child.on("error", (error) => {
    // Clear the active process reference
    wsData.activeProcess = null;

    ws.send(
      JSON.stringify({
        type: "error",
        error: error.message,
        command: command,
        args: args,
        _requestId,
      })
    );
  });
}

console.log(`🚀 Bun server running on http://localhost:${server.port}`);
console.log(`📡 WebSocket endpoint available at ws://localhost:${server.port}`);
