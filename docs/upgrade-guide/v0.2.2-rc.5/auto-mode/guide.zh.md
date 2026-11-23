---
kind: upgrade-guide
description: "实验性的 Auto review profile 层已成为随发行版交付的 Auto 权限模式：包名改为 @deepseek-ai/dsh-auto-review，并由 dsh-base 挂载。"
---

# Auto 模式取代实验性 Auto review 层

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-experimental-auto-review` 曾是可选 profile 层，用户须先把它安装到 Web 或无界面 profile，`auto` 权限预设才存在。现在它是 `@deepseek-ai/dsh-auto-review`，一个由 `dsh-base` 挂载的产品包，因此每个基于 base 的 profile——`web`、`headless`、`tui`、`sdk` 与 `acp`——无需安装任何层即可提供 `auto` 预设。Web 选择器和终端状态行把该模式称为 **Auto**；旧的 `EXP` 徽标和实验性措辞已移除，切换前的风险确认仍然保留。

仍列出旧捆绑包名称的 profile 会在下次启动时被修复：app-boot 从存储的捆绑包列表中移除该已退役条目，并重写 profile 清单。以行形式插入旧包名的 profile patch 无法解析，因为该名称下已不存在这个包。

## 迁移

1. 用受影响的 profile 启动一次 `dsh`。app-boot 会从 profile 的捆绑包列表中移除 `@deepseek-ai/dsh-experimental-auto-review`，并重写其 `package.json`。
2. 如果 profile 或 patch 以行形式插入 `@deepseek-ai/dsh-experimental-auto-review`，请删除该行或 patch 层。`dsh-base` 已经以 `auto-review` 挂载替代包；第二行会导致解析失败。只为测试添加审查脚本的 overlay 可以保留。
3. 如果脚本用 `--patch` 指向已退役包的 `cordis.patch.yml`，请去掉该参数。预设及其审查门已内置。
4. 如果旧包曾作为 profile 依赖安装，请在第 1 步重写捆绑包列表后移除这个已无法解析的依赖。确认 profile 的 `package.json` 不再列出 `dsh-experimental-auto-review` 条目。
5. 无界面监督无需安装：`dsh headless --permission-mode auto --approval-policy never --json - < task.txt > run.jsonl`。
6. 确认模式：打开 Web 权限选择器或终端的 Shift+Tab 循环，确认出现 **Auto**；然后选择它，确认下一次工具调用只在审查者拒绝时才进入审批面板。记录为 `permission/preset:auto` 的已持久化 Session 在基于 base 的 profile 中原样重新打开。
