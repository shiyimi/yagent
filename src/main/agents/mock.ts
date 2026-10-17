/**
 * Mock Agent：阶段 1 的脚本化引擎。
 * 不接模型，按固定步骤"发文字 → 调工具 → 汇报结果"，
 * 用于在无 API Key 的条件下观察 Agent 与 Core 的协作。
 */
import { randomUUID } from "node:crypto";
import type {
  AgentAdapter,
  AgentBridge,
  AgentEvent,
  AgentSession,
  AgentSessionConfig,
} from "../../shared/contracts/agent.js";

export class MockAgentAdapter implements AgentAdapter {
  readonly id = "mock";
  readonly supportedApiStyles: string[] = [];

  async createSession(config: AgentSessionConfig, bridge: AgentBridge): Promise<AgentSession> {
    return new MockAgentSession(bridge);
  }
}

class MockAgentSession implements AgentSession {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  /** 取消标记：prompt 在各步骤间检查，取消后不再发起新动作，正常 resolve。 */
  private abortRequested = false;

  constructor(private readonly bridge: AgentBridge) {}

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(input: string): Promise<void> {
    if (this.abortRequested) return;
    this.emitMessage("收到任务，我将调用演示工具处理。");
    if (this.abortRequested) return;

    const toolCallId = randomUUID();
    this.emit({ type: "tool.started", toolCallId, toolId: "demo.confirm" });
    const result = await this.bridge.invokeTool({
      toolId: "demo.confirm",
      input: { text: input },
    });
    this.emit({ type: "tool.completed", toolCallId, toolId: "demo.confirm", ok: result.ok });
    if (this.abortRequested) return;

    this.emitMessage(`演示结果：${result.text}`);
  }

  /** 只发出中止标记并立即返回；prompt 自己在检查点收尾，不抛错。 */
  async abort(): Promise<void> {
    this.abortRequested = true;
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
  }

  private emitMessage(text: string): void {
    const messageId = randomUUID();
    this.emit({ type: "message.delta", messageId, text });
    this.emit({ type: "message.completed", messageId, text });
  }

  private emit(event: AgentEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
