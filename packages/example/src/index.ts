import { Container, getContainer, getRandom } from "@cloudflare/containers";

type Env = {
  MY_CONTAINER: DurableObjectNamespace<MyContainer<Env>>;
};

export class MyContainer<Env = unknown> extends Container<Env> {
  defaultPort = 8080; // The default port for the container to listen on
  sleepAfter = "3m"; // Sleep the container if no requests are made in this timeframe

  envVars = {
    MESSAGE: "I was passed in via the container class!",
  };

  override onStart() {
    console.log("Container successfully started");
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
      const containerInstance = getContainer(env.MY_CONTAINER, pathname);
      return containerInstance.fetch(request);
    }

    if (pathname.startsWith("/error")) {
      const containerInstance = getContainer(env.MY_CONTAINER, "error-test");
      return containerInstance.fetch(request);
    }

    if (pathname.startsWith("/lb")) {
      const containerInstance = await getRandom(env.MY_CONTAINER, 3);
      return containerInstance.fetch(request);
    }

    if (pathname.startsWith("/singleton")) {
      // getContainer will return a specific instance if no second argument is provided
      return getContainer(env.MY_CONTAINER).fetch(request);
    }

    return new Response(
      "Call /container to start a container with a 10s timeout.\nCall /error to start a container that errors\nCall /lb to test load balancing"
    );
  },
};
