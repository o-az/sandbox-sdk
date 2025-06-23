import { Container, getContainer, getRandom } from "@cloudflare/containers";
import { HttpClient } from "./client";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox<Env>>;
};

export class Sandbox<Env = unknown> extends Container<Env> {
  client!: HttpClient;
  defaultPort = 3000; // The default port for the container to listen on
  sleepAfter = "3m"; // Sleep the container if no requests are made in this timeframe

  envVars = {
    MESSAGE: "I was passed in via the container class!",
  };

  override onStart() {
    console.log("Container successfully started");
    this.client = new HttpClient({
      baseUrl: "http://localhost:3000",
      onCommandStart: (command, args) => {
        console.log(
          `[Container] Command started: ${command} ${args.join(" ")}`
        );
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
  }

  override onStop() {
    console.log("Container successfully shut down");
    if (this.client) {
      this.client.clearSession();
    }
  }

  override onError(error: unknown) {
    console.log("Container error:", error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    // If you want to route requests to a specific container,
    // pass a unique container identifier to .get()

    if (pathname.startsWith("/api")) {
      const containerInstance = getContainer(env.Sandbox, pathname);
      return await containerInstance.containerFetch(request);
    }

    if (pathname.startsWith("/error")) {
      const containerInstance = getContainer(env.Sandbox, "error-test");
      return containerInstance.fetch(request);
    }

    if (pathname.startsWith("/lb")) {
      const containerInstance = await getRandom(env.Sandbox, 3);
      return containerInstance.fetch(request);
    }

    if (pathname.startsWith("/singleton")) {
      // getContainer will return a specific instance if no second argument is provided
      return getContainer(env.Sandbox).fetch(request);
    }

    return new Response(
      "Call /api to start a container with a 10s timeout.\nCall /error to start a container that errors\nCall /lb to test load balancing"
    );
  },
};
