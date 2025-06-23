# WebSocket Command Execution Server

A Bun-based WebSocket server that can execute arbitrary commands sent via WebSocket messages.

## Features

- 🔌 WebSocket-based command execution
- 🛡️ Basic safety checks against dangerous commands
- 📡 Real-time command output streaming
- 🎯 Session management with unique session IDs
- 🧹 Automatic process cleanup on disconnect
- 🏓 Ping/pong heartbeat support

## Quick Start

### 1. Start the Server

```bash
bun run index.ts
```

The server will start on `http://localhost:8080` with WebSocket support.

### 2. Run the Tests

In a separate terminal:

```bash
bun run test.ts
```

## WebSocket API

### Connection

Connect to `ws://localhost:8080`

### Message Types

#### Execute Command

```json
{
  "type": "execute",
  "data": {
    "command": "ls",
    "args": ["-la"]
  }
}
```

#### Ping

```json
{
  "type": "ping"
}
```

#### List Commands

```json
{
  "type": "list"
}
```

### Response Types

- `connected` - Session established
- `command_start` - Command execution started
- `output` - Real-time command output (stdout/stderr)
- `command_complete` - Command finished
- `pong` - Response to ping
- `list` - Available commands
- `error` - Error messages

## Test Coverage

The test suite covers:

✅ Basic command execution (echo, ls, pwd)  
✅ System information commands (uname)  
✅ Dangerous command protection (rm, shutdown)  
✅ Invalid command handling  
✅ Long-running commands (sleep)  
✅ WebSocket ping/pong  
✅ Session management

## Security Warning

⚠️ **This is for testing/development only!**

For production use, add:

- Authentication/authorization
- Command whitelisting
- Input validation
- Rate limiting
- Audit logging

## Example Output

```
🚀 Starting WebSocket command execution tests...

✅ Connected to WebSocket server
🎉 WebSocket session established. Send commands via 'execute' messages. [12:00:00 PM]
📋 Session ID: session_1704067200000_abc123

📋 Requesting available commands...
📋 Available commands: ls, pwd, echo, cat, grep, find [12:00:00 PM]

🏓 Sending ping...
🏓 Pong received [12:00:00 PM]

🔧 Executing: echo Hello from WebSocket!
🚀 Starting command: echo Hello from WebSocket! [12:00:01 PM]
📤 STDOUT: Hello from WebSocket!
✅ Command completed with exit code: 0 [12:00:01 PM]

✅ All tests completed!
🔌 Test completed, disconnecting...
```
