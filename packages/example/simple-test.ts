import { WebSocketClient } from "./src/client";

async function simpleTest() {
  console.log("🧪 Simple WebSocket Test");

  const client = new WebSocketClient({
    url: "ws://localhost:3000",
    onConnected: (sessionId) => {
      console.log("✅ Connected:", sessionId);
    },
    onError: (error) => {
      console.error("❌ Error:", error);
    },
  });

  try {
    // Connect
    await client.connect();
    console.log("🔗 Connected to server");

    // Test ping
    console.log("🏓 Testing ping...");
    const pingResult = await client.ping();
    console.log("✅ Ping successful:", pingResult);

    // Test simple command
    console.log("⚡ Testing echo command...");
    const result = await client.execute("echo", ["Hello World"]);
    console.log("✅ Command result:", {
      success: result.success,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      exitCode: result.exitCode,
    });
  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error; // Re-throw to trigger the catch block in the main execution
  } finally {
    client.disconnect();
    console.log("🔌 Disconnected");
  }
}

// Add a timeout to prevent hanging
const timeout = setTimeout(() => {
  console.error("❌ Test timed out after 30 seconds");
  process.exit(1);
}, 30000);

simpleTest()
  .then(() => {
    clearTimeout(timeout);
    console.log("✅ Simple test finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error("❌ Simple test failed:", error);
    process.exit(1);
  });
