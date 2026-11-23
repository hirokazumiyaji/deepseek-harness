# Agent Note: Auto as the Web and TUI new-session default

Status: implemented

English | [中文](2026-11-23-auto-default.zh.md)

## Problem

[Auto mode as a product permission mode](2026-11-21-auto-mode-product.md) made the reviewed `auto` preset available in every base-backed profile, but new sessions still started in `workspace-write`. A person who wants the reviewed mode had to select Auto in every new Web session or press Shift+Tab in the terminal. The interactive surfaces therefore did not start in the mode the product advertises, while changing the base default would also make unattended `headless`, `sdk`, and `acp` sessions spend one reviewer request per tool call and ask before denied calls without a person to answer.

## Decision

The `web-app` and `tui-app` bundles replace the base `permission` row with the same preset table plus `defaultPreset: auto`; a patch replaces the whole row config, so both bundles restate the table. `dsh-base` keeps `workspace-write`, and the `headless`, `sdk`, and `acp` bundles do not override it. The [permission service](../../../../packages/interaction/permission-presets/README.md) accepts `auto` as a configured default without resolving it during construction, because the Auto review integration injects the service and registers after it activates. The first session to resolve the default validates that the integration is live, and a fresh Auto session runs the integration's admission check before writing `permission/preset`, `sandbox/mode`, and `approval/policy`.

The process catalog's `defaultOptions` now includes live Auto, so the Web General settings row offers **Auto** as a future-session default through the ordinary settings write path, with the same risk confirmation as the picker. Selecting another preset in Settings changes the default back without touching an existing session. A composition that removes `auto-review` while the default still names Auto fails new-session creation with `permission: default preset "auto" requires the live Auto review integration`; the service does not silently fall back. Existing sessions keep the permission recorded in their logs.

## Alternatives considered

**Change the base default to Auto.** Rejected: every base-backed profile includes `headless`, `sdk`, and `acp`, where a reviewer request per tool call raises unattended cost and an `ask` denial has no person to answer. The interactive surface owns this product choice.

**Leave the default in user settings only.** Rejected: a fresh Web or TUI installation would still start outside the advertised mode, and a TUI profile has no Settings surface at all.

**Fall back to `workspace-write` when the integration is absent.** Rejected: silently changing the requested default hides a composition error and makes the same configuration behave differently at different boots.

**Add a separate Auto on/off switch.** Rejected: the permission picker is already the switch, it persists the choice per Session, and the Settings row provides the default. A second control would duplicate the same state.

## Consequences

New Web and TUI sessions run without a file sandbox, use the `ask` approval policy, and consume one reviewer model request per reviewed tool call or PTC inner call. Users can switch the session back at any time, and the Web Settings row can change the default. Recorded Web e2e fixtures stay on `workspace-write` because their model scripts and approval scenarios were authored under it; a dedicated scenario boots the shipped Auto default. Headless supervision keeps the documented explicit `--permission-mode auto --approval-policy never` path.

## Testing

[`packages/interaction/permission-presets/tests/permission-presets.spec.ts`](../../../../packages/interaction/permission-presets/tests/permission-presets.spec.ts) covers the lazy Auto default, admission, settings writes, withdrawal, and the missing-integration failure. [`apps/cli/tests/profile-permission-defaults.spec.ts`](../../../../apps/cli/tests/profile-permission-defaults.spec.ts) pins the Web and TUI Auto defaults and the automation compositions' unchanged base default. [`packages/client/ui-permission-presets/tests`](../../../../packages/client/ui-permission-presets/tests) covers the Auto option label, risk gate, and catalog withdrawal in the Settings row. [`apps/web/tests/auto-default.e2e.ts`](../../../../apps/web/tests/auto-default.e2e.ts) boots the shipped Web composition and checks the composer chip and Settings row. [`apps/web/tests/shipped-composition.e2e.ts`](../../../../apps/web/tests/shipped-composition.e2e.ts) asserts the live default; the recorded replay lane pins `workspace-write` through the scaffold, and the TUI recorded-session snapshot pins it in its scenario patch so its committed fixture stays comparable.
