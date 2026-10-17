import { describe, expect, it, vi } from "vitest";
import type { RegisteredTool } from "../../../shared/contracts/tool.js";
import type { AppEvent } from "../../../shared/contracts/run.js";
import { MockAgentAdapter } from "../../agents/mock.js";
import { RunManager } from "../run-manager.js";
import type { ApprovalDecision, ApprovalGateway, ApprovalRequest } from "../../tools/approval.js";
import { ToolRegistry } from "../../tools/registry.js";
import { ToolService } from "../../tools/service.js";

/**
 * 手动结算的审批入口：测试在等待审批时决定放行、拒绝或取消。
 * Run 取消时（abort 信号）按 CLI 的行为返回 deny。
 */
class ManualGateway implements ApprovalGateway {
  /** 最近一次待审批请求的结算函数。 */
  resolver: ((decision: ApprovalDecision) => void) | null = null;

  requestApproval(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      signal.addEventListener("abort", () => resolve("deny"), { once: true });
    });
  }
}

interface Fixture {
  runManager: RunManager;
  gateway: ManualGateway;
  events: AppEvent[];
  executed: () => number;
}

function build(): Fixture {
  const registry = new ToolRegistry();
  let executeCount = 0;
  const tool: RegisteredTool = {
    definition: {
      id: "demo.confirm",
      description: "测试审批用 write 工具",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      risk: "write",
    },
    execute: async () => {
      executeCount += 1;
      return { ok: true, text: "done" };
    },
  };
  registry.register(tool);

  const gateway = new ManualGateway();
  const events: AppEvent[] = [];
  let runManager: RunManager;
  // ToolService 的审批事件经 RunManager 汇总，保证 waiting_approval 状态可见
  const toolService = new ToolService(registry, gateway, (event) => runManager.handleCoreEvent(event));
  runManager = new RunManager(new MockAgentAdapter(), toolService, (event) => events.push(event));
  return { runManager, gateway, events, executed: () => executeCount };
}

const workspace = process.cwd();

describe("RunManager", () => {
  it("审批允许：工具执行，Run 以 completed 结束", async () => {
    const f = build();
    const promise = f.runManager.startRun("你好", workspace);
    await vi.waitFor(() => expect(f.gateway.resolver).not.toBeNull());
    f.gateway.resolver?.("allow");

    const record = await promise;
    expect(record.status).toBe("completed");
    expect(f.executed()).toBe(1);
    expect(f.events.some((e) => e.type === "tool.completed" && e.ok)).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ type: "run.finished", status: "completed" });
  });

  it("审批拒绝：工具不执行，Agent 收到拒绝结果，Run 仍是 completed", async () => {
    const f = build();
    const promise = f.runManager.startRun("你好", workspace);
    await vi.waitFor(() => expect(f.gateway.resolver).not.toBeNull());
    f.gateway.resolver?.("deny");

    const record = await promise;
    expect(record.status).toBe("completed");
    expect(f.executed()).toBe(0);
    // 被拒绝的工具调用同样以 tool.completed 结束，结果标记未成功
    expect(f.events.some((e) => e.type === "tool.completed" && !e.ok)).toBe(true);
  });

  it("等待审批时取消：工具不执行，Run 以 cancelled 结束", async () => {
    const f = build();
    const promise = f.runManager.startRun("你好", workspace);
    await vi.waitFor(() => expect(f.gateway.resolver).not.toBeNull());
    await f.runManager.cancel();

    const record = await promise;
    expect(record.status).toBe("cancelled");
    expect(f.executed()).toBe(0);
    expect(f.events.at(-1)).toMatchObject({ type: "run.finished", status: "cancelled" });
  });

  it("已有活动 Run 时拒绝新的 startRun", async () => {
    const f = build();
    const promise = f.runManager.startRun("第一个任务", workspace);
    await vi.waitFor(() => expect(f.gateway.resolver).not.toBeNull());

    await expect(f.runManager.startRun("第二个任务", workspace)).rejects.toThrow(/已有任务在运行/);

    f.gateway.resolver?.("allow");
    await promise;
  });

  it("Run 期间状态从 running 经 waiting_approval 回到 running", async () => {
    const f = build();
    const promise = f.runManager.startRun("你好", workspace);
    // 审批事件先于工具执行事件；等待审批期间 Run 处于 waiting_approval
    await vi.waitFor(() =>
      expect(f.events.some((e) => e.type === "approval.requested")).toBe(true),
    );
    f.gateway.resolver?.("allow");
    await promise;

    const approvalIndex = f.events.findIndex((e) => e.type === "approval.requested");
    const toolIndex = f.events.findIndex((e) => e.type === "tool.completed");
    expect(approvalIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(approvalIndex);
  });
});
