# Agent Note: 单个实时 Agent 之上的终端入口

Status: implemented

[English](2026-11-21-tui-terminal-front-door.md) | 中文

## Problem

DeepSeek Harness 提供 Web、ACP、JSON-RPC 与一次性界面，但通过 SSH 或身处终端中的人没有交互式界面。被删除的 `@deepseek-ai/dsh-tui` [已被移除](../../archived/simplification/2026-08-04-remove-tui-package.md)，因为没有随附配置文件挂载它；该记录为接任者设定了门槛：具名产品或部署、显式包边界、具体的交互提供器，以及组装后的生命周期与对话记录验收。本变更以随附的 `tui` 配置文件满足该门槛。

## Decision

新增的 `tui` 配置文件把 `dsh-base` 与一个只含补丁的 bundle [`@deepseek-ai/dsh-tui-app`](../../../../packages/bundle/tui-app/README.zh.md) 叠加，后者挂载两行：Commander 启动提供器与界面插件 [`@deepseek-ai/dsh-tui`](../../../../packages/tui/tui/README.zh.md)。界面与 Agent 运行在同一 Node 进程中；它不挂载 Host、HTTP 服务器、Client 模块或浏览器插件，因此终端会话不需要端口、Cookie 或传输层。

界面使用与 Web 界面相同的接缝，而不是私有副本：它通过 `ctx.agents` 创建或恢复一个 Agent，用 `followup`/`steer`/`cancel` 驱动回合，从 `session/event` 读取持久事实，从 `agent/assistant-stream` 读取实时令牌。它应答 `approval/request` 与 `user-questions/request` 瀑布，并通过 `ctx.commands` 分发人类命令，与浏览器适配器完全一致。工具卡片来自 `ctx.tools.get(name).presentCall`/`presentResult`，因此工具拥有自己的终端呈现，界面不硬编码任何工具名。

启动推迟到 `ctx.appReady`。`dsh --profile tui --help` 在启动行解析期间就请求退出，因此它打印帮助并退出，不占用终端；无关行失败也绝不会把屏幕留在 raw 模式。非 TTY 调用在渲染前拒绝，并指向 `dsh --profile headless`。退出会取消运行中的回合、刷新 Session、释放 Agent 句柄、停止渲染器，然后请求有界进程退出。`/resume` 通过 `ctx.sessionQuery` 校验目标，并拒绝记录在其他工作目录下、或在本组装未挂载的 agent preset 下创建的 Session，因为继续日志时进程 cwd 与已组装工具必须一致。

渲染使用 `@earendil-works/pi-tui`——被删除包的渲染器，也是已解析的传递依赖，现提升为直接依赖。另一方案——把界面做成 Web 网关的 Node 客户端——被否决：它会为单用户终端界面增加传输、认证、重连与第二个进程边界，而 Client 对话折在入口处是 React 形态的。

## Alternatives considered

**整体复用被删除的包。** 否决，因为它针对重命名前的 Cordis 包、`ctx.userInteraction`、旧的 agent 模型目标 API 与 pi-tui 0.80 编写；导入它会保留已移除接缝的第二份实现，而不是当前接缝。它的呈现规则影响了本界面的组件划分，但代码是新的。

**把 TUI 作为 Web 网关的 Node 客户端经环回运行。** 否决，因为浏览器传输需要 Host 服务器、令牌准入与重连监督，而可复用的对话折并未向终端消费者导出。共享进程的终端界面不需要这些。

**让 TUI 成为现有 `web` 配置文件的第二个前端。** 否决，因为 Web bundle 禁用了 base agent 平面并挂载按会话的 preset；单进程终端界面需要 base 平面，混合二者会让一个配置文件拥有两种应用形态。

## Consequences

`dsh tui` 成为 CLI 帮助、配置文件模板表与架构图中的随附入口；`dsh --profile tui --help` 是受支持的非交互路径。该 bundle 加入 base 刻意省略的 `ask_user_question` 工具，并禁用配置 HMR，因为重载会在对话进行中替换 Agent 与渲染器。界面一次支持一个 Session；`/resume` 就地替换 Agent 并重放其日志。Web GUI、ACP 与 SDK 客户端仍是独立 bundle，因此一个进程仍只提供一种应用形态。

## Verification

`packages/tui/tui/tests/tui.spec.ts` 在真实的 `SessionStore`、`SessionProjectionRegistry`、`AgentRegistry`、`ApprovalService` 与 `UserQuestionService` 之上、以脚本化 Agent 与终端替身启动界面，然后断言渲染出的横幅与编辑器、提交的 follow-up、流式助手文本、允许与拒绝两种审批、选中的提问选项、引导提交，以及 Ctrl+D 刷新并退出的路径。`transcript.spec.ts` 检查持久事件投影、流式步骤就地结算、工具卡完成、错误提示、待办计划与回放。`startup.spec.ts` 在真实 Loader 树上运行提供器，覆盖提示词解析、resume/权限/审批/写授权选项、帮助以零退出且不发布服务，以及空输入拒绝。`loop.spec.ts` 用脚本化适配器挂载生产版 `dsh-agent-loop`，断言一个回合的流式推理、回复与用量结算经真实循环到达终端，并将归一化屏幕与已提交的预期输出比对。`packages/bundle/tui-app/tests/composed-boot.spec.ts` 组装随附的 base 与 tui-app 补丁文档，断言其界面、启动、提问工具与 persona 行，并在子进程中通过真实 Loader 与 AgentLoop（脚本化适配器）启动这些行。`snapshots/tui/tui.snapshot.ts` 在 PTY 下经 `dsh` CLI 启动随附的 `tui` 配置，用 `llm-replay` 回放，并将归一化的持久化会话及其系统提示与工具 schema 边车与已提交夹具比对。仓库的源码构建、类型检查、文档门禁、locale 元数据、包约束，以及本包每个源文件 100% 的逐文件覆盖率门禁，在两个新包存在时全部通过。
