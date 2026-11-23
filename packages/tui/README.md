---
description: "The tui group map: the interactive terminal front door over one live Agent, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/tui

English | [中文](README.zh.md)

## Summary

The tui group gives DeepSeek Harness a terminal front door: one live Agent rendered as a conversation with streamed replies, tool cards, the standing plan, approvals, the model's questions, slash commands, and resume. It ships the surface plugin and its command-line provider; the shipped `tui` profile mounts both through [`dsh-tui-app`](../bundle/tui-app/README.md). The group owns presentation and terminal lifecycle only — the agent loop, tools, persistence, approvals, and commands stay in their own packages.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tui`](tui/README.md) | Interactive terminal surface over one Agent: transcript, composer, approvals, questions, commands, resume | `tuiStartup` (provider) |

-----

<a id="related-documentation"></a>
## Related documentation

- [`dsh-tui-app`](../bundle/tui-app/README.md) — the shipped `tui` profile layer.
- [`dsh-user-approval`](../interaction/user-approval/README.md) — the `approval/request` waterfall the surface answers.
- [`dsh-user-questions`](../interaction/user-questions/README.md) — the `user-questions/request` waterfall the surface answers.
- [`dsh-commands`](../interaction/commands/README.md) — the human command registry the surface dispatches to.
- [Application launch](../../docs/architecture.md#application-launch) — why every surface launches through a `dsh` profile.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
