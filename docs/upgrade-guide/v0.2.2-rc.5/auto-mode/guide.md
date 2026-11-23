---
kind: upgrade-guide
description: "The experimental Auto review profile layer became the shipped Auto permission mode: the package is renamed to @deepseek-ai/dsh-auto-review and dsh-base mounts it."
---

# Auto mode replaces the experimental Auto review layer

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-experimental-auto-review` was an optional profile layer that a user installed into a Web or headless profile before the `auto` permission preset existed. It is now `@deepseek-ai/dsh-auto-review`, a product package that `dsh-base` mounts, so every base-backed profile — `web`, `headless`, `tui`, `sdk`, and `acp` — offers the `auto` preset without installing a layer. The Web picker and the terminal status line call the mode **Auto**; the old `EXP` badge and the experimental framing are gone, while the risk confirmation before switching remains.

A profile that still lists the old bundle name is repaired on the next launch: app-boot removes the retired entry from the stored bundle list and rewrites the profile manifest. A profile patch that inserts the old package name as a row does not resolve, because the package no longer exists under that name.

## Migration

1. Start `dsh` once with the affected profile. app-boot removes `@deepseek-ai/dsh-experimental-auto-review` from the profile's bundle list and rewrites its `package.json`.
2. If the profile or a patch inserts `@deepseek-ai/dsh-experimental-auto-review` as a row, delete that row or patch layer. `dsh-base` already mounts the replacement as `auto-review`; a second row fails resolution. Keep overlays that only add a reviewer script for tests.
3. If a script passes `--patch` pointing at the retired package's `cordis.patch.yml`, drop the flag. The preset and its review gate are built in.
4. If the old package was installed as a profile dependency, remove the now-unresolvable dependency after step 1 rewrote the bundle list. Confirm the profile's `package.json` lists no `dsh-experimental-auto-review` entry.
5. Headless supervision needs no installation: `dsh headless --permission-mode auto --approval-policy never --json - < task.txt > run.jsonl`.
6. Confirm the mode: open the Web permission picker or the terminal Shift+Tab cycle and check that **Auto** appears; then select it and check that the next tool call reaches the approval panel only when the reviewer denies it. Persisted Sessions recorded with `permission/preset:auto` reopen unchanged in a base-backed profile.
