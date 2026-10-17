/**
 * 工具注册表：只负责登记和查找，像一本通讯录。
 * 注册不代表获得批准；安全检查在 ToolService。
 */
import type { RegisteredTool } from "../../shared/contracts/tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /** 相同工具 ID 重复注册直接报错，避免静默替换实现。 */
  register(tool: RegisteredTool): void {
    const id = tool.definition.id;
    if (this.tools.has(id)) {
      throw new Error(`工具 ID 重复注册：${id}`);
    }
    this.tools.set(id, tool);
  }

  get(id: string): RegisteredTool | undefined {
    return this.tools.get(id);
  }

  /** 供创建会话时生成工具定义集合。 */
  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }
}
