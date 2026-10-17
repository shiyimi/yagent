/**
 * 审批公共类型：write/execute 工具在执行前必须经过这里。
 */

/** 一次待审批请求；由 Main 创建并保存，界面只能返回决定，不能改写参数。 */
export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  toolId: string;
  input: unknown;
}

export type ApprovalDecision = "allow" | "deny";

/**
 * 审批入口的实现方（CLI 终端 / 以后是 GUI）负责展示真实参数。
 * Run 取消时实现方应结束等待（resolve 或 reject 均可），
 * ToolService 会在 Promise 结算后再次检查取消信号，取消后批准也不会执行。
 */
export interface ApprovalGateway {
  requestApproval(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
}
