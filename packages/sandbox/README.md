## @cloudflare/sandbox

A library to spin up a sandboxed environment.

```ts
import { Sandbox } from "@cloudflare/sandbox";

const sandbox = new Sandbox(ctx, env, {
  // optional, defaults to env.Sandbox
  binding: env.Sandbox,
  repo: "https://github.com/your-username/a-starting-repo.git",
});
```
