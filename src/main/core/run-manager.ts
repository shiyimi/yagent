/**
 * RunManager：Run 的生命周期、订阅、取消和结算。
 * 模型循环属于 Agent（Pi/Mock）；这里不实现"请求模型—执行工具"的重复循环。
 */
import { randomUUID } from "node:crypto";
import type { AgentAdapter, AgentSession } from "../../shared/contracts/agent.js";
import type {
  AppEvent,
  AppEventListener,
  RunRecord,
  RunTerminalStatus,
} from "../../shared/contracts/run.js";
import type { ToolService } from "../tools/service.js";

interface ActiveRun {
  runId: string;
  session?: AgentSession;
  controller: AbortController;
  cancelling: boolean;
  record: RunRecord;
}

export class RunManager {
  private active: ActiveRun | null = null;

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly toolService: ToolService,
    private readonly notify: AppEventListener,
  ) {}

  /**
   * 启动一次 Run。全应用同一时刻只允许一个活动 Run；
   * 返回的 Promise 在 Run 结束后以最终记录结算。
   */
  async startRun(input: string, workspace: string): Promise<RunRecord> {
    if (this.active) {
      throw new Error("已有任务在运行，请等待完成或先取消。");
    }
    const active: ActiveRun = {
      runId: randomUUID(),
      controller: new AbortController(),
      cancelling: false,
      record: { runId: randomUUID(), input, status: "running" },
    };
    active.record.runId = active.runId;
    this.active = active;

    let unsubscribe: (() => void) | undefined;
    try {
      const session = await this.adapter.createSession(
        {
          workspace,
          // 工具集合在 Run 开始时固定
          tools: this.toolService.listDefinitions(),
        },
        {
          invokeTool: (request) =>
            this.toolService.invoke(request, {
              runId: active.runId,
              workspace,
              signal: active.controller.signal,
            }),
        },
      );
      active.session = session;
      // 若在 createSession 期间已请求取消，同步给 Session
      if (active.controller.signal.aborted) await session.abort();
      unsubscribe = session.subscribe((event) =>
        this.handleCoreEvent({ runId: active.runId, ...event }),
      );

      this.notify({ runId: active.runId, type: "run.started" });
      try {
        await session.prompt(input);
        // 用户取消不算失败：prompt 正常 resolve，这里结算为 cancelled
        this.settle(active, active.cancelling ? "cancelled" : "completed");
      } catch (err) {
        active.record.error = err instanceof Error ? err.message : String(err);
        this.settle(active, "failed");
      }
    } finally {
      unsubscribe?.();
      if (active.session) await active.session.dispose();
      this.active = null;
    }
    return active.record;
  }

  /** 取消当前 Run：传播取消信号并等待真正停止。 */
  async cancel(): Promise<void> {
    const active = this.active;
    if (!active || active.cancelling) return;
    active.cancelling = true;
    active.controller.abort();
    await active.session?.abort();
  }

  /**
   * Core 内部事件入口：ToolService 的审批事件由此进入，
   * 与 Agent 事件一起更新 Run 状态后转发给界面。
   */
  handleCoreEvent(event: AppEvent): void {
    if (event.runId !== this.active?.runId) return;
    switch (event.type) {
      case "approval.requested":
        this.active.record.status = "waiting_approval";
        break;
      case "tool.completed":
        // 审批有了结果（无论允许还是拒绝），Run 回到 running
        if (this.active.record.status === "waiting_approval") {
          this.active.record.status = "running";
        }
        break;
      default:
        break;
    }
    this.notify(event);
  }

  private settle(active: ActiveRun, status: RunTerminalStatus): void {
    active.record.status = status;
    this.notify({ runId: active.runId, type: "run.finished", status });
  }
}
