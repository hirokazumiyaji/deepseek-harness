---
kind: upgrade-guide
description: "新的 Web 与 TUI 会话以 Auto 启动，而不是工作区内修改；headless、SDK 与 ACP 保持原有默认值。"
---

# 新的 Web 与 TUI 会话以 Auto 启动

[English](guide.md) | 中文

## 变更

`web` 与 `tui` 配置现在会为每个新会话固定 `permission/preset: auto`：会话没有文件沙箱运行，审批策略为 `ask`，同一模型会在每次原生工具调用和 PTC 内层调用执行前审查。通用设置的权限行现在允许把 Auto 选为新会话默认值。已有会话保留其日志中记录的权限。`headless`、`sdk` 与 `acp` 配置继续使用原来的工作区内修改默认值，不覆盖 base 行的组合也是如此。Auto 会为每次被审查的调用增加一次审查模型请求。

## 迁移

1. 要让新的 Web 会话继续使用工作区内修改，打开 设置 → 通用设置 → 权限 并选择工作区内修改。写入会保存在该配置的 `cordis.patch.yml` 中，即 `id: permission` 与 `defaultPreset: workspace-write`。
2. 要让新的 TUI 会话继续使用工作区内修改，使用 `dsh tui --permission-mode workspace-write` 启动，或添加一个配置补丁，把 `permission` 行的 `defaultPreset` 设为 `workspace-write` 并重述 base 的 `presets` 表。
3. 禁用了 `auto-review` 行的组合必须把 `defaultPreset` 设为已配置的预设。否则第一个新会话会以 `permission: default preset "auto" requires the live Auto review integration` 失败。
4. 启动一个新会话，确认输入区的权限控件显示 Auto；TUI 状态行显示 `auto (reviewed)`。选择工作区内修改，确认可以随时把该会话切回。
