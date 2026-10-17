/**
 * ToolService：工具调用的唯一门口。
 * 负责查找、参数校验、风险审批、执行；Agent 与界面都不直接调用工具 Handler。
 */
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import type { ToolContext, ToolRequest, ToolResult } from "../../shared/contracts/tool.js";
import type { AppEventListener } from "../../shared/contracts/run.js";
import type { ApprovalDecision, ApprovalGateway, ApprovalRequest } from "./approval.js";
import type { ToolRegistry } from "./registry.js";

export class ToolService {
  private readonly ajv = new Ajv();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly approvals: ApprovalGateway,
    /** 用于向界面转发 approval.requested 事件；CLI/GUI 依赖它展示审批卡片。 */
    private readonly notify?: AppEventListener,
  ) {}

  /** 供创建会话时生成可供模型选择的工具定义集合。 */
  listDefinitions() {
    return this.registry.list().map((tool) => tool.definition);
  }

  /**
   * 执行一次工具调用。被拒绝、取消、校验失败都返回 ok:false 的结果而非抛错，
   * Agent 据此决定下一步。
   */
  async invoke(request: ToolRequest, context: ToolContext): Promise<ToolResult> {
    if (context.signal.aborted) {
      return { ok: false, text: "任务已取消，工具未执行。" };
    }

    const tool = this.registry.get(request.toolId);
    if (!tool) {
      return { ok: false, text: `未知工具：${request.toolId}` };
    }

    const validate = this.ajv.compile(tool.definition.inputSchema);
    if (!validate(request.input)) {
      return {
        ok: false,
        text: `工具 ${request.toolId} 参数校验失败：${this.ajv.errorsText(validate.errors)}`,
      };
    }

    if (tool.definition.risk === "read") {
      return tool.execute(request.input, context);
    }

    // write/execute：保存请求并等待审批；审批只对这一个请求生效。
    const approval: ApprovalRequest = {
      approvalId: randomUUID(),
      runId: context.runId,
      toolId: request.toolId,
      input: request.input,
    };
    this.notify?.({
      runId: context.runId,
      type: "approval.requested",
      approvalId: approval.approvalId,
      toolId: approval.toolId,
      input: approval.input,
    });

    const decision: ApprovalDecision = await this.approvals.requestApproval(approval, context.signal);

    // 双重检查：取消后即使收到批准也不能执行；审批只允许一次。
    if (context.signal.aborted) {
      return { ok: false, text: "任务已取消，工具未执行。" };
    }
    if (decision !== "allow") {
      return { ok: false, text: `用户拒绝了工具 ${request.toolId} 的本次调用。` };
    }
    return tool.execute(request.input, context);
  }
}
