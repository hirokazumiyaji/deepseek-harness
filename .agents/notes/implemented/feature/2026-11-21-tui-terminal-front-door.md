# Agent Note: Terminal front door over one live Agent

Status: implemented

English | [中文](2026-11-21-tui-terminal-front-door.zh.md)

## Problem

DeepSeek Harness ships Web, ACP, JSON-RPC, and one-shot surfaces, but a person working over SSH or inside a terminal had no interactive surface. The deleted `@deepseek-ai/dsh-tui` [was removed](../../archived/simplification/2026-08-04-remove-tui-package.md) because no shipped profile mounted it; that note set the bar for a successor: a named product or deployment, an explicit package boundary, a concrete interaction provider, and assembled lifecycle and transcript acceptance. This change meets that bar with the shipped `tui` profile.

## Decision

A new `tui` profile stacks `dsh-base` with a patch-only bundle, [`@deepseek-ai/dsh-tui-app`](../../../../packages/bundle/tui-app/README.md), which mounts two rows: a Commander startup provider and the surface plugin [`@deepseek-ai/dsh-tui`](../../../../packages/tui/tui/README.md). The surface runs in the same Node process as the Agent; it mounts no Host, HTTP server, Client modules, or browser plugin, so a terminal session needs no port, cookie, or transport.

The surface consumes the same seams the Web surface uses, not a private copy: it creates or resumes one Agent through `ctx.agents`, drives turns with `followup`/`steer`/`cancel`, and reads durable facts from `session/event` plus live tokens from `agent/assistant-stream`. It answers the `approval/request` and `user-questions/request` waterfalls and dispatches human commands through `ctx.commands`, exactly as the browser adapters do. Tool cards come from `ctx.tools.get(name).presentCall`/`presentResult`, so a tool owns its own terminal presentation and no surface hard-codes tool names.

Startup is deferred to `ctx.appReady`. `dsh --profile tui --help` requests exit during the startup row's parse, so it prints help and exits without claiming the terminal; a failure in an unrelated row never leaves the screen in raw mode. A non-TTY invocation refuses before rendering and points at `dsh --profile headless`. Exit cancels a running turn, flushes the Session, disposes the Agent handle, stops the renderer, and then requests bounded process exit. `/resume` validates the target through `ctx.sessionQuery` and refuses a Session recorded in another working directory or under an agent preset this composition does not mount, because process cwd and the composed tools must match the log being continued.

Rendering uses `@earendil-works/pi-tui`, the renderer of the removed package and an already-resolved transitive dependency, promoted to a direct dependency. The alternate choice — a Node client of the Web gateway — was rejected: it would add a transport, authentication, reconnection, and a second process boundary for a single-user terminal surface, and the Client conversation fold is React-shaped at its entry points.

## Alternatives considered

**Reuse the removed package wholesale.** Rejected because it was written against the pre-rename Cordis package, `ctx.userInteraction`, the old agent model-target API, and pi-tui 0.80; importing it would preserve a second implementation of removed seams rather than the current ones. Its presentation rules informed this surface's component split, but the code is new.

**Run the TUI as a Node client of the Web gateway over loopback.** Rejected because the browser transport needs the Host server, token admission, and reconnection supervision, and the reusable conversation fold is not exported for a terminal consumer. A terminal surface that shares the process needs none of that.

**Make the TUI a second frontend of the existing `web` profile.** Rejected because the Web bundle disables the base agent plane and mounts per-session presets; a single-process terminal surface wants the base plane, and mixing both would make one profile own two application shapes.

## Consequences

One `PlanPanel` is owned by the surface rather than by each transcript, so `/clear` and `/resume` update the panel that is actually mounted. Session switches hold a switching flag that drops prompts and further switches, dispose a handle opened by a failed swap, and report a previous-handle disposal failure separately from a resume failure. Exit waits for cancellation through the configured `shutdownTimeoutMs`, and `--permission-mode`/`--approval-policy` are validated before the first Agent exists and reapplied to every resumed handle.

`dsh tui` is a shipped entry in the CLI help, the profile template table, and the architecture map; `dsh --profile tui --help` is a supported non-interactive path. The bundle adds the `ask_user_question` tool, which the base deliberately omits, and disables configuration HMR because a reload would replace the Agent and renderer mid-conversation. The surface supports one Session at a time; `/resume` swaps the Agent in place and replays its log. Web GUI, ACP, and SDK clients remain separate bundles, so one process still serves one application shape.

## Verification

`packages/tui/tui/tests/tui.spec.ts` boots the surface over real `SessionStore`, `SessionProjectionRegistry`, `AgentRegistry`, `ApprovalService`, and `UserQuestionService` instances with a scripted Agent and a terminal double, then asserts the rendered banner and composer, a submitted follow-up, streamed assistant text, an approved and a rejected approval, a selected question option, a steering submission, and the Ctrl+D flush-and-exit path. `transcript.spec.ts` checks durable-event projection, streamed-step settlement in place, tool-card completion, error notices, the standing plan, and replay. `startup.spec.ts` runs the provider over a real Loader tree, covering prompt parsing, resume/permission/approval/write-grant options, help exiting zero without publishing, and blank-input rejection. `loop.spec.ts` mounts the production `dsh-agent-loop` with a scripted adapter, asserts that a turn's streamed reasoning, reply, and usage settlement reach the terminal through the real loop, and compares the normalized screen with committed expected output. `packages/bundle/tui-app/tests/composed-boot.spec.ts` composes the shipped base and tui-app patch documents, asserts their surface, startup, ask-user, and persona rows, and boots those rows through a real Loader and AgentLoop in a subprocess with a scripted adapter. `snapshots/tui/tui.snapshot.ts` drives the shipped `tui` profile through the `dsh` CLI under a PTY with `llm-replay`, then compares the normalized persisted Session and its system-prompt and tool-schema sidecars with committed fixtures. The repository's source build, typecheck, documentation gates, locale metadata, package constraints, and the per-file 100% coverage gate for every source file in the package pass with the two new packages.
