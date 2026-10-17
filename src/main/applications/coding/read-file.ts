/**
 * 编程应用的最小工具：只读读取工作区内的文件。
 * 路径校验是阶段 1 就要建立的边界，不随实现推迟。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { RegisteredTool } from "../../../shared/contracts/tool.js";

/**
 * 解析并校验目标必须位于工作区内且已存在。
 * 先用 realpath 统一大小写并解析符号链接/junction，再做相对路径判断；
 * 单纯的字符串 startsWith 在 Windows 大小写和链接场景下不可靠。
 */
async function resolveInsideWorkspace(workspace: string, relativePath: string): Promise<string> {
  const workspaceReal = await fs.realpath(workspace);
  const targetReal = await fs.realpath(path.resolve(workspaceReal, relativePath));
  const rel = path.relative(workspaceReal, targetReal);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("路径越出工作区");
  }
  return targetReal;
}

export const readFileTool: RegisteredTool = {
  definition: {
    id: "coding.read_file",
    description: "读取工作区内一个已存在的文本文件，返回其内容",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", minLength: 1 } },
      required: ["path"],
      additionalProperties: false,
    },
    risk: "read",
  },
  async execute(input, context) {
    const { path: relativePath } = input as { path: string };
    try {
      const target = await resolveInsideWorkspace(context.workspace, relativePath);
      const content = await fs.readFile(target, "utf8");
      // 长输出截断；完整文件引用（artifact）属于后续阶段
      return { ok: true, text: content.slice(0, 20000), data: { path: relativePath } };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, text: `读取失败：${reason}` };
    }
  },
};
