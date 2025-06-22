import {
  WebSocketClient,
  createClient,
  executeCommand,
  quickExecute,
} from "./src/client";

async function testWebSocketClient() {
  console.log("🧪 Testing WebSocket Client...\n");

  // Test 1: Basic connection and ping
  console.log("Test 1: Basic connection and ping");
  try {
    const client = createClient();
    await client.connect();
    console.log("✅ Connected successfully");

    client.ping();
    console.log("✅ Ping sent");

    // Wait for pong response
    await new Promise((resolve) => setTimeout(resolve, 1000));
    client.disconnect();
    console.log("✅ Disconnected\n");
  } catch (error) {
    console.error("❌ Test 1 failed:", error);
  }

  // Test 2: Command execution
  console.log("Test 2: Command execution");
  try {
    const result = await quickExecute("echo", ["Hello from WebSocket client!"]);
    console.log("✅ Command executed:", result.success);
    console.log("   Output:", result.stdout.trim());
    console.log("   Exit code:", result.exitCode, "\n");
  } catch (error) {
    console.error("❌ Test 2 failed:", error);
  }

  // Test 3: Multiple commands
  console.log("Test 3: Multiple commands");
  try {
    const client = createClient();
    await client.connect();

    const commands: [string, string[]][] = [
      ["pwd", []],
      ["ls", ["-la"]],
      ["echo", ["Multiple commands test"]],
    ];

    for (const [command, args] of commands) {
      console.log(`Executing: ${command} ${args.join(" ")}`);
      const result = await executeCommand(client, command, args);
      console.log(`   Success: ${result.success}, Exit: ${result.exitCode}`);
    }

    client.disconnect();
    console.log("✅ Multiple commands test completed\n");
  } catch (error) {
    console.error("❌ Test 3 failed:", error);
  }

  // Test 4: Error handling
  console.log("Test 4: Error handling");
  try {
    const result = await quickExecute("nonexistentcommand");
    console.log("✅ Error handled gracefully");
    console.log("   Success:", result.success);
    console.log("   Exit code:", result.exitCode);
    console.log("   Error output:", result.stderr.trim(), "\n");
  } catch (error) {
    console.error("❌ Test 4 failed:", error);
  }

  console.log("🎉 All tests completed!");
}

// Run tests if this file is executed directly
if (require.main === module) {
  testWebSocketClient().catch(console.error);
}

export { testWebSocketClient };
