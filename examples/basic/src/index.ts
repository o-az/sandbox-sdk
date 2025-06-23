import { getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
};

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
