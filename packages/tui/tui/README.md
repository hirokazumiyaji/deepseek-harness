---
description: "The interactive terminal front door over one live Agent: transcript rendering, composer input, approvals, questions, slash commands, resume, and terminal teardown."
kind: "package-reference"
---

# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

## Summary

Use this package to run one Agent interactively in a terminal. It renders the Session as a conversation: streamed assistant text and reasoning, one card per tool call, the standing todo plan, approval and question panels, a status line, and a composer that queues a turn or steers a running one. [`dsh-tui-app`](../../bundle/tui-app/README.md) mounts it as the `tui` profile. It owns presentation and terminal lifecycle only; the agent loop, persistence, approvals, questions, and commands stay in their own packages. Startup refuses a non-interactive stdin or stdout.

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

Mount it through a profile row; the shipped `dsh --profile tui` composition mounts `@deepseek-ai/dsh-tui/startup` first and this plugin second. A custom profile can do the same:

```yaml
- id: tui-startup
  name: '@deepseek-ai/dsh-tui/startup'

- id: tui
  name: '@deepseek-ai/dsh-tui'
  inject: [tuiStartup]
  config:
    resume: !!js ctx.tuiStartup.resume
```

| Field | Default | Meaning |
|---|---|---|
| `sessionId` | fresh `session-<uuid>` | Exact Session identity to open. |
| `resume` | — | Persisted Session identity to resume instead of creating one. |
| `prompt` | — | First prompt submitted once the surface is live. |
| `permissionMode` | base default | Permission preset applied before the first prompt. |
| `approvalPolicy` | base default | Approval behavior applied before the first prompt. |
| `welcome` | — | Extra banner line until the Session has a title. |
| `showReasoning` | `true` | Render reasoning blocks. |
| `maxToolOutputLines` | `6` | Retained output lines in a collapsed tool card. |
| `color` | `true` | Apply the built-in ANSI palette. |
| `title` | `DeepSeek Harness` | Product suffix of the terminal window title. |
| `shutdownTimeoutMs` | `10000` | Maximum wait for cancellation and Session disposal during exit. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tui) is the exhaustive source for every accepted field.

### Keys and commands

Enter submits the composer. While the Agent runs, an ordinary submission calls `agent.steer()` and joins the nearest step; while idle it calls `agent.followup()` and opens a turn. Ctrl+C cancels a running turn; pressed twice while idle it exits. Ctrl+D exits, and Ctrl+L redraws after external output corrupted the screen. Shift+Tab cycles the available permission presets; entering Full access or Auto asks for confirmation first, and Auto marks the status line `auto (reviewed)`.

`/help`, `/status`, `/model`, `/resume`, `/clear`, `/redraw`, and `/exit` are local. Every command another plugin registers on `ctx.commands` runs through the same seam and its result is rendered as a notice outside model history. `/resume` without an argument lists recent persisted Sessions; `/resume <id>` resumes one in this process. `/model <provider>/<model>` selects a route for later steps. The shipped `permission-presets` command switches sets of sandbox and approval settings: `/permission` lists the presets and `/permission <preset>` switches to one.

### Verify it

From the repository root, with the packages built:

```sh
pnpm dsh --profile tui --help     # prints the app help and exits without opening the terminal
pnpm dsh --profile tui            # opens the surface in an interactive terminal
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: resolves the invocation, creates or resumes the Agent, and defers surface startup to `appReady`. |
| [`src/startup.ts`](src/startup.ts) | Commander provider that publishes `tuiStartup`. |
| [`src/app.ts`](src/app.ts) | `TuiApp`: component tree, event wiring, submit/cancel/exit, `/resume` swap. |
| [`src/transcript.ts`](src/transcript.ts) | Durable-event and live-frame projection into transcript blocks. |
| [`src/components.ts`](src/components.ts) | pi-tui components: role headers, replies, tool cards, notices, plan, status. |
| [`src/interactions.ts`](src/interactions.ts) | Terminal answerers for approval and user-question waterfalls. |
| [`src/commands.ts`](src/commands.ts) | Local slash commands and dispatch to `ctx.commands`. |
| [`src/theme.ts`](src/theme.ts) | Palette, markdown theme, and control-character escaping. |

### Startup

The plugin does not start the terminal while the tree mounts. It registers an `appReady` listener, so `dsh --profile tui --help` — which requests exit during the startup row's parse — never claims the terminal, and a boot failure elsewhere never leaves the screen in raw mode. Once ready, it awaits the Loader, resolves the working directory through `ctx.fs`, validates a `--resume` identity with `ctx.sessionQuery`, creates or resumes the Agent, applies the requested permission preset and approval policy, and starts the renderer.

### Rendering

The renderer is `@earendil-works/pi-tui`'s main-screen TUI, so the conversation and the terminal's own scrollback share one document and `stop()` prints the final document before restoring the cursor. Durable facts come from `session/event` through one projection function shared by replay and live steps; live tokens come from `agent/assistant-stream`. A settlement reuses the live block for its turn and step instead of appending a second one. Tool cards ask `ctx.tools.get(name)` for the tool's own `presentCall`/`presentResult` view, falling back to the generic card when a tool declares none or a presenter throws. Untrusted text is escaped before it reaches ANSI-aware renderers.

### Interaction and teardown

One `approval/request` listener and one `user-questions/request` listener answer the two human-interaction waterfalls. Requests are serialized through one panel, which takes keyboard focus from the composer and returns it when the answer settles; a request whose signal aborts forfeits its answer. Exit cancels a running turn, flushes the Session, disposes the Agent handle, stops the renderer, and requests bounded process exit. Tree unload (launcher shutdown, a fatal sibling failure) stops the renderer without re-entering the exit path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-tui-app`](../../bundle/tui-app/README.md) — the shipped `tui` profile layer.
- [`dsh-user-approval`](../../interaction/user-approval/README.md) — approval outcomes and fail-closed behavior.
- [`dsh-user-questions`](../../interaction/user-questions/README.md) — question and answer types.
- [`dsh-commands`](../../interaction/commands/README.md) — the human command seam.
- [`dsh-tools`](../../core/tools/README.md) — `presentCall` and `presentResult`.

<a id="model-experience"></a>
## Model Experience

### Composer input

#### What the model sees

Each non-empty submission becomes one text block in a user message. While idle it is delivered as `agent.followup()`; while the Agent runs it is delivered as `agent.steer()` and joins the nearest step. A submitted slash command runs against `ctx.commands` and is not a model message; only a command that itself schedules agent work reaches the model.

#### Token effect

Submitted text is retained under the agent loop's normal history and compaction rules. Role headers, cards, the plan, the status line, and notices add no tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix. Command results are outside model history.

### Approvals and questions

#### What the model sees

An approval settles as `allowed-once`, `rejected`, or `cancelled` and the calling tool reports that outcome. A question answer returns one item per asked question, with selected option labels and optional custom text. Cancellation and failure reach the model as the calling tool's error result.

#### Token effect

Panels add no tokens; only the calling tool's result enters history as usual.

#### KV Cache effect

Append-only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One Session per process.** The surface drives the Agent its row opened; `/resume` swaps that Agent and replays its log, but two Sessions cannot be shown at once.
- **Resume requires the current working directory.** A persisted Session recorded in another directory is refused rather than run there, because process cwd — not the restored header — is what filesystem and shell tools resolve against. It also refuses a Session created under an agent preset, which this composition does not mount.
- **Configuration does not hot-reload.** The `tui` bundle disables `dsh-hmr`; a reload would replace the Agent and renderer mid-conversation, so restart to apply configuration changes.
- **Text-only cards.** Inline images, mouse text selection, and collapsible per-card expansion states are not implemented; the terminal's own selection and scrollback serve those needs.
- **No PTY is required, but no non-TTY fallback exists.** Automation uses `dsh --profile headless` instead.

### Dev Note

<a id="dev-note"></a>

The interaction waterfalls and `ctx.agents` are the whole contract; no Host, HTTP, or browser plugin is mounted. Tests drive the real approval and question services through a terminal double, and the startup provider runs over a real Loader tree.
