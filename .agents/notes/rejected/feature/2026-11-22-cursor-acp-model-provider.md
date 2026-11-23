# Agent Note: Cursor ACP as a model provider

Status: rejected — ACP runs Cursor's whole agent rather than model inference, so a provider route cannot honor DSH tool, approval, or metering contracts

English | [中文](2026-11-22-cursor-acp-model-provider.zh.md)

## Problem

The request was to add a Cursor subscription as a DeepSeek Harness model provider, to check Cursor's terms first, and to use the pi-ai `openai-codex` route as a reference. That route spends a ChatGPT plan through OpenAI's published plan sign-in and backend. Cursor publishes no equivalent model-inference API for its subscription. Its official programmatic interfaces are the Cursor CLI (`cursor-agent`, with `--print` documented for scripts and automation), the CLI's ACP mode (`cursor-agent acp`), and the TypeScript SDK (`@cursor/sdk`), and all three run Cursor's own agent loop; the SDK's local runtime keeps the agent loop in the caller's process but still sends inference to Cursor's hosted models.

Reaching Cursor's private model backend directly would require inspecting or deriving the service's internal protocol, which Cursor's Terms of Service §1.5(i) forbids. The terms-compatible programmatic path is therefore the documented CLI, ACP, and SDK surface, and all three run Cursor's agent rather than exposing a completion API. This note records why that path does not fit the harness's model-provider contract, so a later attempt does not repeat the investigation.

## Proposal

Build `@deepseek-ai/dsh-llm-cursor-acp`: an `LlmAdapter` that spawns `cursor-agent acp`, calls `authenticate` with `cursor_login`, creates an ACP session in the workspace, renders the assembled DSH conversation as one prompt, streams `agent_message_chunk` text as `text-delta` chunks, maps `stopReason` to a harness finish reason, and exposes the account's advertised models through `listModels()`. Model ids select with the CLI's `--model` flag, and the session mode selects with `session/set_mode`.

One fresh process and ACP session serve each model call. The note below rejects shipping that design.

## What was measured

The probe ran against Cursor CLI `2026.11.05-86047df` on macOS with an authenticated subscription account and a scratch workspace outside this repository. No probe code is committed.

- `initialize` answered ACP protocol version 1 with one authentication method, `cursor_login`, and advertised `loadSession` plus image prompt capability. `authenticate { methodId: 'cursor_login' }` succeeded from the existing CLI login.
- `session/new` returned a session id, modes `agent`, `plan`, and `ask`, a `mode` and `model` configuration option, and an account-specific `models.availableModels` list. `--model <id>` selected a model before `session/new`.
- `session/set_mode` changed the mode. In the probe, passing the root `--mode ask` flag did not change the ACP session's starting mode; the explicit `session/set_mode` call did.
- `session/prompt` streamed `agent_message_chunk` text deltas and finished with `stopReason: end_turn`. It returned no token usage.
- `session/close` answered "Method not found"; teardown is process-level (close stdin, then terminate).
- Under the harness workspace sandbox, the CLI failed with `EPERM` creating `~/.cursor/projects/...`. It needs its own home state, so a sandboxed child cannot run without widening the sandbox or redirecting Cursor home.
- In `ask` mode, the agent refused a file-edit request and left the file unchanged.
- In `agent` mode, a file edit and a shell command both executed. The client had a `session/request_permission` handler that rejected every request, and the handler was never called. That host's `~/.cursor/cli-config.json` sets `"approvalMode": "unrestricted"` and `sandbox.mode` to `disabled`, which explains the result; the client cannot distinguish those user settings from an ACP-level approval, and the adapter cannot enforce DSH approvals while the CLI user config can bypass them and Cursor's own sandbox is off.
- Text arrived in very small deltas (a few characters), so a provider would need to coalesce for reasonable chunk sizes and persistence.

## What was not tested

The probe did not exercise a restricted `approvalMode` or an enabled Cursor sandbox, the Cursor SDK runtime, Windows or Linux, team-managed policy controls, or a workspace-trust prompt. Those remain open questions. They do not change the decision: the adapter cannot make DSH's approval mode or sandbox authoritative over the CLI either way, and the missing completion operation is independent of them.

## Why the provider route does not fit

**No completion operation.** A DSH adapter receives assembled messages, tool schemas, and call controls and returns text, reasoning, and tool-call chunks. `session/prompt` accepts prose and runs Cursor's own loop; the client gets text, thoughts, tool-call notifications, plans, and session metadata, but no raw model response and no way to supply DSH's tools. The route can only return text, which means DSH's tool loop never runs for it. An `agent`-mode Cursor turn instead runs Cursor's tools, unseen and unaudited in the DSH session.

**Approval and sandbox authority are outside DSH.** Cursor executes its tools inside its own process. ACP defines `session/request_permission` for clients to answer, but the CLI's own `approvalMode` and `permissions` rules govern what even reaches the client, and the tested host auto-ran edits and shell commands. A model provider that can silently execute host commands outside the harness's approval mode and sandbox is not an acceptable product route. Defaulting to `ask` avoids edits and shell commands but reduces the route to a read-only chat model, which is not the requested capability.

**Session state does not map to model calls.** DSH assembles each call from the durable log and may retry, compact, fork, or replay it. An ACP conversation is a stateful remote session. A fresh session per call re-sends the full history and repeats agent work; a reused session needs `session/load` and a durable delta protocol that `GenerateOptions` does not carry. Model switches, compaction requests, and failed turns would each need a defined remote-session policy.

**Metering is blind.** The prompt response carried no usage and no context accounting, so token measurement and context pressure would be unavailable for the route.

**The process is not sandbox-friendly.** The CLI requires writable state under the user's home directory before it can speak ACP. The harness subprocess seam applies its credential scrub, but not Cursor's home layout; running the CLI inside the harness sandbox fails, and running it outside the sandbox removes a boundary the provider cannot replace.

## Terms and policy analysis

Cursor Terms of Service (last updated 2026-09-03) §1.5 restricts reverse engineering, decompiling, deriving the service's source or underlying structure, reproducing or creating derivative works, renting, leasing, lending, or selling the service, probing or penetrating it, scraping or harvesting data, and knowingly permitting a third party to do any of those things. §1.1 grants a limited right to access and use the service, and §1.2 covers Inputs and Suggestions.

The Acceptable Use Policy (last updated 2026-08-11) additionally prohibits "Accessing the Service through automated or non-human means, whether through a bot, script, or otherwise", circumventing rate limits or restrictions, manipulating subscription, billing, or usage metering, scraping or reselling Input or Suggestions, and using the service to develop competing models.

The ACP documentation says ACP "is intended for building custom clients and integrations", and the headless documentation presents print mode for "scripts and automation workflows", while noting that team administrators can disable CLI headless mode and that the setting does not cover other non-UI agent access. Those published surfaces make a personal, own-account, officially mediated integration defensible, and the AUP's automated-access sentence is best read as targeting unauthorized automation rather than the vendor's own documented automation interfaces. The terms do not, however, state that a subscription may back another agent harness, and the broad automated-access wording leaves room for Cursor to treat a shipped integration or unattended invocation differently. Reselling access, pooling accounts, bypassing limits, and building a competing service are clearly prohibited and cannot be made acceptable by the provider's design.

The conclusion is that the published surfaces make a personal integration defensible, and the SDK's stated use for embedded in-product agents and orchestrators makes an SDK-based integration plausible as well. The terms still restrict unauthorized automation, resale, account pooling, and limit bypass, and they do not state that a subscription may back another harness. On the available evidence this is not a clear violation; the reason not to ship a model-provider route is the technical mismatch above, not a legal finding.

## Alternatives considered

**Read-only provider restricted to `ask` and `plan`.** This avoids Cursor editing files and running shell commands, and a fresh session per call is safe because reads have no persistent side effects. It loses DSH tool execution entirely, so it delivers a read-only chat model rather than the requested agent-backed capability, and it still carries the terms uncertainty.

**Agent-capable provider with an explicit opt-in.** Defaulting to `ask` and requiring a configuration flag for `agent` would match the request more closely. It does not solve the approval problem: the CLI's own configuration can auto-run tools, the client may receive no permission request, and DSH's sandbox and approval mode do not constrain the child. It also leaves each call as an independent remote agent.

**Subagent backend using the existing ACP subagent package.** Configuring `@deepseek-ai/dsh-subagent-acp` with `cursor-agent` and `acp` gives honest semantics: one delegation is one task, and the existing backend owns process lifecycle, cancellation, and result folding. It does not provide model selection, it still runs Cursor's tools outside DSH approvals, and it would need its own terms and security documentation. It is a better private setup than a shipped model route.

**Official Cursor SDK (`@cursor/sdk`).** The SDK replaces process spawning with an official package and exposes durable agents, cancellation, and token usage, which ACP lacks; it is explicitly aimed at orchestrators and in-product agents. It still runs Cursor's agent loop and tools, still cannot accept DSH's tool schemas, and authenticates with a Cursor API key rather than the existing CLI login, so it does not turn the route into model inference. It is the better backend if a subagent integration is revisited, but it does not satisfy the model-provider request.

**Use Cursor directly (chosen).** `cursor-agent` already provides the subscription-backed agent in interactive, print, and ACP modes. DSH adds session, routing, and orchestration value only when Cursor is one model among several in a session, and the provider route cannot supply that value without the costs above. The integration was therefore stopped in favor of using Cursor directly, and this record keeps the assessment.

## Reintroduction conditions

- Cursor publishes a model-inference API that uses a subscription credential and reports usage, so a plain `LlmAdapter` can call it without running an agent.
- Or ACP exposes an enforceable client-side approval for every tool execution, independent of the CLI's user configuration, and DSH gains a durable mapping from its session and call identities to remote ACP sessions.
- Or the Cursor SDK exposes a model-level call that accepts client-supplied tools, removing the agent loop from the request path.
- Or the integration is scoped as a subagent bundle with a written contract that Cursor's tool execution happens outside DSH approvals, and Cursor confirms that the intended use is permitted.

## Related

- [Cursor ACP documentation](https://cursor.com/docs/cli/acp)
- [Cursor headless CLI documentation](https://cursor.com/docs/cli/headless)
- [Cursor Terms of Service](https://cursor.com/terms-of-service)
- [Cursor Acceptable Use Policy](https://cursor.com/acceptable-use-policy)
- [Cursor TypeScript SDK documentation](https://cursor.com/docs/sdk/typescript)
- [ACP subagent backend](../../../../packages/subagent/subagent-acp/README.md)
- [pi-ai provider adapter](../../../../packages/llm/llm-pi-ai/README.md)
