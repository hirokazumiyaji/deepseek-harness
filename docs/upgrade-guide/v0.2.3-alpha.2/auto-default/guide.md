---
kind: upgrade-guide
description: "New Web and TUI sessions start in Auto instead of Workspace Write; headless, SDK, and ACP keep the previous default."
---

# New Web and TUI sessions start in Auto

English | [中文](guide.zh.md)

## Change

The `web` and `tui` profiles now pin `permission/preset: auto` into every new session: the session runs without a file sandbox, its approval policy is `ask`, and the same model reviews every native tool call and PTC inner call before it runs. The General settings Permission row now offers Auto as a future-session default. Existing sessions keep the permission recorded in their logs. The `headless`, `sdk`, and `acp` profiles keep the previous Workspace Write default, and so does a composition that does not override the base row. Auto adds one reviewer model request per reviewed call.

## Migration

1. To keep Workspace Write for new Web sessions, open Settings → General → Permission and select Workspace Write. The write lands in the profile's `cordis.patch.yml` as `id: permission` with `defaultPreset: workspace-write`.
2. To keep Workspace Write for new TUI sessions, start with `dsh tui --permission-mode workspace-write`, or add a profile patch that sets the `permission` row's `defaultPreset` to `workspace-write` and restates the base `presets` table.
3. A composition that disables the `auto-review` row must set `defaultPreset` to a configured preset. Otherwise the first new session fails with `permission: default preset "auto" requires the live Auto review integration`.
4. Start a new session and confirm the composer permission control reads Auto; the TUI status line reads `auto (reviewed)`. Select Workspace Write to confirm you can switch the session back at any time.
