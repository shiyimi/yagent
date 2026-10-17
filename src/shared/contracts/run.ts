/**
 * Run 相关公共契约。
 * 事件命名与架构文档 8.2 节一致：run.finished 是唯一终态事件，
 * 审批拒绝的工具调用以 tool.completed 结束并在结果中标记被拒绝。
 */
import type { AgentEvent } from "./agent.js";

/** Run 状态；idle 是 Session 状态，不是 Run 状态。 */
export type RunStatus =
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

/** Run 的终态；completed 不代表任务达到目标，判断依据是 Diff、退出码等证据。 */
export type RunTerminalStatus = "completed" | "failed" | "cancelled";

/** 一次 Run 的记录；终态写入后不再变化。 */
export interface RunRecord {
  runId: string;
  input: string;
  status: RunStatus;
  /** status 为 failed 时的错误说明。 */
  error?: string;
}

/** Core 转发给界面/CLI 的应用事件：Agent 事件附加 runId，再加 Run 生命周期事件。 */
export type AppEvent =
  | ({ runId: string } & AgentEvent)
  | { runId: string; type: "run.started" }
  | {
      runId: string;
      type: "approval.requested";
      approvalId: string;
      toolId: string;
      /** 工具的真实输入参数；界面必须原样展示，不得猜测。 */
      input: unknown;
    }
  | { runId: string; type: "run.finished"; status: RunTerminalStatus };

export type AppEventListener = (event: AppEvent) => void;
