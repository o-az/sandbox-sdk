# HTTP Command Execution Server & Client

This project provides an HTTP-based command execution server and client. The server runs on Bun and supports both regular and streaming command execution, along with git operations and file system management.

## Features

- **Session management** - Track and manage command execution sessions
- **Regular command execution** - Execute commands and get results
- **Streaming command execution** - Real-time output streaming using Server-Sent Events
- **Git operations** - Checkout repositories with branch support
- **File system operations** - Create directories with recursive support
- **CORS support** - Cross-origin requests enabled
- **Safety checks** - Prevents dangerous commands and paths
- **Process cleanup** - Automatic cleanup of running processes

## Server Endpoints

### Health Check

- `GET /api/ping` - Health check endpoint

### Session Management

- `POST /api/session/create` - Create a new session
- `GET /api/session/list` - List all active sessions

### Command Execution

- `POST /api/execute` - Execute a command (non-streaming)
- `POST /api/execute/stream` - Execute a command (streaming)

### Git Operations

- `POST /api/git/checkout` - Checkout a git repository

### File System Operations

- `POST /api/mkdir` - Create a directory

### Utilities

- `GET /api/commands` - Get list of available commands

## Usage

### Starting the Server

```bash
cd container_src
bun run index.ts
```

The server will start on `http://localhost:3000`.

### Using the Client

```typescript
import { HttpClient, quickExecute, quickExecuteStream } from "./src/client";

// Create a client instance
const client = new HttpClient({
  baseUrl: "http://localhost:3000",
  onCommandStart: (command, args) => {
    console.log(`Command started: ${command} ${args.join(" ")}`);
  },
  onOutput: (stream, data, command) => {
    console.log(`[${stream}] ${data}`);
  },
  onCommandComplete: (success, exitCode, stdout, stderr, command, args) => {
    console.log(`Command completed: ${command}, Success: ${success}`);
  },
  onError: (error, command, args) => {
    console.error(`Command error: ${error}`);
  },
});

// Create a session
const sessionId = await client.createSession();

// Execute a command
const result = await client.execute("echo", ["Hello World"]);
console.log(result.stdout);

// Execute a command with streaming
await client.executeStream("ls", ["-la"]);

// Create a directory
const mkdirResult = await client.mkdir("my-project", true);
console.log(`Directory created: ${mkdirResult.success}`);

// Checkout a git repository
const gitResult = await client.gitCheckout(
  "https://github.com/username/project.git",
  "main",
  "my-project"
);
console.log(`Repository cloned to: ${gitResult.targetDir}`);
```

### Quick Execute Utilities

```typescript
// Quick execute without session management
const result = await quickExecute("whoami");

// Quick streaming execute
await quickExecuteStream("ls", ["-la"]);

// Quick directory creation
const mkdirResult = await quickMkdir("temp-folder", true);

// Quick git checkout
const gitResult = await quickGitCheckout(
  "https://github.com/username/repo.git",
  "develop",
  "my-repo"
);
```

### Convenience Functions

The client provides several convenience functions for quick operations without session management:

- `quickExecute(command, args?, options?)` - Quick command execution
- `quickExecuteStream(command, args?, options?)` - Quick streaming execution
- `quickGitCheckout(repoUrl, branch?, targetDir?, options?)` - Quick git repository checkout
- `quickMkdir(path, recursive?, options?)` - Quick directory creation

These functions automatically create a session, perform the operation, and clean up the session afterward.

## API Reference

### HttpClient

#### Constructor

```typescript
new HttpClient(options?: HttpClientOptions)
```

#### Methods

- `createSession(): Promise<string>` - Create a new session
- `listSessions(): Promise<SessionListResponse>` - List all sessions
- `execute(command: string, args?: string[], sessionId?: string): Promise<ExecuteResponse>` - Execute a command
- `executeStream(command: string, args?: string[], sessionId?: string): Promise<void>` - Execute a command with streaming
- `gitCheckout(repoUrl: string, branch?: string, targetDir?: string, sessionId?: string): Promise<GitCheckoutResponse>` - Checkout a git repository
- `mkdir(path: string, recursive?: boolean, sessionId?: string): Promise<MkdirResponse>` - Create a directory
- `ping(): Promise<string>` - Health check
- `getCommands(): Promise<string[]>` - Get available commands
- `getSessionId(): string | null` - Get current session ID
- `setSessionId(sessionId: string): void` - Set session ID
- `clearSession(): void` - Clear current session

### Request/Response Types

#### Execute Request

```typescript
{
  command: string;
  args?: string[];
  sessionId?: string;
}
```

#### Execute Response

```typescript
{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  args: string[];
  timestamp: string;
}
```

#### Stream Event

```typescript
{
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
```

#### Git Checkout Request

```typescript
{
  repoUrl: string;
  branch?: string;
  targetDir?: string;
  sessionId?: string;
}
```

#### Git Checkout Response

```typescript
{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  repoUrl: string;
  branch: string;
  targetDir: string;
  timestamp: string;
}
```

#### Mkdir Request

```typescript
{
  path: string;
  recursive?: boolean;
  sessionId?: string;
}
```

#### Mkdir Response

```typescript
{
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  path: string;
  recursive: boolean;
  timestamp: string;
}
```

## Testing

Run the test file to verify the implementation:

```bash
bun run simple-test.ts
```

## Security

The server includes basic safety checks to prevent dangerous commands and paths:

### Dangerous Commands

- `rm`, `rmdir`, `del`, `format`, `shutdown`, `reboot`

### Dangerous Paths (for mkdir operations)

- Root directory (`/`)
- System directories (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`, `/boot`, `/dev`, `/proc`, `/sys`)
- Path traversal attempts (`..`)

In production, you should implement more comprehensive security measures.

## Session Management

Sessions are stored in memory and automatically cleaned up after 1 hour of inactivity. Each session can track active processes for proper cleanup.

## CORS

The server includes CORS headers to allow cross-origin requests. In production, you should configure these headers appropriately for your domain.
