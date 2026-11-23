---
description: "tui 组地图：在单个实时 Agent 之上的交互式终端入口，供浏览该组的用户与维护者使用。"
kind: "package-group"
---

# packages/tui

[English](README.md) | 中文

## Summary

tui 组为 DeepSeek Harness 提供终端入口：把单个实时 Agent 渲染为一段对话，包含流式回复、工具卡片、待办计划、审批、模型提问、斜杠命令与恢复。它提供界面插件及其命令行提供器；随附的 `tui` 配置文件通过 [`dsh-tui-app`](../bundle/tui-app/README.zh.md) 挂载二者。本组只拥有呈现与终端生命周期——agent 循环、工具、持久化、审批与命令仍属于各自的包。

## Table of Contents

- [包](#packages)
- [相关文档](#related-documentation)
- [开发者说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`tui`](tui/README.zh.md) | 在单个 Agent 之上的交互式终端界面：对话记录、编辑器、审批、提问、命令、恢复 | `tuiStartup`（提供器） |

-----

<a id="related-documentation"></a>
## 相关文档

- [`dsh-tui-app`](../bundle/tui-app/README.zh.md)——随附的 `tui` 配置文件层。
- [`dsh-user-approval`](../interaction/user-approval/README.zh.md)——界面应答的 `approval/request` 瀑布。
- [`dsh-user-questions`](../interaction/user-questions/README.zh.md)——界面应答的 `user-questions/request` 瀑布。
- [`dsh-commands`](../interaction/commands/README.zh.md)——界面分发的人类命令注册表。
- [应用启动](../../docs/architecture.zh.md#application-launch)——为什么每个界面都通过 `dsh` 配置文件启动。

-----

<a id="dev-note"></a>
## 开发者说明

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

None.

</details>
