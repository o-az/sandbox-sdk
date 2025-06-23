import { WebSocketClient } from "./src/client";

async function connectionTest() {
  console.log("🔌 Testing WebSocket Connection Only");

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

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("✅ Connection test successful");
  } catch (error) {
    console.error("❌ Connection test failed:", error);
    throw error;
  } finally {
    client.disconnect();
    console.log("🔌 Disconnected");
  }
}

// Add a timeout to prevent hanging
const timeout = setTimeout(() => {
  console.error("❌ Connection test timed out after 10 seconds");
  process.exit(1);
}, 10000);

connectionTest()
  .then(() => {
    clearTimeout(timeout);
    console.log("✅ Connection test finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error("❌ Connection test failed:", error);
    process.exit(1);
  });
