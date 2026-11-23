---
description: "Auto 权限模式：每次原生或 PTC 内层工具调用执行前都由同一模型审查，且不使用文件沙箱。"
kind: "package-reference"
---

# @deepseek-ai/dsh-auto-review

[English](README.md) | 中文

## 概述

Auto 模式让智能体在不使用文件沙箱、也不由人逐次确认的情况下工作：每次原生或 PTC 内层工具调用执行前，都由同一模型审查是否允许。允许的调用立即执行；在 `ask` 审批策略下，拒绝会询问你，在 `never` 策略下则为最终决定。可从 Web 权限选择器选择 Auto，在终端按 Shift+Tab，或使用 `--permission-mode auto`。审查会为每次受支持的调用增加一次模型请求，可能错误地允许或拒绝操作，且不覆盖外层 `run_code` 传输或 PTC 程序中的直接 Node 效果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh-base` 捆绑层挂载了这一行，因此 Web、终端和无界面 profile 无需额外安装即可使用 Auto。

<a id="selecting-auto"></a>
### 选择 Auto

Auto 是一个在运行时贡献的权限预设。在 Web GUI 中，新会话以 Auto 启动，输入区权限菜单或 `/permission auto` 可切换当前会话。在终端运行 `dsh tui`，按 Shift+Tab 直到状态行显示 `auto (reviewed)`，或传入 `--permission-mode auto`。无界面运行接受同一预设，并以固定策略接受监督：

```sh
dsh headless --permission-mode auto --approval-policy never --json - < task.txt > run.jsonl
```

Web 选择器、通用设置的权限行和 Shift+Tab 会先要求确认风险；显式输入 `/permission auto` 则直接切换。shipped 的 Web 与 TUI bundle 以 Auto 启动新会话；headless、SDK 与 ACP 保持工作区内修改默认值。移除本行的组合不能把 `defaultPreset` 留为 Auto。

### 组合

```yaml
- id: auto-review
  name: '@deepseek-ai/dsh-auto-review'
```

该行需要审批、权限预设、LLM、Session、工具和工作目录服务。移除该行的组合不再提供 `auto` 预设；已持久化的 Auto Session 在重新打开时会失败，直到该行恢复。

### 你会得到什么

Auto 在每次受支持调用的主体执行前审查一次，包括每个已启动的 PTC `tools.*` 内层调用。它按实际效果分类：普通的项目内工作，以及对本 Session 中创建对象的精确清理属于低风险并直接允许；不可逆删除既有对象、生产操作、外部写入和安全变更属于中风险，需要当前用户或直接父级对操作、目标和范围的明确授权。跨信任边界的敏感信息外泄属于高风险，始终拒绝。效果不明确或授权冲突未解决时拒绝。选择 Auto 会设置 `ask` 审批策略，因此被拒绝的调用会询问用户，只有在批准后才执行；被拒绝或取消的审批不会执行主体。委托的进程内子级会固定 `never` 策略，因此其拒绝为最终决定。格式错误的审查响应和技术故障会让调用以各自的错误失败，且从不执行主体。

最终拒绝使用普通工具卡片。折叠行标识为 Auto review；展开输出说明主体未执行，并显示可选原因。[Web 权限包](../../client/ui-permission-presets/README.zh.md)负责选择器交互，[工具 UI](../../client/ui-tool/README.zh.md)负责显示原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：预设贡献、执行前审查门和生命周期。 |
| [`src/locales.ts`](src/locales.ts) | 审查拒绝时由 locale 拥有的审批提示文本。 |
| [`tests/auto-review.spec.ts`](tests/auto-review.spec.ts) | 门、快照组装和生命周期的单元行为。 |

### 审查路径

[`src/index.ts`](src/index.ts) 要求审批、LLM、权限、Session 和工具服务，然后在同一个 effect 中安装预设贡献与前置执行监听器。审查结束后，拒绝会读取 Session 的审批策略：在 `never` 下为最终决定；在 `ask` 下，监听器委托给后续执行前监听器，仅当它们允许调用时才返回工具管线的 `ask` 决策，因此后续的拒绝、取消或 `ask`（带自己的原因）优先。`ask` 决策携带英文审计原因，以及来自 `src/locales.ts`、由 locale 拥有的英文、中文和日文提示文本，并保留审查者的原始原因。[权限所有者](../../interaction/permission-presets/README.zh.md)提供当前身份和进程目录；Auto 使用完全权限的沙箱值并配合 `ask` 审批策略，且不改变工具定义。

审查者把固定策略作为系统提示词，随后是一条仅含 cwd 环境的用户消息、按界面顺序保留的每个 Session 项，以及最后的待决调用。项目指令出现在它们进入界面的位置，并带 constraint 角色。`tool-schema` 项出现在首个使用对应被审查模式的调用之前；该 integration 为实时 Session 记住每次被审查调用的模式，使后续审查在同一位置重复它。原生模式来自最新的请求头。PTC 绑定会冻结其模式，并通过调度器携带到瞬态执行元数据中；启动和结算事件从不序列化描述或参数。主智能体的 `system/message` 节点、助手文本和推理以及工具结果被排除。外层审查输入是不带持久身份或来源的冻结 `RequestUserInput`；保留的历史在审查文本中保留原始来源归属。[决策记录](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.zh.md)负责权威、生命周期和子级继承的理由。

卸载会关闭选择与审查准入。如果应用根仍处于活动状态，卸载会把实时 Auto Session 通过既有预设写入器迁移到完全权限；插件移除和重载都属于此路径。迁移写入 `never` 审批策略，但不排队策略变更通知；模型会在下一次运行时上下文快照中看到新策略。沙箱值和持久终端在迁移后保留。应用关闭会保留所选预设和审批策略。两条路径都会中止并排空审查，然后撤回监听器和贡献。没有完整 integration 时，已持久化的 Auto Session 无法发布，即使重新打开请求选择了其他预设。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Base 捆绑层](../../bundle/base/README.zh.md)——挂载此行的共享组合。
- [权限预设](../../interaction/permission-presets/README.zh.md)——身份、捆绑与当前会话目录。
- [审批](../../interaction/user-approval/README.zh.md)——`ask` 与 `never` 策略及其审计事件。
- [工具](../../core/tools/README.zh.md)——执行、取消与 PTC 结果传播。
- [Auto review 决策记录](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.zh.md)——固定风险策略、权威与生命周期。

-----

<a id="model-experience"></a>
## 模型体验

### 逐调用审查者

#### 模型看到什么

审查者使用最新 `request/header.config` 的 provider 和模型，以及随包适配器的默认推理。其固定的 `REVIEW_POLICY` 恰好替代一次操作的人工审批：允许会立即以完全权限执行。用户消息只包含上文所述的保留事实。它返回一个严格 JSON 文本对象，含 `risk` 和 `decision`；拒绝可以带字符串 `reason`。推理块可以出现在该单个文本块之前。只有 `low + allow`、`medium + allow/deny` 和 `high + deny` 有效。

#### Token 影响

每次受支持的调用增加一次模型请求，没有缓存、重试、截断、压缩或单独的小输出预算。超大的请求会让调用以 provider 错误失败。

#### KV 缓存影响

每次审查的消息以上一次审查的全部消息开头（包括其待决调用），因此按提示词前缀、消息末尾或带回看的结束标记缓存的路径会复用策略和更早历史。压缩、cwd 变更、较早项离开界面，以及重启后的第一次审查各会结束一次该复用。Auto 不为主智能体增加专用运行时上下文或模式切换提示。每个审查请求都把被审查 Session 的 `sessionId` 和 `purpose: 'auto-review'` 作为模型不可见的传输元数据携带。按 Session 缓存提示词或路由请求的路径（例如 OpenAI `prompt_cache_key`，以及 OpenCode 要求的 `x-opencode-session` 头）会在该 Session 的键下发送审查；[DeepSeek Session 日志上传](../../session/session-log-deepseek/README.zh.md#request-field)在启用且没有匹配的已注册排除项时提供规范 Session 日志。

### 工具拒绝

#### 模型看到什么

在 `ask` 审批策略下，模型只看到审批结果，例如 `the user rejected tool "<name>"`，或已批准调用的普通结果。最终拒绝消息为 `Auto review rejected tool "<name>"; its body was not executed`。审查失败消息为 `Auto review of tool "<name>" failed; its body was not executed: <error>`。普通原生错误呈现会在每条消息前加 `Error: `。PTC 使用既有的内层调用异常和捕获行为；被捕获的拒绝不会强制外层 `run_code` 失败。原始可选原因是面向用户的持久结构化错误详情，绝不进入主模型内容。风险、审查提示词、推理和原始响应都不持久化。

#### Token 影响

被拒绝或失败的调用只把普通错误结果贡献给主对话。

#### KV 缓存影响

拒绝会追加普通工具结果；它不重写更早的上下文，也不隐藏已有的模型可见信息。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Auto 不提供文件沙箱。外层 `run_code` 传输以及 PTC 程序中的直接 Node 效果不经过内层工具审查。
- 模型分类可能出错。没有确定性工具豁免、持久授权、可配置策略或重试层。
- 每次受支持的调用增加一次审查请求，使用当前智能体的路由和 token 预算；该模式不增加单独的小模型或支出上限。
- 进程内 Auto 子级会审查自己的调用。进程外子级在父级委托调用被允许后仍保留其原生权限系统。
- 在应用根保持活动时卸载 integration，会把实时 Auto Session 迁移到完全权限。没有该 integration 时，已持久化的 Auto Session 无法发布，即使只是切换预设。
- Mods 可以提交 user-sourced 文本。[Claude Code mods 桥接](../../experimental/claude-code-mods/README.zh.md#model-experience)赋予 `$.prompt.submit` 和 `prompt.submit` 两个 hook 上下文的用户权威，包括没有 `asUser: true` 的加框提交；文本加框不会降低该权威。
- 审查者通过已弃用的同步 `snapshotEvents()` 读取器在行级豁免下读取 Session 操作历史。更早的调用、PTC 启动和直接父级的初始提示词尚无投影或分页读取器，因此迁移仍按[同步读取决策](../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.zh.md)延期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

无。

</details>
