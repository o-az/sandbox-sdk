import { Container, getContainer, getRandom } from "@cloudflare/containers";
// import { WebSocketClient } from "./client";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox<Env>>;
};

export class Sandbox<Env = unknown> extends Container<Env> {
  // client!: WebSocketClient;
  defaultPort = 3000; // The default port for the container to listen on
  sleepAfter = "3m"; // Sleep the container if no requests are made in this timeframe

  envVars = {
    MESSAGE: "I was passed in via the container class!",
  };

  override onStart() {
    console.log("Container successfully started");
    // const ws = this.fetch("http://localhost:3000");
    // this.client = new WebSocketClient({
    //   url: "ws://localhost:3000",
    // });
  }

  override onStop() {
    console.log("Container successfully shut down");
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

    if (pathname.startsWith("/container")) {
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
      "Call /container to start a container with a 10s timeout.\nCall /error to start a container that errors\nCall /lb to test load balancing"
    );
  },
};
