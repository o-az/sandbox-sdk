import { Container, getContainer } from "@cloudflare/containers";
import { HttpClient } from "./client";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox<Env>>;
};

export function getSandbox(
  ns: DurableObjectNamespace<Sandbox<Env>>,
  id: string
) {
  return getContainer(ns, id);
}

export class Sandbox<Env = unknown> extends Container<Env> {
  baseUrl = "http://localhost:3000";
  client: HttpClient = new HttpClient({
    baseUrl: this.baseUrl,
    onCommandStart: (command, args) => {
      console.log(`[Container] Command started: ${command} ${args.join(" ")}`);
    },
    onOutput: (stream, data, command) => {
      console.log(`[Container] [${stream}] ${data}`);
    },
    onCommandComplete: (success, exitCode, stdout, stderr, command, args) => {
      console.log(
        `[Container] Command completed: ${command}, Success: ${success}, Exit code: ${exitCode}`
      );
    },
    onError: (error, command, args) => {
      console.error(`[Container] Command error: ${error}`);
    },
  });
  defaultPort = 3000; // The default port for the container to listen on
  sleepAfter = "3m"; // Sleep the sandbox if no requests are made in this timeframe

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/sandbox")) {
      const parts = pathname.split("/");
      if (parts.length < 2) {
        return new Response("Not found", { status: 404 });
      }
      const sandbox = getSandbox(env.Sandbox, parts[1]);
      return sandbox.containerFetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
