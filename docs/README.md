# Agent Desktop 学习文档

本项目从零实现 Windows 编程 Agent 桌面应用，学习优先：先做模块化闭环，再按需要拆进程。阶段 1（CLI + Mock Agent）已实现，见[阶段说明](stages/01-cli-mock.md)；其余阶段仍是设计目标。

## 推荐阅读顺序

1. [学习版架构](architecture/2026-10-12-agent-desktop-design.md)：目标、四个扩展点、数据流、审批、保存与演进。
2. [分阶段学习路线](learning/01-roadmap.md)：从 CLI/Mock 到 Pi、Electron、工具、历史与安装包。
3. [阶段 1 说明](stages/01-cli-mock.md)：CLI + Mock Agent 的实现、运行与验收记录。
4. [术语表](learning/02-glossary.md)：阅读中遇到不熟悉的名词时查阅。
5. [文档与注释约定](guides/documentation-and-comments.md)：后续每个模块、阶段和关键接口如何写说明。

文档中的接口和目录是设计，尚未实现的能力不会被标记为通过。Mermaid 图需要支持 Mermaid 的 Markdown 查看器；不支持时可阅读代码块对应的解释。

从架构的第 4 节开始，可以沿着“界面请求 → Core → Agent → 工具审批 → 文件或命令 → 结果”的路径阅读，遇到具体流程再结合时序图。
