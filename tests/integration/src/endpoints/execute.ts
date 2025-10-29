import type { Sandbox } from "@cloudflare/sandbox";
import { parseJsonBody, errorResponse, jsonResponse } from "../http";

export async function executeCommand(sandbox: Sandbox<unknown>, request: Request) {
    const body = await parseJsonBody(request);
    const { command, cwd, env } = body;
    if (!command) {
        return errorResponse("Command is required");
    }

    const result = await sandbox.exec(command, { cwd, env });
    return jsonResponse({
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        command: result.command,
        duration: result.duration
    });
}
