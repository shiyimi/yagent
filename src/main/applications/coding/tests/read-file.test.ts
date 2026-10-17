import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readFileTool } from "../read-file.js";
import type { ToolContext } from "../../../shared/contracts/tool.js";

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agent-desktop-ws-"));
}

const context = (workspace: string): ToolContext => ({
  runId: "run-test",
  workspace,
  signal: new AbortController().signal,
});

describe("coding.read_file", () => {
  it("读取工作区内的文件", async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "README.txt"), "hello solar", "utf8");

    const result = await readFileTool.execute({ path: "README.txt" }, context(workspace));

    expect(result.ok).toBe(true);
    expect(result.text).toBe("hello solar");
  });

  it("拒绝越出工作区的路径", async () => {
    const workspace = await makeWorkspace();
    const outside = await makeWorkspace();
    await fs.writeFile(path.join(outside, "secret.txt"), "outside", "utf8");

    const result = await readFileTool.execute(
      { path: path.join("..", path.basename(outside), "secret.txt") },
      context(workspace),
    );

    expect(result.ok).toBe(false);
    expect(result.text).toContain("越出工作区");
  });

  it("不存在的文件返回失败结果而非抛错", async () => {
    const workspace = await makeWorkspace();
    const result = await readFileTool.execute({ path: "no-such.txt" }, context(workspace));
    expect(result.ok).toBe(false);
    expect(result.text).toContain("读取失败");
  });
});
