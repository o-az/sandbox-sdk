import { DurableObject } from "cloudflare:workers";
import { Container, ContainerOptions } from "@cloudflare/containers";

export class Sandbox<Env = unknown> extends Container<Env> {
  constructor(ctx: DurableObject["ctx"], env: Env, options?: ContainerOptions) {
    super(ctx, env, options);
  }

  async exec(command: string) {
    return this.ctx.exec(command);
  }
}
