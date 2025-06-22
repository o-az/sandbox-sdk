import { spawn } from "node:child_process";
import { serve } from "bun";

interface ExecuteRequest {
  command: string;
  args?: string[];
}

interface WebSocketMessage {
  type: "execute" | "ping" | "list";
  data?: ExecuteRequest;
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

        switch (parsedMessage.type) {
          case "execute":
            if (parsedMessage.data) {
              handleCommandExecution(ws, parsedMessage.data);
            } else {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "No command data provided",
                })
              );
            }
            break;

          case "ping":
            ws.send(
              JSON.stringify({
                type: "pong",
                timestamp: new Date().toISOString(),
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
              })
            );
            break;

          default:
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Unknown message type",
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
      console.log("WebSocket closed");
      // Clean up any running processes for this session
      const wsData = ws.data;
      if (wsData.activeProcess) {
        wsData.activeProcess.kill();
      }
    },

    // drain(ws: Bun.ServerWebSocket<WebSocketData>) {
    //   console.log("WebSocket drained");
    // },

    open(ws: Bun.ServerWebSocket<WebSocketData>) {
      console.log("WebSocket opened");
      // Generate a session ID for this connection
      const wsData: WebSocketData = {
        sessionId: `session_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`,
        activeProcess: null,
      };
      ws.data = wsData;

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
  request: ExecuteRequest
): void {
  const { command, args = [] } = request;

  if (!command || typeof command !== "string") {
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Command is required and must be a string",
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
      })
    );
  });

  child.on("close", (code) => {
    // Clear the active process reference
    wsData.activeProcess = null;

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
      })
    );
  });
}

console.log(`🚀 Bun server running on http://localhost:${server.port}`);
console.log(`📡 WebSocket endpoint available at ws://localhost:${server.port}`);
