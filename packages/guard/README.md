---
description: "Package map for the guard family: the model-reviewed Auto permission mode, the advisory repeat-tool reminder, the per-tool-call timeout policy, and the push confirmation guard, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — tool-call guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group keeps the agent loop productive and its tool calls authorized. `auto-review` runs the `auto` permission mode: the same model reviews each supported call before it runs. `repeat-tool-reminder` notices repeated identical calls and nudges the model to change approach. `timeout-policy` bounds calls that declare a limit, and `git-push-guard` asks you to confirm a `git push`. All but the push guard ship in the base bundle.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Four small plugins cover these behaviors; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`auto-review/`](auto-review/README.md) | Runs the `auto` permission mode: a same-model review replaces approval prompts, and a denial still asks the user |
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`git-push-guard/`](git-push-guard/README.md) | Asks the user to confirm a `git push` before the agent runs it, with a default for new Sessions and one switch per Session |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the push guard's decision record, the reminder's configuration, and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions the guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Push guard Agent Note](../../.agents/notes/implemented/feature/2026-10-26-git-push-guard.md) — why the guard confirms pushes, and what it cannot see.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
