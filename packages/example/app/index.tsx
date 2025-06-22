import { createRoot } from "react-dom/client";
import React, { useState, useEffect, useRef } from "react";
import { WebSocketClient } from "../src/client";
import "./style.css";

interface CommandResult {
  id: string;
  command: string;
  args: string[];
  status: "running" | "completed" | "error";
  stdout: string;
  stderr: string;
  exitCode?: number;
  timestamp: Date;
}

function REPL() {
  const [client, setClient] = useState<WebSocketClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [results, setResults] = useState<CommandResult[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new results are added
  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  // Initialize WebSocket client
  useEffect(() => {
    const wsClient = new WebSocketClient({
      url: `wss://${window.location.host}/container`,
      onConnected: (sessionId) => {
        console.log("Connected with session:", sessionId);
        setIsConnected(true);
      },
      onCommandStart: (command, args) => {
        const newResult: CommandResult = {
          id: Date.now().toString(),
          command,
          args,
          status: "running",
          stdout: "",
          stderr: "",
          timestamp: new Date(),
        };
        setResults((prev) => [...prev, newResult]);
        setIsExecuting(true);
      },
      onOutput: (stream, data, command) => {
        setResults((prev) => {
          const updated = [...prev];
          const lastResult = updated[updated.length - 1];
          if (lastResult && lastResult.command === command) {
            if (stream === "stdout") {
              lastResult.stdout += data;
            } else {
              lastResult.stderr += data;
            }
          }
          return updated;
        });
      },
      onCommandComplete: (success, exitCode, stdout, stderr, command, args) => {
        setResults((prev) => {
          const updated = [...prev];
          const lastResult = updated[updated.length - 1];
          if (lastResult && lastResult.command === command) {
            lastResult.status = success ? "completed" : "error";
            lastResult.exitCode = exitCode;
            lastResult.stdout = stdout;
            lastResult.stderr = stderr;
          }
          return updated;
        });
        setIsExecuting(false);
      },
      onError: (error, command) => {
        console.error("Command error:", error);
        setResults((prev) => {
          const updated = [...prev];
          const lastResult = updated[updated.length - 1];
          if (lastResult && lastResult.command === command) {
            lastResult.status = "error";
            lastResult.stderr += `\nError: ${error}`;
          }
          return updated;
        });
        setIsExecuting(false);
      },
      onClose: () => {
        setIsConnected(false);
        console.log("WebSocket connection closed");
      },
    });

    setClient(wsClient);

    // Connect to WebSocket
    wsClient.connect().catch((error) => {
      console.error("Failed to connect:", error);
    });

    // Cleanup on unmount
    return () => {
      wsClient.disconnect();
    };
  }, []);

  const executeCommand = () => {
    if (!client || !isConnected || !commandInput.trim() || isExecuting) {
      return;
    }

    const trimmedCommand = commandInput.trim();
    const parts = trimmedCommand.split(" ");
    const command = parts[0];
    const args = parts.slice(1);

    try {
      client.execute(command, args);
      setCommandInput("");
    } catch (error) {
      console.error("Failed to execute command:", error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    }
  };

  const clearResults = () => {
    setResults([]);
  };

  const getStatusColor = (status: CommandResult["status"]) => {
    switch (status) {
      case "running":
        return "text-blue-500";
      case "completed":
        return "text-green-500";
      case "error":
        return "text-red-500";
      default:
        return "text-gray-500";
    }
  };

  const getStatusIcon = (status: CommandResult["status"]) => {
    switch (status) {
      case "running":
        return "⏳";
      case "completed":
        return "✅";
      case "error":
        return "❌";
      default:
        return "⏳";
    }
  };

  return (
    <div className="repl-container">
      <div className="header">
        <h1>WebSocket REPL</h1>
        <div
          className={`connection-status ${
            isConnected ? "connected" : "disconnected"
          }`}
        >
          {isConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <div className="command-bar">
        <span className="command-prompt">$</span>
        <input
          type="text"
          className="command-input"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Enter command (e.g., ls -la)"
          disabled={!isConnected || isExecuting}
        />
        <div className="action-buttons">
          <button
            type="button"
            onClick={executeCommand}
            disabled={!isConnected || !commandInput.trim() || isExecuting}
            className="btn btn-execute"
          >
            {isExecuting ? "Executing..." : "Execute"}
          </button>
          <button type="button" onClick={clearResults} className="btn">
            Clear
          </button>
        </div>
      </div>

      <div className="results-container" ref={resultsEndRef}>
        {results.length === 0 ? (
          <div
            style={{ textAlign: "center", padding: "2rem", color: "#8b949e" }}
          >
            No commands executed yet. Try running a command above.
          </div>
        ) : (
          <div>
            {results.map((result) => (
              <div key={result.id} className="command-result">
                <div className="result-header">
                  <span className="status-icon">
                    {getStatusIcon(result.status)}
                  </span>
                  <div className="command-line">
                    ${" "}
                    <span>
                      {result.command} {result.args.join(" ")}
                    </span>
                  </div>
                  {result.status !== "running" &&
                    result.exitCode !== undefined && (
                      <span className="exit-code">
                        (exit: {result.exitCode})
                      </span>
                    )}
                  <span className="timestamp">
                    {result.timestamp.toLocaleTimeString()}
                  </span>
                </div>

                {result.stdout && (
                  <div className="stdout-output">
                    <pre>{result.stdout}</pre>
                  </div>
                )}

                {result.stderr && (
                  <div className="stderr-output">
                    <pre>{result.stderr}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="help-section">
        <h3>Example Commands</h3>
        <div className="help-grid">
          <div className="help-item">
            <span className="help-command">ls</span> - List files
          </div>
          <div className="help-item">
            <span className="help-command">pwd</span> - Print working directory
          </div>
          <div className="help-item">
            <span className="help-command">echo</span> - Print text
          </div>
          <div className="help-item">
            <span className="help-command">cat</span> - Display file contents
          </div>
          <div className="help-item">
            <span className="help-command">whoami</span> - Show current user
          </div>
          <div className="help-item">
            <span className="help-command">date</span> - Show current date/time
          </div>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<REPL />);
