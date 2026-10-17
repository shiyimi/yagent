/**
 * Agent 注册表：保存 Adapter 实现，创建会话时按 id 选择。
 */
import type { AgentAdapter } from "../../shared/contracts/agent.js";

export class AgentRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Agent ID 重复注册：${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }
}
