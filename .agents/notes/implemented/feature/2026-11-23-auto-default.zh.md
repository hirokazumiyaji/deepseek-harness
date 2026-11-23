# Agent Note: 以 Auto 作为 Web 与 TUI 的新会话默认值

Status: implemented

[English](2026-11-23-auto-default.md) | 中文

## 问题

[作为产品权限模式的 Auto 模式](2026-11-21-auto-mode-product.zh.md)让每个基于 base 的 profile 都能使用受审查的 `auto` 预设，但新会话仍以 `workspace-write` 启动。希望使用受审查模式的人必须在每个新的 Web 会话中选择 Auto，或在终端按 Shift+Tab。对交互界面而言，产品并没有以它宣传的模式启动；而直接修改 base 默认值又会让无人值守的 `headless`、`sdk` 与 `acp` 会话为每次工具调用消耗一次审查请求，并在被拒绝时询问一个并不存在的人。

## 决定

`web-app` 与 `tui-app` bundle 用同一张预设表加上 `defaultPreset: auto` 替换 base 的 `permission` 行；补丁会替换整行配置，因此两个 bundle 都重述该表。`dsh-base` 保持 `workspace-write`，`headless`、`sdk` 与 `acp` bundle 不作覆盖。[权限服务](../../../../packages/interaction/permission-presets/README.zh.md)接受 `auto` 作为已配置默认值，但不在构造期间解析它，因为 Auto review integration 会注入该服务并在此后注册。第一个解析该默认值的会话会验证 integration 存活，而新的 Auto 会话会在写入 `permission/preset`、`sandbox/mode` 与 `approval/policy` 之前运行 integration 的准入检查。

进程目录的 `defaultOptions` 现在包含存活的 Auto，因此 Web 通用设置行通过普通设置写入路径提供 **Auto** 作为未来会话默认值，并使用与选择器相同的风险确认。在设置中选择其他预设会把默认值改回，而不会触碰现有会话。移除了 `auto-review` 而默认值仍指向 Auto 的组合会让新会话创建失败，错误为 `permission: default preset "auto" requires the live Auto review integration`；服务不会静默回退。现有会话保留其日志中记录的权限。

## 考虑过的替代方案

**把 base 默认值改为 Auto。** 否决：每个基于 base 的 profile 都包含 `headless`、`sdk` 与 `acp`；在那些界面中，每次工具调用一次审查请求会提高无人值守成本，而 `ask` 拒绝没有人可以回答。这个产品选择属于交互界面。

**只把默认值留在用户设置中。** 否决：全新的 Web 或 TUI 安装仍会以宣传之外的模式启动，而 TUI profile 根本没有设置界面。

**integration 缺失时回退到 `workspace-write`。** 否决：静默改变请求的默认值会掩盖组合错误，并让同一配置在不同启动时表现不同。

**增加独立的 Auto 开关。** 否决：权限选择器本身就是开关，它会按会话持久化选择，设置行则提供默认值。第二个控件会重复同一份状态。

## 影响

新的 Web 与 TUI 会话没有文件沙箱运行，使用 `ask` 审批策略，并为每次受审查的工具调用或 PTC 内层调用消耗一次审查模型请求。用户可以随时把会话切回，Web 设置行可以修改默认值。录制的 Web e2e fixture 仍使用 `workspace-write`，因为它们的模型脚本与审批场景是在该模式下编写的；一个专门的场景启动 shipped 的 Auto 默认值。headless 监督仍使用文档化的显式 `--permission-mode auto --approval-policy never` 路径。

## 测试

[`packages/interaction/permission-presets/tests/permission-presets.spec.ts`](../../../../packages/interaction/permission-presets/tests/permission-presets.spec.ts)覆盖延迟解析的 Auto 默认值、准入、设置写入、撤回以及 integration 缺失时的失败。[`apps/cli/tests/profile-permission-defaults.spec.ts`](../../../../apps/cli/tests/profile-permission-defaults.spec.ts)固定 Web 与 TUI 的 Auto 默认值以及自动化组合不变的 base 默认值。[`packages/client/ui-permission-presets/tests`](../../../../packages/client/ui-permission-presets/tests)覆盖设置行中的 Auto 选项标签、风险门禁与目录撤回。[`apps/web/tests/auto-default.e2e.ts`](../../../../apps/web/tests/auto-default.e2e.ts)启动 shipped 的 Web 组合并检查输入区芯片与设置行。[`apps/web/tests/shipped-composition.e2e.ts`](../../../../apps/web/tests/shipped-composition.e2e.ts)断言实际生效的默认值；录制的 replay lane 通过 scaffold 固定为 `workspace-write`，TUI 录制会话快照在其场景补丁中同样固定该值，使已提交的 fixture 保持可比。
