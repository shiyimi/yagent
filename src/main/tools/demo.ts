/**
 * 阶段 1 演示工具：没有真实副作用，用于观察"注册 → 审批 → 执行"的完整路径。
 */
import type { RegisteredTool } from "../../shared/contracts/tool.js";

/** demo.echo：read 风险，直接执行，不经过审批。 */
export const demoEchoTool: RegisteredTool = {
  definition: {
    id: "demo.echo",
    description: "原样返回输入文字，用于演示只读工具的直接执行路径",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1 } },
      required: ["text"],
      additionalProperties: false,
    },
    risk: "read",
  },
  async execute(input) {
    const { text } = input as { text: string };
    return { ok: true, text, data: { tool: "demo.echo" } };
  },
};

/**
 * demo.confirm：刻意注册为 write 风险——它不产生任何副作用，
 * 但只有这样才能在没有真实文件/命令的情况下演练完整审批流程。
 */
export const demoConfirmTool: RegisteredTool = {
  definition: {
    id: "demo.confirm",
    description: "需要用户批准后才返回确认文字，用于演示 write 风险工具的审批路径",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1 } },
      required: ["text"],
      additionalProperties: false,
    },
    risk: "write",
  },
  async execute(input) {
    const { text } = input as { text: string };
    return { ok: true, text: `已获批准并执行，原文：${text}` };
  },
};

/** 一次性注册阶段 1 的全部演示工具。 */
export function registerDemoTools(registry: { register(tool: RegisteredTool): void }): void {
  registry.register(demoEchoTool);
  registry.register(demoConfirmTool);
}
