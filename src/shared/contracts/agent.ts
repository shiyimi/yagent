/**
 * Agent 相关公共契约。
 * Pi SDK 的 import 和类型转换只允许出现在 agents/pi（阶段 2）。
 */
import type { ToolDefinition, ToolRequest, ToolResult } from "./tool.js";

/** Agent 对外事件；Core 订阅后附加 runId 转发给界面。 */
export type AgentEvent =
  | { type: "message.delta"; messageId: string; text: string }
  | { type: "message.completed"; messageId: string; text: string }
  | { type: "tool.started"; toolCallId: string; toolId: string }
  | { type: "tool.completed"; toolCallId: string; toolId: string; ok: boolean };

/** Adapter 创建 Session 所需的全部输入。 */
export interface AgentSessionConfig {
  /** 固定的工作区目录；工具执行以此为根。 */
  workspace: string;
  /** 本次会话可供模型选择的工具定义集合；Run 开始后固定。 */
  tools: ToolDefinition[];
  systemPrompt?: string;
}

/** Agent 到 Core 的受控桥：Adapter 只能通过它使用工具和凭据，不接触完整 Core。 */
export interface AgentBridge {
  invokeTool(request: ToolRequest): Promise<ToolResult>;
}

export interface AgentSession {
  /** 本次模型与工具循环全部结束后才 resolve；失败 reject；用户取消不算失败。 */
  prompt(input: string): Promise<void>;
  /** 等待运行真正停止，不只发出中止通知；相关命令由 Core 同时取消。 */
  abort(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  dispose(): Promise<void>;
}

/** Agent Adapter：决定"下一步做什么"的引擎；Pi 是第一个实现，Mock 用于学习。 */
export interface AgentAdapter {
  id: string;
  /** 支持的模型协议风格；阶段 1 的 Mock 为空数组。 */
  supportedApiStyles: string[];
  createSession(config: AgentSessionConfig, bridge: AgentBridge): Promise<AgentSession>;
}
