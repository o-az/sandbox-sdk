interface WebSocketMessage {
  type: string;
  data?: any;
  error?: string;
  timestamp?: string;
}

interface ExecuteRequest {
  command: string;
  args?: string[];
}

class WebSocketCommandTester {
  private ws: WebSocket | null = null;
  private messageQueue: Array<{ type: string; data?: any }> = [];
  private isConnected = false;

  constructor(private url: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("✅ Connected to WebSocket server");
        this.isConnected = true;
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error("❌ Failed to parse message:", error);
        }
      };

      this.ws.onerror = (error: Event) => {
        console.error("❌ WebSocket error:", error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log("🔌 WebSocket connection closed");
        this.isConnected = false;
      };
    });
  }

  private handleMessage(message: WebSocketMessage): void {
    const timestamp = message.timestamp
      ? ` [${new Date(message.timestamp).toLocaleTimeString()}]`
      : "";

    switch (message.type) {
      case "connected": {
        console.log(`🎉 ${message.data?.message}${timestamp}`);
        console.log(`📋 Session ID: ${message.data?.sessionId}`);
        break;
      }

      case "command_start": {
        console.log(
          `🚀 Starting command: ${message.data?.command} ${
            message.data?.args?.join(" ") || ""
          }${timestamp}`
        );
        break;
      }

      case "output": {
        const stream =
          message.data?.stream === "stderr" ? "❌ STDERR" : "📤 STDOUT";
        const output = message.data?.data;
        if (output) {
          console.log(`${stream}: ${output.trim()}`);
        }
        break;
      }

      case "command_complete": {
        const success = message.data?.success ? "✅" : "❌";
        console.log(
          `${success} Command completed with exit code: ${message.data?.exitCode}${timestamp}`
        );
        if (message.data?.stderr) {
          console.log(`❌ Final stderr: ${message.data.stderr.trim()}`);
        }
        break;
      }

      case "pong": {
        console.log(`🏓 Pong received${timestamp}`);
        break;
      }

      case "list": {
        console.log(
          `📋 Available commands: ${message.data?.availableCommands?.join(
            ", "
          )}${timestamp}`
        );
        break;
      }

      case "error": {
        console.error(`❌ Error: ${message.error}${timestamp}`);
        break;
      }

      default: {
        console.log(`❓ Unknown message type: ${message.type}`, message);
      }
    }
  }

  private sendMessage(type: string, data?: any): void {
    if (!this.isConnected || !this.ws) {
      throw new Error("WebSocket not connected");
    }

    const message = { type, data };
    this.ws.send(JSON.stringify(message));
  }

  async executeCommand(command: string, args: string[] = []): Promise<void> {
    console.log(`\n🔧 Executing: ${command} ${args.join(" ")}`);
    this.sendMessage("execute", { command, args });

    // Wait a bit for the command to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  async ping(): Promise<void> {
    console.log("\n🏓 Sending ping...");
    this.sendMessage("ping");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async listCommands(): Promise<void> {
    console.log("\n📋 Requesting available commands...");
    this.sendMessage("list");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async testDangerousCommand(): Promise<void> {
    console.log("\n⚠️  Testing dangerous command protection...");
    this.sendMessage("execute", { command: "rm", args: ["-rf", "/"] });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  async testInvalidCommand(): Promise<void> {
    console.log("\n❓ Testing invalid command...");
    this.sendMessage("execute", { command: "nonexistentcommand12345" });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  async testLongRunningCommand(): Promise<void> {
    console.log("\n⏱️  Testing long-running command...");
    this.sendMessage("execute", { command: "sleep", args: ["3"] });
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function runTests(): Promise<void> {
  const tester = new WebSocketCommandTester("ws://127.0.0.1:3000");

  try {
    console.log("🚀 Starting WebSocket command execution tests...\n");

    // Connect to the server
    await tester.connect();

    // Wait a moment for connection to stabilize
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Test 1: List available commands
    await tester.listCommands();

    // Test 2: Ping the server
    await tester.ping();

    // Test 3: Simple echo command
    await tester.executeCommand("echo", ["Hello from WebSocket!"]);

    // Test 4: List current directory
    await tester.executeCommand("ls", ["-la"]);

    // Test 5: Get current working directory
    await tester.executeCommand("pwd");

    // Test 6: Check system info
    await tester.executeCommand("uname", ["-a"]);

    // Test 7: Test dangerous command protection
    await tester.testDangerousCommand();

    // Test 8: Test invalid command
    await tester.testInvalidCommand();

    // Test 9: Test long-running command
    await tester.testLongRunningCommand();

    console.log("\n✅ All tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Clean up
    setTimeout(() => {
      tester.disconnect();
      console.log("\n🔌 Test completed, disconnecting...");
      process.exit(0);
    }, 1000);
  }
}

// Run the tests
runTests().catch(console.error);
