---
description: "What the tui profile bundle adds to dsh: the interactive terminal surface row over dsh-base, for users composing or customizing a profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

English | [中文](README.zh.md)

## Summary

This bundle layer turns a base-backed profile into the interactive terminal surface. It mounts the `@deepseek-ai/dsh-tui` renderer with its command-line provider, adds the model-facing `ask_user_question` tool, pins the workspace sandbox policy, and disables configuration hot reload. The shipped `tui` profile is `dsh-base` plus this layer, so `dsh tui` opens a conversation in the terminal without a Host, HTTP server, or browser. Add or remove it in a custom profile through `dsh plugin`; `dsh tui --help` prints the app help and exits without claiming the terminal.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped profile auto-initializes on first use:

```sh
dsh tui                                   # open a new session in this directory
dsh tui "explain this repository"         # open with a first prompt
dsh tui --resume session-…                # continue a persisted session
dsh --profile tui --permission-mode read-only
```

`dsh --profile tui --help` prints the terminal app's own flags and exits 0 without opening it. Add the layer to a custom profile with:

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-tui-app
dsh plugin --profile <name> remove @deepseek-ai/dsh-tui-app
```

The layer reads its options from the `tuiStartup` provider published by its own startup row; the surface row injects that service, so its config resolves only after a successful parse. A profile may override any row by id, including replacing `prompt` with a fixed value.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Layer order

`cordis.patch.yml` applies over `dsh-base` as one patch document:

1. It restates the system persona.
2. It inserts `tui-startup` (`@deepseek-ai/dsh-tui/startup`), the surface row `tui` (`@deepseek-ai/dsh-tui`) with `inject: [tuiStartup]`, and the `tool-ask-user` row.
3. It replaces the `sandbox-policy` config with the CLI grants (`mode`, `workspaceRoot: process.cwd()`, `additionalWritableRoots`).
4. It disables `hmr`.

Base keeps the agent plane — tools, prompt sections, and delegation backends — because this surface is single-session and composes its Agent process-wide, which is why its row requires no agent preset.

### Entry id

The `tui` row id is listed among the launcher's required application entries: when enabled it must activate, so a missing runtime dependency fails startup instead of leaving an idle process.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-tui`](../../tui/tui/README.md) — the terminal surface this layer mounts.
- [`dsh-base`](../base/README.md) — the shared layer underneath.
- [`dsh-headless`](../headless/README.md) — the one-shot non-interactive alternative.
- [`apps/cli` README](../../../apps/cli/README.md) — the user-facing CLI guide.

<a id="model-experience"></a>
## Model Experience

### Terminal surface composition

#### What the model sees

The layer's persona prefix and every base tool. It adds `ask_user_question`, so the model can request a decision from the person at the terminal, and the base `exit_plan_mode`, todo, goal, and compaction tools remain available.

#### Token effect

The persona and tool schemas are ordinary system-prompt and tool declarations; the layer adds no tokens beyond the base composition plus the ask-user tool schema.

#### KV Cache effect

The composed prefix is stable for the life of the profile, so requests reuse the same cache domain until a tool or prompt section changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No Host, HTTP, or browser rows.** Terminal usage cannot serve the Web GUI, ACP, or SDK clients; compose those bundles instead when another surface is needed.
- **No agent presets.** The base agent plane applies to the single Agent this profile drives, so a persisted Session created under a preset is refused on resume.
- **Configuration hot reload is off.** The composition fixes its Agent and renderer for the process lifetime.

### Dev Note

<a id="dev-note"></a>

The package carries no runtime API: its substance is the patch document, declared through `dsh.bundle.patch`.
