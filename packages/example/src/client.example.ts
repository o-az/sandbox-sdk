import {
  createClient,
  executeCommand,
  quickExecute,
  WebSocketClient,
} from "./client";

// Example 1: Basic client usage
async function basicExample() {
  console.log("=== Basic Client Example ===");

  const client = createClient({
    onConnected: (sessionId) => {
      console.log(`Connected with session: ${sessionId}`);
    },
    onCommandStart: (command, args) => {
      console.log(`Starting command: ${command} ${args.join(" ")}`);
    },
    onOutput: (stream, data) => {
      console.log(`[${stream}] ${data}`);
    },
    onCommandComplete: (success, exitCode, stdout, stderr) => {
      console.log(
        `Command completed: success=${success}, exitCode=${exitCode}`
      );
      if (stderr) console.log(`Stderr: ${stderr}`);
    },
    onError: (error) => {
      console.error(`Error: ${error}`);
    },
  });

  try {
    await client.connect();

    // Execute some commands
    client.execute("ls", ["-la"]);
    client.ping();
    client.list();

    // Wait a bit for responses
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    console.error("Connection failed:", error);
  } finally {
    client.disconnect();
  }
}

// Example 2: Using the executeCommand helper
async function executeCommandExample() {
  console.log("\n=== Execute Command Helper Example ===");

  const client = createClient();
  await client.connect();

  try {
    const result = await executeCommand(client, "echo", ["Hello, World!"]);
    console.log("Command result:", result);

    const pwdResult = await executeCommand(client, "pwd");
    console.log("PWD result:", pwdResult);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    client.disconnect();
  }
}

// Example 3: Quick execute for one-off commands
async function quickExecuteExample() {
  console.log("\n=== Quick Execute Example ===");

  try {
    const result = await quickExecute("date");
    console.log("Date command result:", result);

    const lsResult = await quickExecute("ls", ["-la"]);
    console.log("LS command result:", lsResult);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Example 4: Interactive session
async function interactiveExample() {
  console.log("\n=== Interactive Session Example ===");

  const client = createClient({
    onConnected: (sessionId) => {
      console.log(`Interactive session started: ${sessionId}`);
    },
    onOutput: (stream, data) => {
      process.stdout.write(data);
    },
  });

  await client.connect();

  // Simulate interactive commands
  const commands: [string, string[]][] = [
    ["echo", ["Starting interactive session..."]],
    ["pwd", []],
    ["ls", ["-la"]],
    ["echo", ["Session complete!"]],
  ];

  for (const [command, args] of commands) {
    console.log(`\n>>> ${command} ${args.join(" ")}`);
    await executeCommand(client, command, args);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  client.disconnect();
}

// Run examples
async function runExamples() {
  console.log("🚀 WebSocket Client Examples\n");

  try {
    await basicExample();
    await executeCommandExample();
    await quickExecuteExample();
    await interactiveExample();

    console.log("\n✅ All examples completed!");
  } catch (error) {
    console.error("❌ Example failed:", error);
  }
}

// Export for use in other modules
export { WebSocketClient, createClient, executeCommand, quickExecute };

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}
