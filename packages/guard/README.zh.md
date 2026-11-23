---
description: "guard 家族的包映射：模型审查的 Auto 权限模式、建议性重复工具提醒、单次工具调用超时策略与推送确认守卫，供选择或组合 guard 的用户与维护者阅读。"
kind: "package-group"
---

# guard/：工具调用 guard 家族

[English](README.md) | 中文

## 概述

`guard/` 组让 agent loop（智能体循环）保持高效，并让工具调用获得授权。`auto-review` 运行 `auto` 权限模式：由同一模型在每次受支持的调用执行前审查。`repeat-tool-reminder` 在重复完全相同的调用时提醒模型改变方法。`timeout-policy` 为声明了限时的调用设置上限，`git-push-guard` 在执行 `git push` 前向你确认。除推送守卫外，其余都随 base 组合包交付。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

四个小插件分别覆盖这些行为；下文每个 README 都说明何时保留、调优或移除它。

| 包 | 提供什么 |
|---|---|
| [`auto-review/`](auto-review/README.zh.md) | 运行 `auto` 权限模式：由同一模型审查替代审批提示，拒绝时仍会询问用户 |
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.zh.md) | 在模型重复完全相同的工具调用时提醒它，使其改变方法或结束任务 |
| [`timeout-policy/`](timeout-policy/README.zh.md) | 为声明了限时的工具调用设置超时，让模型得到清晰错误而不是无限等待 |
| [`git-push-guard/`](git-push-guard/README.zh.md) | 在智能体执行 `git push` 前向用户确认，为新会话提供默认值，并为每个会话提供开关 |

-----

<a id="related-documentation"></a>
## 相关文档

先从工具子系统参考了解工具调用流水线，再看推送守卫的决策记录、重复提醒的配置与策略背后的超时库决策。

- [工具子系统参考](../../docs/subsystems/tools.zh.md)——各 guard 都依赖的工具调用流水线与决策。
- [生成配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-repeat-tool-reminder)——重复调用提醒的每个受支持字段。
- [推送守卫 Agent Note](../../.agents/notes/implemented/feature/2026-10-26-git-push-guard.zh.md)——守卫为何确认推送，以及它看不到什么。
- [超时截止时间库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.zh.md)——`timeout-policy` 所执行的时序／终止拆分。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
