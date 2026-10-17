/**
 * 学习用 CLI：装配与未来 Electron Main 相同的 Core，
 * 只把输入输出和审批换成终端实现。
 *
 * 运行：pnpm cli <任务文字>，审批时输入 y（允许）/ n（拒绝）/ c（取消任务）。
 */
import { createInterface } from "node:readline/promises";
import { MockAgentAdapter } from "../main/agents/mock.js";
import { RunManager } from "../main/core/run-manager.js";
import { readFileTool } from "../main/applications/coding/read-file.js";
import type {
  ApprovalDecision,
  ApprovalGateway,
  ApprovalRequest,
} from "../main/tools/approval.js";
import { registerDemoTools } from "../main/tools/demo.js";
import { ToolRegistry } from "../main/tools/registry.js";
import { ToolService } from "../main/tools/service.js";
import type { AppEventListener } from "../shared/contracts/run.js";

/** 终端审批：展示真实参数，y/n/c 决定；stdin 关闭（EOF）视为拒绝。 */
class CliApprovalGateway implements ApprovalGateway {
  constructor(private readonly cancelRun: () => Promise<void>) {}

  requestApproval(
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      let settled = false;
      const settle = (decision: ApprovalDecision): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        rl.close();
        resolve(decision);
      };
      const onAbort = (): void => settle("deny");
      signal.addEventListener("abort", onAbort, { once: true });

      console.log(`\n[审批] 工具 ${request.toolId} 请求执行：`);
      console.log(`  参数：${JSON.stringify(request.input)}`);
      rl.question("  允许一次？(y=允许 / n=拒绝 / c=取消任务) ")
        .then((answer) => {
          const choice = answer.trim().toLowerCase();
          if (choice === "y") settle("allow");
          else if (choice === "c") {
            void this.cancelRun();
            settle("deny");
          } else settle("deny");
        })
        .catch(() => settle("deny"));
    });
  }
}

/** 事件打印：文本流式输出，工具与 Run 生命周期打行日志。 */
const print: AppEventListener = (event) => {
  switch (event.type) {
    case "run.started":
      console.log(`\n=== Run 开始 ===`);
      break;
    case "message.delta":
      process.stdout.write(event.text);
      break;
    case "message.completed":
      process.stdout.write("\n");
      break;
    case "tool.started":
      console.log(`[工具] 调用 ${event.toolId} ...`);
      break;
    case "tool.completed":
      console.log(`[工具] ${event.toolId} ${event.ok ? "完成" : "未成功"}`);
      break;
    case "approval.requested":
      // 参数展示由审批交互负责，这里不再重复打印
      break;
    case "run.finished":
      console.log(`\n=== Run 结束：${event.status} ===`);
      break;
  }
};

async function main(): Promise<void> {
  const input = process.argv.slice(2).join(" ").trim();
  if (!input) {
    console.error("用法：pnpm cli <任务文字>");
    process.exitCode = 1;
    return;
  }
  const workspace = process.cwd();

  // 装配：与架构 4.2 节一致，只在入口组装具体实现
  const registry = new ToolRegistry();
  registerDemoTools(registry);
  registry.register(readFileTool);

  const adapter = new MockAgentAdapter();
  let runManager: RunManager;
  const toolService = new ToolService(
    registry,
    new CliApprovalGateway(() => runManager.cancel()),
    (event) => runManager.handleCoreEvent(event),
  );
  runManager = new RunManager(adapter, toolService, print);

  const record = await runManager.startRun(input, workspace);
  console.log(`Run 记录：${JSON.stringify(record, null, 2)}`);
}

void main().catch((err) => {
  console.error("CLI 异常退出：", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
