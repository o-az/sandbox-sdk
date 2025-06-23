import {
  createClient,
  HttpClient,
  quickExecute,
  quickExecuteStream,
} from "../../sandbox/src/client";

async function testHttpClient() {
  console.log("🧪 Testing HTTP Client...\n");

  // Test 1: Basic connection and ping
  console.log("Test 1: Basic connection and ping");
  try {
    const client = createClient();
    const pingResult = await client.ping();
    console.log("✅ Ping result:", pingResult);

    const sessionId = await client.createSession();
    console.log("✅ Session created:", sessionId);
    console.log("✅ Connection test completed\n");
  } catch (error) {
    console.error("❌ Test 1 failed:", error);
  }

  // Test 2: Command execution
  console.log("Test 2: Command execution");
  try {
    const result = await quickExecute("echo", ["Hello from HTTP client!"]);
    console.log("✅ Command executed:", result.success);
    console.log("   Output:", result.stdout.trim());
    console.log("   Exit code:", result.exitCode, "\n");
  } catch (error) {
    console.error("❌ Test 2 failed:", error);
  }

  // Test 3: Multiple commands with session
  console.log("Test 3: Multiple commands with session");
  try {
    const client = createClient();
    const sessionId = await client.createSession();

    const commands: [string, string[]][] = [
      ["pwd", []],
      ["ls", ["-la"]],
      ["echo", ["Multiple commands test"]],
    ];

    for (const [command, args] of commands) {
      console.log(`Executing: ${command} ${args.join(" ")}`);
      const result = await client.execute(command, args, sessionId);
      console.log(`   Success: ${result.success}, Exit: ${result.exitCode}`);
    }

    client.clearSession();
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

  // Test 5: Session management
  console.log("Test 5: Session management");
  try {
    const client = createClient();

    // Create session
    const sessionId1 = await client.createSession();
    console.log("✅ Session 1 created:", sessionId1);

    // Create another session
    const sessionId2 = await client.createSession();
    console.log("✅ Session 2 created:", sessionId2);

    // List sessions
    const sessions = await client.listSessions();
    console.log("✅ Sessions listed:", sessions.count, "active sessions");

    // Execute command in specific session
    const result = await client.execute("whoami", [], sessionId1);
    console.log("✅ Command executed in session 1:", result.stdout.trim());

    client.clearSession();
    console.log("✅ Session management test completed\n");
  } catch (error) {
    console.error("❌ Test 5 failed:", error);
  }

  // Test 6: Available commands
  console.log("Test 6: Available commands");
  try {
    const client = createClient();
    const commands = await client.getCommands();
    console.log("✅ Available commands:", commands.length);
    console.log("   Commands:", commands.slice(0, 5).join(", "), "...\n");
  } catch (error) {
    console.error("❌ Test 6 failed:", error);
  }

  // Test 7: Streaming command execution
  console.log("Test 7: Streaming command execution");
  try {
    const client = createClient();
    await client.createSession();

    console.log("   Starting streaming command...");
    await client.executeStream("ls", ["-la"]);
    console.log("✅ Streaming command completed\n");

    client.clearSession();
  } catch (error) {
    console.error("❌ Test 7 failed:", error);
  }

  // Test 8: Quick streaming execution
  console.log("Test 8: Quick streaming execution");
  try {
    console.log("   Starting quick streaming command...");
    await quickExecuteStream("echo", ["Hello from quick streaming!"]);
    console.log("✅ Quick streaming command completed\n");
  } catch (error) {
    console.error("❌ Test 8 failed:", error);
  }

  console.log("🎉 All tests completed!");
}

// Run tests if this file is executed directly
if (import.meta.main) {
  // Add a timeout to prevent hanging
  const timeout = setTimeout(() => {
    console.error("❌ Tests timed out after 60 seconds");
    process.exit(1);
  }, 60000);

  testHttpClient()
    .then(() => {
      clearTimeout(timeout);
      console.log("✅ Tests finished successfully");
      process.exit(0);
    })
    .catch((error) => {
      clearTimeout(timeout);
      console.error("❌ Tests failed:", error);
      process.exit(1);
    });
}

export { testHttpClient };
