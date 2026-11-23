---
description: "在单个实时 Agent 之上的交互式终端入口：对话记录渲染、编辑器输入、审批、提问、斜杠命令、恢复会话与终端清理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tui

[English](README.md) | 中文

## 概述

用本包在终端中交互地运行一个 Agent。它把 Session 渲染为一段对话：流式助手文本与推理、每次工具调用一张卡片、待办计划、审批与提问面板、状态行，以及一个排队新回合或对运行中回合做引导的编辑器。[`dsh-tui-app`](../../bundle/tui-app/README.zh.md) 把它组装为 `tui` 配置文件。本包只拥有呈现与终端生命周期；agent 循环、持久化、审批、提问与命令仍由各自所属的包负责。启动时会拒绝非交互式 stdin 或 stdout。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过配置文件中的行来挂载它；随附的 `dsh --profile tui` 组装先挂载 `@deepseek-ai/dsh-tui/startup`，再挂载本插件。自定义配置文件可以采用同样的写法：

```yaml
- id: tui-startup
  name: '@deepseek-ai/dsh-tui/startup'

- id: tui
  name: '@deepseek-ai/dsh-tui'
  inject: [tuiStartup]
  config:
    resume: !!js ctx.tuiStartup.resume
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sessionId` | 新的 `session-<uuid>` | 要打开的精确 Session 标识。 |
| `resume` | — | 要恢复的已持久化 Session 标识，取代新建。 |
| `prompt` | — | 界面就绪后提交的首个提示词。 |
| `permissionMode` | 基础默认值 | 在首个提示词前应用的权限预设。 |
| `approvalPolicy` | 基础默认值 | 在首个提示词前应用的审批行为。 |
| `welcome` | — | Session 尚无标题时显示的额外横幅行。 |
| `showReasoning` | `true` | 渲染推理块。 |
| `maxToolOutputLines` | `6` | 折叠工具卡中保留的输出行数。 |
| `color` | `true` | 应用内置 ANSI 调色板。 |
| `title` | `DeepSeek Harness` | 终端窗口标题的产品后缀。 |
| `shutdownTimeoutMs` | `10000` | 退出时等待取消与会话释放的最长时间。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tui)是全部可接受字段的完整来源。

### 按键与命令

Enter 提交编辑器。Agent 运行时，普通提交调用 `agent.steer()` 并加入最近的步骤；空闲时调用 `agent.followup()` 并开启一个回合。Ctrl+C 取消运行中的回合；空闲时连按两次退出。Ctrl+D 退出，Ctrl+L 在外部输出弄脏屏幕后重绘。Shift+Tab 循环切换可用的权限预设；进入完全权限或 Auto 前会先要求确认，Auto 会在状态行标记 `auto (reviewed)`。

`/help`、`/status`、`/model`、`/resume`、`/clear`、`/redraw` 与 `/exit` 是本地命令。其他插件在 `ctx.commands` 上注册的每条命令都经由同一接口执行，其结果作为模型历史之外的提示呈现。不带参数的 `/resume` 列出最近的已持久化 Session；`/resume <id>` 在本进程中恢复其中一个。`/model <provider>/<model>` 为后续步骤选择路由。随发行版交付的 `permission-presets` 命令切换沙箱与审批设置的组合：`/permission` 列出预设，`/permission <preset>` 切换到其中一个。

### 验证

在仓库根目录、包构建完成后：

```sh
pnpm dsh --profile tui --help     # prints the app help and exits without opening the terminal
pnpm dsh --profile tui            # opens the surface in an interactive terminal
```

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：解析调用、创建或恢复 Agent，并把界面启动推迟到 `appReady`。 |
| [`src/startup.ts`](src/startup.ts) | 发布 `tuiStartup` 的 Commander 提供器。 |
| [`src/app.ts`](src/app.ts) | `TuiApp`：组件树、事件接线、提交/取消/退出、`/resume` 切换。 |
| [`src/transcript.ts`](src/transcript.ts) | 把持久事件与实时帧投影为对话记录块。 |
| [`src/components.ts`](src/components.ts) | pi-tui 组件：角色标题、回复、工具卡、提示、计划、状态。 |
| [`src/interactions.ts`](src/interactions.ts) | 审批与用户提问瀑布的终端应答器。 |
| [`src/commands.ts`](src/commands.ts) | 本地斜杠命令与 `ctx.commands` 分发。 |
| [`src/theme.ts`](src/theme.ts) | 调色板、Markdown 主题与控制字符转义。 |

### 启动

插件在组件树挂载期间不启动终端。它注册一个 `appReady` 监听器，因此 `dsh --profile tui --help`（在启动行解析期间就请求退出）绝不会占用终端，别处的启动失败也不会把屏幕留在 raw 模式。就绪后，它等待 Loader，通过 `ctx.fs` 解析工作目录，用 `ctx.sessionQuery` 校验 `--resume` 标识，创建或恢复 Agent，应用请求的权限预设与审批策略，然后启动渲染器。

### 渲染

渲染器是 `@earendil-works/pi-tui` 的主屏 TUI，因此对话与终端自身的滚动缓冲共享同一份文档，`stop()` 会先打印最终文档再恢复光标。持久事实来自 `session/event`，经回放与实时步骤共用的同一投影函数处理；实时令牌来自 `agent/assistant-stream`。一次结算会复用其回合与步骤的实时块，而不是追加第二块。工具卡通过 `ctx.tools.get(name)` 询问工具自身的 `presentCall`/`presentResult` 视图，工具未声明或呈现器抛错时回退到通用卡片。不可信文本在进入 ANSI 感知渲染器之前先被转义。

### 交互与清理

一个 `approval/request` 监听器和一个 `user-questions/request` 监听器分别应答两条人类交互瀑布。请求通过单一面板串行处理，面板从编辑器取得键盘焦点，并在答案结算后归还；信号中止的请求放弃其答案。退出会取消运行中的回合、刷新 Session、释放 Agent 句柄、停止渲染器，并请求有界进程退出。组件树卸载（启动器关闭、同层致命失败）只停止渲染器，不重入退出路径。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-tui-app`](../../bundle/tui-app/README.zh.md)——随附的 `tui` 配置文件层。
- [`dsh-user-approval`](../../interaction/user-approval/README.zh.md)——审批结果与失败关闭行为。
- [`dsh-user-questions`](../../interaction/user-questions/README.zh.md)——提问与答案类型。
- [`dsh-commands`](../../interaction/commands/README.zh.md)——人类命令接缝。
- [`dsh-tools`](../../core/tools/README.zh.md)——`presentCall` 与 `presentResult`。

<a id="model-experience"></a>
## 模型体验

### 编辑器输入

#### 模型看到什么

每次非空提交成为一个用户消息中的文本块。空闲时以 `agent.followup()` 投递；Agent 运行时以 `agent.steer()` 投递并加入最近的步骤。提交的斜杠命令对 `ctx.commands` 执行，不是模型消息；只有命令自身安排了 agent 工作时才会到达模型。

#### Token 影响

提交的文本按 agent 循环常规的历史与压缩规则保留。角色标题、卡片、计划、状态行与提示不增加 token。

#### KV 缓存影响

仅追加；新可见内容遵循可复用的请求前缀。命令结果位于模型历史之外。

### 审批与提问

#### 模型看到什么

审批以 `allowed-once`、`rejected` 或 `cancelled` 结算，调用工具报告该结果。提问答案按每个问题返回一项，包含所选选项标签与可选的自定义文本。取消与失败作为调用工具的错误结果到达模型。

#### Token 影响

面板不增加 token；只有调用工具的结果照常进入历史。

#### KV 缓存影响

仅追加。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **每进程一个 Session。** 界面驱动其配置行打开的 Agent；`/resume` 会替换该 Agent 并重放其日志，但无法同时展示两个 Session。
- **恢复要求当前工作目录。** 记录在其他目录中的已持久化 Session 会被拒绝，而不是在那里运行，因为文件系统与 shell 工具解析的是进程 cwd，而非恢复的表头。它同样拒绝在 agent preset 下创建的 Session，因为本组装不挂载 preset。
- **配置不会热重载。** `tui` bundle 禁用了 `dsh-hmr`；重载会在对话进行中替换 Agent 与渲染器，因此请重启以应用配置变更。
- **卡片仅文本。** 尚未实现内联图片、鼠标文本选择与逐卡展开状态；这些需求由终端自身的选择与滚动缓冲承担。
- **无需 PTY，但也没有非 TTY 回退。** 自动化请改用 `dsh --profile headless`。

### 开发备注

<a id="dev-note"></a>

交互瀑布与 `ctx.agents` 就是全部约定；不挂载 Host、HTTP 或浏览器插件。测试通过终端替身驱动真实的审批与提问服务，启动提供器则在真实的 Loader 组件树上运行。
