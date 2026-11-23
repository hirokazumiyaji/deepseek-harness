# Agent Note: Auto mode as a product permission mode

Status: implemented

English | [中文](2026-11-21-auto-mode-product.zh.md)

## Problem

[Per-tool Auto review](2026-08-28-auto-review.md) shipped as an experimental, explicitly installed profile layer. Default Web kept three permission modes, the terminal surface had no reviewed mode at all, and headless supervision required installing the layer before `--permission-mode auto` worked. A person who wants Claude Code's auto mode — actions proceed without prompts, a model reviews each one, and a denial still asks — had no supported way to select it.

## Decision

[`@deepseek-ai/dsh-auto-review`](../../../../packages/guard/auto-review/README.md) is a product package in `packages/guard/`, published under that name instead of the experimental prefix. `dsh-base` mounts it as the `auto-review` row, so every base-backed profile — `web`, `headless`, `tui`, `sdk`, and `acp` — publishes the `auto` preset. At promotion, selection stayed explicit per Session and the default preset remained `workspace-write`; the [later default change](2026-11-23-auto-default.md) moves new Web and TUI sessions to Auto and leaves the automation profiles on `workspace-write`.

The Web permission picker labels the preset **Auto** without the experimental badge and keeps its risk confirmation. The terminal surface adds Shift+Tab mode cycling: it walks `permissionPresets.names`, asks through the ordinary decision panel before entering any preset whose resolved sandbox is `danger-full-access`, applies the choice through the registered `/permission` command so the approval-policy switch is narrated to the model, and marks the status line `auto (reviewed)` while Auto is active. An explicitly typed `/permission auto` remains a direct switch on both surfaces.

The old npm name is retired: app-boot removes `@deepseek-ai/dsh-experimental-auto-review` from stored profile bundle lists, and the [upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.5/auto-mode/guide.md) states the migration. Review policy, risk classes, denial identities, PTC exclusions, child inheritance, and unload migration are unchanged; the promotion changes package role, default availability, and surface presentation only.

## Alternatives considered

**Keep the experimental layer and mount it in the Web and terminal bundles.** Rejected: release bundles may not depend on experimental packages, the mode would still be absent from headless and ACP compositions, and the plugin-manager install/uninstall flow would become the supported way to change a permission mode.

**Add a classifier-free auto-approve mode.** Rejected: Claude Code's auto mode delegates review to a model, and an unconditional grant is the existing `danger-full-access` preset under another name. It would remove the denial and audit behavior the per-call reviewer owns.

**Mount the layer per surface instead of in base.** Rejected: the capability is surface-agnostic and base already owns the approval and permission rows. Per-surface rows would let shipped profiles diverge in which permission modes exist.

**Keep the Auto review label and experimental badge.** Rejected: the mode is a supported product capability now, and readers search for the term their other tool uses. The mechanism name stays in denial text and documentation, where it describes the review step rather than the mode.

## Consequences

The mode becomes available without installation and the Web, terminal, and headless surfaces select it the same way. Promotion gives up the experimental isolation guarantee: the package must meet product documentation, release-payload, and named-owner obligations, and every release family now publishes it. A profile that disables the base row loses the preset, and a persisted Auto Session cannot reopen until the row returns.

The terminal cycle expands access only after a confirmation, and a mounted decision panel keeps Shift+Tab for its own row navigation. The reviewer still costs one model request per supported call, can wrongly allow or deny an action, and leaves the outer `run_code` transport and direct Node effects inside a PTC program outside review.

## Testing

[`packages/guard/auto-review/tests/auto-review.spec.ts`](../../../../packages/guard/auto-review/tests/auto-review.spec.ts) pins the review gate and lifecycle. [`packages/tui/tui/tests/app.spec.ts`](../../../../packages/tui/tui/tests/app.spec.ts) covers the cycle, its confirmation, the pending-switch guard, the panel-owned key, and the status marker. [`apps/web/tests/access-confirmation.e2e.ts`](../../../../apps/web/tests/access-confirmation.e2e.ts) covers both Web pickers and the risk copy. The headless expected-output suite covers shutdown persistence and restore, and the keyless recorded snapshots replay the shipped profiles.
