import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { CubeWorker } from "../../../workers/cube-worker/src/index.js";
import { OutlookWorker } from "../../../workers/outlook-worker/src/index.js";
import { WebWorker } from "../../../workers/web-worker/src/index.js";

export class CompositeToolExecutor implements ToolExecutor {
  constructor(
    private readonly outlookWorker = new OutlookWorker(),
    private readonly webWorker = new WebWorker(),
    private readonly cubeWorker = new CubeWorker()
  ) {}

  async execute(request: ToolRequest): Promise<ToolResult> {
    if (
      request.tool_name.includes("outlook_") ||
      request.tool_name === "watch_email_reply" ||
      request.tool_name === "await_email_reply"
    ) {
      return this.outlookWorker.execute(request);
    }
    if (request.tool_name.includes("web") || request.tool_name === "open_system") {
      return this.webWorker.execute(request);
    }
    if (request.tool_name.includes("cube")) {
      return this.cubeWorker.execute(request);
    }
    return {
      request_id: request.request_id,
      success: false,
      output: {
        error: `Tool ${request.tool_name} not implemented in composite executor`
      },
      memory_patch: {},
      emitted_events: []
    };
  }
}
