/**
 * 工具相关公共契约。
 * 本文件只包含类型定义，禁止 import Pi SDK 或 Electron。
 */

/** 工具风险等级；由受信任代码在注册时指定，模型不能指定或修改。 */
export type ToolRisk = "read" | "write" | "execute";

/** 工具定义：注册表中的静态描述；inputSchema 用于在执行前校验模型生成的参数。 */
export interface ToolDefinition {
  /** 应用内部工具 ID，如 coding.read_file；与模型协议的工具名解耦。 */
  id: string;
  description: string;
  /** JSON Schema（draft-07 子集），由 Ajv 校验。 */
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
}

/**
 * 工具执行上下文：ToolService 绑定当前 Run 与工作区后传给 Handler。
 * signal 是取消信号；Handler 在长操作前应检查 signal.aborted。
 */
export interface ToolContext {
  runId: string;
  /** 固定的工作区目录；文件操作以此为根，不得越出。 */
  workspace: string;
  signal: AbortSignal;
}

/**
 * 工具结果：ok 表示执行成功；被拒绝、参数校验失败也是结果而非异常，
 * 文字部分供模型阅读并继续对话。
 */
export interface ToolResult {
  ok: boolean;
  text: string;
  data?: unknown;
}

/** 一次工具调用请求，来自 Agent。 */
export interface ToolRequest {
  toolId: string;
  input: unknown;
}

/** 工具的实际执行函数；只能通过 ToolService 被调用。 */
export interface RegisteredTool {
  definition: ToolDefinition;
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
