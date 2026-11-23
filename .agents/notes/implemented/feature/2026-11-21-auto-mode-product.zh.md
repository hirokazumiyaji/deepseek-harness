# Agent Note: Auto mode as a product permission mode

Status: implemented

[English](2026-11-21-auto-mode-product.md) | 中文

## Problem

[逐工具 Auto review](2026-08-28-auto-review.zh.md)曾作为实验性、需显式安装的 profile 层交付。默认 Web 保持三种权限模式，终端界面完全没有受审查模式，无界面监督也必须先安装该层，`--permission-mode auto` 才能工作。想要 Claude Code 式 auto mode 的人——操作不再提示，由模型审查每次调用，被拒绝时仍会询问——没有受支持的选择方式。

## Decision

[`@deepseek-ai/dsh-auto-review`](../../../../packages/guard/auto-review/README.zh.md)是 `packages/guard/` 下的产品包，以该名称发布，而不再使用实验性前缀。`dsh-base` 以 `auto-review` 行挂载它，因此每个基于 base 的 profile——`web`、`headless`、`tui`、`sdk` 与 `acp`——都会发布 `auto` 预设。正式化时，选择仍按 Session 显式进行，默认预设仍为 `workspace-write`；[之后的默认值变更](2026-11-23-auto-default.zh.md)让新的 Web 与 TUI 会话以 Auto 启动，并让自动化 profile 保持 `workspace-write`。

Web 权限选择器把该预设标为 **Auto**，不带实验徽标，并保留风险确认。终端界面增加 Shift+Tab 模式循环：它遍历 `permissionPresets.names`，在进入任何解析后沙箱为 `danger-full-access` 的预设前，通过普通决策面板询问；通过已注册的 `/permission` 命令应用选择，使审批策略切换被叙述给模型；Auto 生效时在状态行标记 `auto (reviewed)`。显式输入 `/permission auto` 在两个界面仍是直接切换。

旧 npm 名称已退役：app-boot 会从存储的 profile 捆绑包列表中移除 `@deepseek-ai/dsh-experimental-auto-review`，[升级指南](../../../../docs/upgrade-guide/v0.2.2-rc.5/auto-mode/guide.zh.md)说明迁移方式。审查策略、风险分类、拒绝身份、PTC 排除项、子级继承与卸载迁移均未改变；本次正式化只改变包角色、默认可用性与界面呈现。

## Alternatives considered

**保留实验层，只在 Web 与终端捆绑包中挂载。** 否决：release 捆绑包不得依赖实验包，headless 与 ACP 组合仍会缺少该模式，而且插件管理器的安装/卸载流程会成为切换权限模式的支持路径。

**增加无分类器的自动许可模式。** 否决：Claude Code 的 auto mode 把审查委托给模型，而无条件许可就是已有的 `danger-full-access` 预设换个名字。它会移除逐调用审查者拥有的拒绝与审计行为。

**按界面分别挂载，而不是放入 base。** 否决：该能力与界面无关，base 已经拥有审批与权限行。按界面挂载会让随发行版交付的 profile 在可用权限模式上产生分歧。

**保留 Auto review 标签与实验徽标。** 否决：该模式现在是受支持的产品能力，用户会按他们所用其他工具的术语搜索。机制名称仍保留在拒绝文本与文档中，用来说明审查步骤而不是模式。

## Consequences

该模式无需安装即可使用，Web、终端和无界面界面以同一方式选择它。正式化放弃了实验性隔离保证：包必须满足产品文档、发布载荷与具名所有者义务，每个发布族现在都会发布它。禁用 base 行的 profile 会失去该预设，而已持久化的 Auto Session 在该行恢复前无法重新打开。

终端循环只在确认后扩大访问，已挂载的决策面板会为自己保留 Shift+Tab 的行导航。审查者仍会为每次受支持的调用消耗一次模型请求，可能错误地允许或拒绝操作，并使外层 `run_code` 传输以及 PTC 程序中的直接 Node 效果处于审查之外。

## Testing

[`packages/guard/auto-review/tests/auto-review.spec.ts`](../../../../packages/guard/auto-review/tests/auto-review.spec.ts)固定审查门与生命周期。[`packages/tui/tui/tests/app.spec.ts`](../../../../packages/tui/tui/tests/app.spec.ts)覆盖循环、其确认、挂起切换守卫、面板独占按键和状态标记。[`apps/web/tests/access-confirmation.e2e.ts`](../../../../apps/web/tests/access-confirmation.e2e.ts)覆盖两个 Web 选择器与风险文案。无界面期望输出套件覆盖关闭时的持久化与恢复，无需密钥的录制会话快照回放随发行版交付的 profile。
