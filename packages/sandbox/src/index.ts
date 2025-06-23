import { Container, getContainer } from "@cloudflare/containers";
import { HttpClient } from "./client";

export function getSandbox(ns: DurableObjectNamespace<Sandbox>, id: string) {
  return getContainer(ns, id);
}

export class Sandbox<Env = unknown> extends Container<Env> {
  defaultPort = 3000; // The default port for the container to listen on
  sleepAfter = "3m"; // Sleep the sandbox if no requests are made in this timeframe

  client: HttpClient = new HttpClient({
    onCommandComplete: (success, exitCode, stdout, stderr, command, args) => {
      console.log(
        `[Container] Command completed: ${command}, Success: ${success}, Exit code: ${exitCode}`
      );
    },
    onCommandStart: (command, args) => {
      console.log(`[Container] Command started: ${command} ${args.join(" ")}`);
    },
    onError: (error, command, args) => {
      console.error(`[Container] Command error: ${error}`);
    },
    onOutput: (stream, data, command) => {
      console.log(`[Container] [${stream}] ${data}`);
    },
    port: this.defaultPort,
  });

  envVars = {
    MESSAGE: "I was passed in via the Sandbox class!",
  };

  override onStart() {
    console.log("Sandbox successfully started");
  }

  override onStop() {
    console.log("Sandbox successfully shut down");
    if (this.client) {
      this.client.clearSession();
    }
  }

  override onError(error: unknown) {
    console.log("Sandbox error:", error);
  }

  async exec(command: string, args: string[], options?: { stream?: boolean }) {
    if (options?.stream) {
      return this.client.executeStream(command, args);
    }
    return this.client.execute(command, args);
  }

  async gitCheckout(
    repoUrl: string,
    options: { branch?: string; targetDir?: string; stream?: boolean }
  ) {
    if (options?.stream) {
      return this.client.gitCheckoutStream(
        repoUrl,
        options.branch,
        options.targetDir
      );
    }
    return this.client.gitCheckout(repoUrl, options.branch, options.targetDir);
  }

  async mkdir(
    path: string,
    options: { recursive?: boolean; stream?: boolean }
  ) {
    if (options?.stream) {
      return this.client.mkdirStream(path, options.recursive);
    }
    return this.client.mkdir(path, options.recursive);
  }
}
