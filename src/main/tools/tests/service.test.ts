import { describe, expect, it } from "vitest";
import type {
  RegisteredTool,
  ToolDefinition,
  ToolResult,
} from "../../../shared/contracts/tool.js";
import type { ApprovalDecision, ApprovalGateway, ApprovalRequest } from "../approval.js";
import { ToolRegistry } from "../registry.js";
import { ToolService } from "../service.js";

/** 记录审批调用、返回预设决定的假审批入口。 */
class RecordingGateway implements ApprovalGateway {
  calls: ApprovalRequest[] = [];
  decision: ApprovalDecision = "deny";

  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.calls.push(request);
    return Promise.resolve(this.decision);
  }
}

function makeTool(id: string, risk: ToolDefinition["risk"], onExecute?: () => void): RegisteredTool {
  return {
    definition: {
      id,
      description: "测试工具",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", minLength: 1 } },
        required: ["text"],
        additionalProperties: false,
      },
      risk,
    },
    execute: async (input): Promise<ToolResult> => {
      onExecute?.();
      return { ok: true, text: `executed:${JSON.stringify(input)}` };
    },
  };
}

const context = (signal = new AbortController().signal) => ({
  runId: "run-1",
  workspace: "/tmp/workspace",
  signal,
});

describe("ToolRegistry", () => {
  it("相同工具 ID 重复注册直接报错", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("demo.echo", "read"));
    expect(() => registry.register(makeTool("demo.echo", "read"))).toThrow(/重复注册/);
  });
});

describe("ToolService", () => {
  it("read 工具直接执行，不经过审批", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register(makeTool("demo.echo", "read", () => (executed = true)));
    const gateway = new RecordingGateway();
    const service = new ToolService(registry, gateway);

    const result = await service.invoke({ toolId: "demo.echo", input: { text: "hi" } }, context());

    expect(result.ok).toBe(true);
    expect(executed).toBe(true);
    expect(gateway.calls).toHaveLength(0);
  });

  it("write 工具被拒绝时不执行，返回结构化拒绝结果", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register(makeTool("demo.confirm", "write", () => (executed = true)));
    const gateway = new RecordingGateway();
    gateway.decision = "deny";
    const service = new ToolService(registry, gateway);

    const result = await service.invoke({ toolId: "demo.confirm", input: { text: "hi" } }, context());

    expect(result.ok).toBe(false);
    expect(result.text).toContain("拒绝");
    expect(executed).toBe(false);
    expect(gateway.calls).toHaveLength(1);
  });

  it("write 工具被批准后执行一次", async () => {
    const registry = new ToolRegistry();
    let executed = 0;
    registry.register(makeTool("demo.confirm", "write", () => (executed += 1)));
    const gateway = new RecordingGateway();
    gateway.decision = "allow";
    const service = new ToolService(registry, gateway);

    const result = await service.invoke({ toolId: "demo.confirm", input: { text: "hi" } }, context());

    expect(result.ok).toBe(true);
    expect(executed).toBe(1);
  });

  it("任务取消后即使收到批准也不执行", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register(makeTool("demo.confirm", "write", () => (executed = true)));
    const gateway = new RecordingGateway();
    gateway.decision = "allow";
    const service = new ToolService(registry, gateway);

    const controller = new AbortController();
    const promise = service.invoke({ toolId: "demo.confirm", input: { text: "hi" } }, context(controller.signal));
    controller.abort();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.text).toContain("取消");
    expect(executed).toBe(false);
  });

  it("未知工具返回失败结果而非抛错", async () => {
    const service = new ToolService(new ToolRegistry(), new RecordingGateway());
    const result = await service.invoke({ toolId: "no.such", input: {} }, context());
    expect(result.ok).toBe(false);
    expect(result.text).toContain("未知工具");
  });

  it("参数不符合 Schema 时拒绝执行且不发起审批", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register(makeTool("demo.echo", "read", () => (executed = true)));
    const gateway = new RecordingGateway();
    const service = new ToolService(registry, gateway);

    const result = await service.invoke({ toolId: "demo.echo", input: { text: "" } }, context());

    expect(result.ok).toBe(false);
    expect(result.text).toContain("参数校验失败");
    expect(executed).toBe(false);
    expect(gateway.calls).toHaveLength(0);
  });
});
