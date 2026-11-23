# Agent Note: 将 Cursor ACP 作为模型提供方

Status: rejected — ACP runs Cursor's whole agent rather than model inference, so a provider route cannot honor DSH tool, approval, or metering contracts

[English](2026-11-22-cursor-acp-model-provider.md) | 中文

## 问题

需求是把 Cursor 的订阅接入 DeepSeek Harness，作为模型提供方使用；先核对 Cursor 的条款，并参考 pi-ai 的 `openai-codex` 路由。该路由通过 OpenAI 公布的套餐登录与后端来使用 ChatGPT 套餐。Cursor 没有为订阅公布等价的模型推理 API。其官方程序化接口是 Cursor CLI（`cursor-agent`，`--print` 被文档化为用于脚本和自动化）、CLI 的 ACP 模式（`cursor-agent acp`）以及 TypeScript SDK（`@cursor/sdk`），三者都运行 Cursor 自己的 agent loop；SDK 的本地运行时把 agent loop 放在调用方进程内，但推理仍然发送到 Cursor 托管的模型。

若直接访问 Cursor 的私有模型后端，就需要检查或推导该服务的内部协议，而 Cursor 服务条款 §1.5(i) 禁止这样做。因此与条款相容的程序化路径是文档化的 CLI、ACP 与 SDK 接口，三者都运行 Cursor 的 agent，而不是暴露补全 API。本记录说明该路径为何不符合 harness 的模型提供方约定，以免后续尝试重复这次调查。

## 提案

构建 `@deepseek-ai/dsh-llm-cursor-acp`：一个 `LlmAdapter`，启动 `cursor-agent acp`，用 `cursor_login` 调用 `authenticate`，在工作区创建 ACP 会话，把组装好的 DSH 对话渲染为一段 prompt，将 `agent_message_chunk` 文本作为 `text-delta` 块流式输出，把 `stopReason` 映射为 harness finish reason，并通过 `listModels()` 暴露账户公布的模型。模型 id 由 CLI 的 `--model` 参数选择，会话模式由 `session/set_mode` 选择。

每次模型调用使用一个全新的进程与 ACP 会话。下文否决的就是交付这一设计。

## 实测结果

探测针对 macOS 上的 Cursor CLI `2026.11.05-86047df`，使用已登录的订阅账户，工作区选在本仓库之外的临时目录。没有提交任何探测代码。

- `initialize` 返回 ACP 协议版本 1，只有一个认证方法 `cursor_login`，并声明 `loadSession` 与图片 prompt 能力。在已有 CLI 登录的前提下，`authenticate { methodId: 'cursor_login' }` 成功。
- `session/new` 返回会话 id、`agent`、`plan`、`ask` 三种模式、一个 `mode` 与一个 `model` 配置选项，以及账户相关的 `models.availableModels` 列表。`--model <id>` 可在 `session/new` 之前选择模型。
- `session/set_mode` 能切换模式。在探测中，传入根级 `--mode ask` 参数没有改变 ACP 会话的起始模式；显式调用 `session/set_mode` 才会改变。
- `session/prompt` 以极小的 `agent_message_chunk` 文本增量流式返回，最后以 `stopReason: end_turn` 结束。它不返回 token 用量。
- `session/close` 返回 "Method not found"；释放只能在进程层面完成（关闭 stdin，再终止进程）。
- 在 harness 的工作区沙箱下，CLI 在创建 `~/.cursor/projects/...` 时以 `EPERM` 失败。它需要自己的 home 状态，因此沙箱内的子进程无法运行，除非放宽沙箱或重定向 Cursor home。
- 在 `ask` 模式下，agent 拒绝了文件编辑请求，文件保持不变。
- 在 `agent` 模式下，一次文件编辑与一条 shell 命令都被执行。客户端已注册拒绝所有请求的 `session/request_permission` 处理器，但该处理器从未被调用。该主机的 `~/.cursor/cli-config.json` 设置了 `"approvalMode": "unrestricted"` 与 `sandbox.mode` 为 `disabled`，这解释了结果；客户端无法区分这些用户设置与 ACP 层面的批准，而 CLI 的用户配置可以绕过 DSH 的批准，并且 Cursor 自己的沙箱处于关闭状态，适配器无法强制 DSH 的批准。
- 文本以非常小的增量（几个字符）到达，因此提供方需要合并增量，才能得到合理的块大小与持久化效果。

## 未测试的内容

探测没有覆盖受限的 `approvalMode` 或启用的 Cursor 沙箱、Cursor SDK 运行时、Windows 或 Linux、团队管理的策略控制，以及工作区信任提示。这些仍是未决问题。它们不改变结论：无论如何，适配器都无法让 DSH 的批准模式或沙箱对 CLI 具有权威性，而缺少补全操作这一点与它们无关。

## 为何提供方路由不合适

**没有补全操作。** DSH 适配器接收组装好的消息、tool schema 与调用控制，返回文本、推理与工具调用块。`session/prompt` 只接收散文并运行 Cursor 自己的 loop；客户端得到文本、思考、工具调用通知、计划与会话元数据，但拿不到原始模型响应，也无法提供 DSH 的工具。该路由只能返回文本，意味着 DSH 的工具循环对它永远不会运行。`agent` 模式下的 Cursor 轮次则改为运行 Cursor 自己的工具，这些操作在 DSH 会话中不可见、也无法审计。

**批准与沙箱权威在 DSH 之外。** Cursor 在自己的进程内执行工具。ACP 定义了由客户端应答的 `session/request_permission`，但 CLI 自己的 `approvalMode` 与 `permissions` 规则决定哪些请求能到达客户端，而实测主机直接执行了编辑与 shell 命令。一个能在 harness 的批准模式与沙箱之外静默执行宿主命令的模型提供方，不是可接受的产品路由。默认使用 `ask` 可以避免编辑与 shell 命令，但会把该路由降级为只读聊天模型，并非需求所要求的能力。

**会话状态无法映射到模型调用。** DSH 从持久日志组装每次调用，并可能重试、压缩、分叉或重放它。ACP 会话是有状态的远端会话。每次调用新建会话会重发完整历史并重复 agent 工作；复用会话则需要 `session/load` 以及持久化的增量协议，而 `GenerateOptions` 并不携带这些信息。模型切换、压缩请求与失败的轮次都需要各自的远端会话策略。

**计量不可见。** prompt 响应不携带用量与上下文统计，因此该路由无法进行 token 计量与上下文压力评估。

**进程不便于沙箱化。** CLI 在能使用 ACP 之前就需要用户 home 目录下的可写状态。harness 的子进程 seam 会执行凭据清洗，但不会适配 Cursor 的 home 布局；在 harness 沙箱内运行 CLI 会失败，在沙箱外运行又会移除提供方无法替代的边界。

## 条款与政策分析

Cursor 服务条款（最后更新于 2026-09-03）§1.5 限制逆向工程、反编译、推导服务源码或底层结构、复制或创作衍生作品、出租、租赁、出借或出售服务、探测或渗透服务、抓取或收集数据，以及明知而允许第三方实施上述行为。§1.1 授予有限的服务访问与使用权利，§1.2 规定 Inputs 与 Suggestions。

可接受使用政策（最后更新于 2026-08-11）还禁止 "Accessing the Service through automated or non-human means, whether through a bot, script, or otherwise"，禁止规避速率限制或限制措施、操纵订阅、计费或用量计量、抓取或转售 Input 或 Suggestions，以及使用服务开发竞争模型。

ACP 文档称 ACP "is intended for building custom clients and integrations"，headless 文档把 print 模式描述为用于 "scripts and automation workflows"，同时指出团队管理员可以禁用 CLI headless 模式，且该设置不覆盖其他非 UI 的 agent 访问方式。这些公开接口使个人、自有账户、经官方中介的集成具有合理性，AUP 中关于自动化访问的句子最好理解为针对未授权的自动化，而不是厂商自己文档化的自动化接口。但条款并未声明订阅可以支撑另一个 agent harness，而宽泛的自动化访问措辞仍给 Cursor 留出了将交付型集成或无人值守调用区别对待的空间。转售访问、共享账户、绕过限制与构建竞争服务则明确被禁止，且不能通过提供方的设计使其变得可接受。

结论是：公开接口使私人集成具有合理性，而 SDK 明确面向产品内嵌 agent 与编排器的用途，也使基于 SDK 的集成具有合理性。条款仍然限制未授权的自动化、转售、账户共享与绕过限制，且并未声明订阅可以支撑另一个 harness。就现有证据而言，这并非明确的违规；不交付模型提供方路由的理由是上文的技术不匹配，而不是法律认定。

## 考虑过的替代方案

**仅限 `ask` 与 `plan` 的只读提供方。** 这避免 Cursor 编辑文件与运行 shell 命令，且由于读取没有持久副作用，每次调用新建会话是安全的。它完全失去 DSH 工具执行能力，因此交付的是只读聊天模型而非所要求的 agent 能力，并且仍带有条款上的不确定性。

**带显式 opt-in 的 agent 能力提供方。** 默认 `ask`、通过配置开关启用 `agent`，会更接近需求。但它不能解决批准问题：CLI 自己的配置可以自动执行工具，客户端可能收不到权限请求，DSH 的沙箱与批准模式也约束不了子进程。它还会让每次调用都成为独立的远端 agent。

**使用现有 ACP subagent 包的 subagent 后端。** 将 `@deepseek-ai/dsh-subagent-acp` 配置为 `cursor-agent` 与 `acp`，语义更诚实：一次委派就是一个任务，现有后端负责进程生命周期、取消与结果折叠。它不提供模型选择，仍然在 DSH 批准之外运行 Cursor 的工具，并且需要自己的条款与安全说明。对私人配置而言，它比交付型模型路由更合适。

**官方 Cursor SDK（`@cursor/sdk`）。** SDK 用官方包替代进程启动，并提供 ACP 所缺的持久 agent、取消与 token 用量；它明确面向编排器与产品内 agent。它仍然运行 Cursor 的 agent loop 与工具，仍然无法接收 DSH 的 tool schema，并使用 Cursor API key 而不是现有 CLI 登录，因此不会把该路由变成模型推理。若重新考虑 subagent 集成，它是更好的后端，但不满足模型提供方的需求。

**直接使用 Cursor（已选择）。** `cursor-agent` 已经以交互、print 与 ACP 模式提供订阅支撑的 agent。只有当 Cursor 是会话中多个模型之一时，DSH 才会增加会话、路由与编排价值，而提供方路由无法在不承担上述成本的情况下提供这种价值。因此集成被停止，改为直接使用 Cursor，本记录保留该评估。

## 重新引入的条件

- Cursor 公布使用订阅凭据并报告用量的模型推理 API，使普通 `LlmAdapter` 无需运行 agent 就能调用它。
- 或者 ACP 提供独立于 CLI 用户配置、可强制执行的每次工具执行客户端批准，且 DSH 获得从其会话与调用标识到远端 ACP 会话的持久映射。
- 或者 Cursor SDK 暴露接受客户端工具定义的模型级调用，使 agent loop 从请求路径中移除。
- 或者把集成限定为 subagent bundle，并书面约定 Cursor 的工具执行发生在 DSH 批准之外，且 Cursor 确认预期用途被允许。

## 相关

- [Cursor ACP 文档](https://cursor.com/docs/cli/acp)
- [Cursor headless CLI 文档](https://cursor.com/docs/cli/headless)
- [Cursor 服务条款](https://cursor.com/terms-of-service)
- [Cursor 可接受使用政策](https://cursor.com/acceptable-use-policy)
- [Cursor TypeScript SDK 文档](https://cursor.com/docs/sdk/typescript)
- [ACP subagent 后端](../../../../packages/subagent/subagent-acp/README.zh.md)
- [pi-ai 提供方适配器](../../../../packages/llm/llm-pi-ai/README.zh.md)
