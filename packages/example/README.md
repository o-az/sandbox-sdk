# WebSocket Client for Bun Server

This package provides a TypeScript WebSocket client for interacting with the Bun server that executes shell commands via WebSocket connections.

## Features

- 🔌 **WebSocket Connection Management**: Automatic connection, reconnection, and cleanup
- 🚀 **Command Execution**: Execute shell commands remotely with real-time output
- 📡 **Event Handling**: Comprehensive event callbacks for all server responses
- 🔄 **Auto-reconnection**: Automatic reconnection with exponential backoff
- 🛡️ **Error Handling**: Robust error handling and validation
- ⚡ **Promise-based APIs**: Easy-to-use async/await interfaces

## Installation

```bash
npm install
```

## Usage

### Basic Example

```typescript
import { createClient } from "./src/client";

const client = createClient({
  onConnected: (sessionId) => {
    console.log(`Connected with session: ${sessionId}`);
  },
  onOutput: (stream, data) => {
    console.log(`[${stream}] ${data}`);
  },
  onCommandComplete: (success, exitCode, stdout, stderr) => {
    console.log(`Command completed: success=${success}, exitCode=${exitCode}`);
  },
});

await client.connect();
client.execute("ls", ["-la"]);
client.disconnect();
```

### Quick Command Execution

For one-off commands, use the `quickExecute` function:

```typescript
import { quickExecute } from "./src/client";

const result = await quickExecute("echo", ["Hello, World!"]);
console.log(result.stdout); // "Hello, World!"
console.log(result.success); // true
console.log(result.exitCode); // 0
```

### Advanced Usage

```typescript
import { WebSocketClient, executeCommand } from "./src/client";

const client = new WebSocketClient({
  url: "ws://localhost:3000",
  onConnected: (sessionId) => {
    console.log(`Session: ${sessionId}`);
  },
  onCommandStart: (command, args) => {
    console.log(`Starting: ${command} ${args.join(" ")}`);
  },
  onOutput: (stream, data, command) => {
    process.stdout.write(data);
  },
  onCommandComplete: (success, exitCode, stdout, stderr, command, args) => {
    console.log(`\nCommand '${command}' completed with exit code ${exitCode}`);
  },
  onError: (error, command, args) => {
    console.error(`Error executing '${command}': ${error}`);
  },
  onPong: (timestamp) => {
    console.log(`Server responded at: ${timestamp}`);
  },
  onList: (data) => {
    console.log("Available commands:", data.availableCommands);
  },
});

await client.connect();

// Execute commands
client.execute("pwd");
client.ping();
client.list();

// Use promise-based execution
const result = await executeCommand(client, "ls", ["-la"]);
console.log("Result:", result);

client.disconnect();
```

## API Reference

### WebSocketClient

#### Constructor

```typescript
new WebSocketClient(options?: WebSocketClientOptions)
```

#### Options

```typescript
interface WebSocketClientOptions {
  url?: string; // WebSocket URL (default: "ws://localhost:3000")
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
```

#### Methods

- `connect(): Promise<void>` - Connect to the WebSocket server
- `disconnect(): void` - Disconnect from the server
- `execute(command: string, args: string[] = []): void` - Execute a shell command
- `ping(): void` - Send a ping message
- `list(): void` - Request available commands
- `send(message: WebSocketMessage): void` - Send a custom message
- `isConnected(): boolean` - Check if connected
- `setOnOutput(handler): void` - Set output handler
- `setOnCommandComplete(handler): void` - Set command completion handler

### Utility Functions

#### createClient(options?)

Creates a new WebSocketClient instance with the given options.

#### quickExecute(command, args?, options?)

Executes a single command and returns a promise with the result. Automatically handles connection and disconnection.

```typescript
const result = await quickExecute("ls", ["-la"]);
// Returns: { success: boolean, stdout: string, stderr: string, exitCode: number }
```

#### executeCommand(client, command, args?)

Executes a command using an existing client instance and returns a promise with the result.

## Message Types

The client handles these message types from the server:

- `connected` - Connection established with session ID
- `command_start` - Command execution started
- `output` - Real-time command output (stdout/stderr)
- `command_complete` - Command execution completed
- `error` - Error occurred
- `pong` - Response to ping
- `list` - Available commands list

## Error Handling

The client includes comprehensive error handling:

- Connection failures with automatic retry
- Invalid JSON messages
- Dangerous command prevention (server-side)
- Process cleanup on disconnect
- Timeout handling

## Security

The server includes safety measures:

- Dangerous command filtering (rm, rmdir, del, format, shutdown, reboot)
- Process isolation per WebSocket session
- Automatic process cleanup on disconnect

## Examples

### Interactive Shell

```typescript
const client = createClient({
  onOutput: (stream, data) => {
    process.stdout.write(data);
  },
});

await client.connect();

// Interactive commands
await executeCommand(client, "pwd");
await executeCommand(client, "ls", ["-la"]);
await executeCommand(client, "echo", ["Hello from interactive shell"]);

client.disconnect();
```

### Batch Processing

```typescript
const commands = [
  ["echo", ["Starting batch..."]],
  ["pwd"],
  ["ls", ["-la"]],
  ["echo", ["Batch complete!"]],
];

const client = createClient();
await client.connect();

for (const [command, args] of commands) {
  const result = await executeCommand(client, command, args);
  console.log(`${command}: ${result.success ? "SUCCESS" : "FAILED"}`);
}

client.disconnect();
```

## Testing

Run the test suite:

```bash
npm test
# or
node test.js
```

## Server Requirements

This client requires a Bun server running with WebSocket support. The server should:

- Listen on port 3000 (or configure the client URL)
- Support WebSocket upgrade
- Handle the message types defined above
- Execute shell commands safely

## License

MIT
