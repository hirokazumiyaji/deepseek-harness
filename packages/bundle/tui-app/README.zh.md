---
description: "tui 配置文件 bundle 为 dsh 增加的内容：在 dsh-base 之上的交互式终端界面行，供组装或定制配置文件的用户使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

[English](README.md) | 中文

## 概述

本 bundle 层把以 base 为基础的配置文件变为交互式终端界面。它挂载 `@deepseek-ai/dsh-tui` 渲染器及其命令行提供器，加入面向模型的 `ask_user_question` 工具，固定工作区沙箱策略，并禁用配置热重载。随附的 `tui` 配置文件就是 `dsh-base` 加上本层，因此 `dsh tui` 会在终端中打开对话，而不需要 Host、HTTP 服务器或浏览器。通过 `dsh plugin` 在自定义配置文件中增删本层；`dsh tui --help` 打印应用帮助并退出，不占用终端。

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

随附的配置文件在首次使用时自动初始化：

```sh
dsh tui                                   # open a new session in this directory
dsh tui "explain this repository"         # open with a first prompt
dsh tui --resume session-…                # continue a persisted session
dsh --profile tui --permission-mode read-only
```

`dsh --profile tui --help` 打印终端应用自身的参数说明并以 0 退出，不会打开它。用以下方式把本层加入自定义配置文件：

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-tui-app
dsh plugin --profile <name> remove @deepseek-ai/dsh-tui-app
```

本层从自身启动行发布的 `tuiStartup` 提供器读取选项；界面行注入该服务，因此其配置只在解析成功后解析。配置文件可按 id 覆盖任意行，包括把 `prompt` 替换为固定值。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

### 层顺序

`cordis.patch.yml` 作为一份补丁文档应用在 `dsh-base` 之上：

1. 重新声明系统人设。
2. 插入 `tui-startup`（`@deepseek-ai/dsh-tui/startup`）、界面行 `tui`（`@deepseek-ai/dsh-tui`，`inject: [tuiStartup]`）与 `tool-ask-user` 行。
3. 用命令行授予替换 `sandbox-policy` 配置（`mode`、`workspaceRoot: process.cwd()`、`additionalWritableRoots`）。
4. 禁用 `hmr`。

Base 保留 agent 平面——工具、提示词分节与委派后端——因为本界面是单会话并把其 Agent 组装在进程级，所以该行不需要 agent preset。

### 入口 id

`tui` 行 id 被列入启动器的必需应用入口：启用时它必须激活，因此缺失运行时依赖会使启动失败，而不是留下一个空闲进程。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-tui`](../../tui/tui/README.zh.md)——本层挂载的终端界面。
- [`dsh-base`](../base/README.zh.md)——其下的共享层。
- [`dsh-headless`](../headless/README.zh.md)——非交互的一次性替代方案。
- [`apps/cli` README](../../../apps/cli/README.zh.md)——面向用户的 CLI 指南。

<a id="model-experience"></a>
## 模型体验

### 终端界面组装

#### 模型看到什么

本层的人设前缀与全部基础工具。它加入 `ask_user_question`，使模型可以向终端前的人请求决策；基础 `exit_plan_mode`、todo、goal 与压缩工具仍然可用。

#### Token 影响

人设与工具 schema 是普通的系统提示词与工具声明；除基础组装与 ask-user 工具 schema 之外，本层不增加 token。

#### KV 缓存影响

组装后的前缀在配置文件生命周期内保持稳定，因此请求复用同一缓存域，直到工具或提示词分节变化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **没有 Host、HTTP 或浏览器行。** 终端使用无法服务 Web GUI、ACP 或 SDK 客户端；需要其他界面时请改为组装那些 bundle。
- **没有 agent preset。** 基础 agent 平面应用于本配置文件驱动的单个 Agent，因此在 preset 下创建的已持久化 Session 在恢复时会被拒绝。
- **配置热重载关闭。** 该组装在进程生命周期内固定其 Agent 与渲染器。

### 开发备注

<a id="dev-note"></a>

本包没有运行时 API：其实质是补丁文档，通过 `dsh.bundle.patch` 声明。
