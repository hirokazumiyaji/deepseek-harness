---
description: "The Auto permission mode: every native or PTC inner tool call is reviewed by the same model before it runs, without a file sandbox."
kind: "package-reference"
---

# @deepseek-ai/dsh-auto-review

English | [中文](README.zh.md)

## Summary

Auto mode lets an agent work without a file sandbox or a human decision before every action: before each native or PTC inner tool call, the same model reviews whether to allow it. Allowed calls execute immediately; a denial asks you under the `ask` approval policy and is final under `never`. Choose Auto from the Web permission picker, with Shift+Tab in the terminal, or with `--permission-mode auto`. Reviews add one model request per supported call, can wrongly allow or deny an action, and never cover the outer `run_code` transport or direct Node effects inside a PTC program.

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

The `dsh-base` bundle mounts this row, so the Web, terminal, and headless profiles offer Auto without further installation.

<a id="selecting-auto"></a>
### Selecting Auto

Auto is a permission preset contributed at runtime. In the Web GUI, new sessions start in Auto, and the composer permission menu or `/permission auto` switches the current session. In the terminal, run `dsh tui` and press Shift+Tab until the status line shows `auto (reviewed)`, or pass `--permission-mode auto`. Headless runs accept the preset and are supervised with a fixed policy:

```sh
dsh headless --permission-mode auto --approval-policy never --json - < task.txt > run.jsonl
```

The Web picker, the General settings Permission row, and Shift+Tab ask for a risk acknowledgement first; an explicit `/permission auto` line switches directly. The shipped Web and TUI bundles start new sessions in Auto; headless, SDK, and ACP keep the workspace-write default. A composition that removes this row must not leave `defaultPreset` naming Auto.

### Composition

```yaml
- id: auto-review
  name: '@deepseek-ai/dsh-auto-review'
```

The row requires the approval, permission-preset, LLM, Session, tools, and working-directory services. A composition that drops this row loses the `auto` preset; a persisted Auto Session then fails to reopen until the row returns.

### What you get

Auto reviews every supported call once before its body, including each started PTC `tools.*` inner call. It classifies actual effects: ordinary project-local work and exact cleanup of objects created in this Session are low risk and allowed; irreversible deletion of pre-existing objects, production operations, external writes, and security changes are medium risk and require explicit current user or direct-parent authorization of the action, target, and scope. Sensitive exfiltration across a trust boundary is high risk and always denied. Ambiguous effects and unresolved authorization conflicts are denied. Selecting Auto sets the `ask` approval policy, so a denied call asks the user and executes only after approval; a rejected or cancelled approval leaves its body unexecuted. A delegated in-process child pins the `never` policy, so its denials are final. Malformed reviewer responses and technical failures fail the call with their specific error and never execute it.

A final denial uses the ordinary tool card. The collapsed row identifies Auto review; expanded output states that the body did not execute and displays the optional reason. [The Web permission package](../../client/ui-permission-presets/README.md) owns picker interaction, and [the tool UI](../../client/ui-tool/README.md) owns reason display.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: preset contribution, pre-execute review gate, and lifecycle. |
| [`src/locales.ts`](src/locales.ts) | Locale-owned approval prompt text for a reviewer denial. |
| [`tests/auto-review.spec.ts`](tests/auto-review.spec.ts) | Unit behavior of the gate, snapshot assembly, and lifecycle. |

### Review path

[`src/index.ts`](src/index.ts) requires the approval, LLM, permission, Session, and tools services, then installs the preset contribution and prepended pre-execute listener in one effect. After the review settles, a denial reads the Session's approval policy: under `never` it is final; under `ask` the listener delegates to later pre-execute listeners and returns the tools pipeline's `ask` decision only when they allow the call, so a later denial, cancellation, or `ask` (with its own reason) takes precedence. The `ask` decision carries an English audited reason and locale-owned English, Chinese, and Japanese prompt text from `src/locales.ts` that keeps the raw reviewer reason. The [permission owner](../../interaction/permission-presets/README.md) supplies the current identity and process catalog; Auto uses Full access's sandbox value with the `ask` approval policy and does not change tool definitions.

The reviewer sends the fixed policy as its system prompt, then one user message for the cwd-only environment, one per retained Session item in surface order, and the pending call last. Project instructions appear where they entered the surface, with the constraint role. A `tool-schema` item precedes the first call that used each reviewed schema; the integration remembers each reviewed call's schema for the live Session so that later reviews repeat it at the same position. Native schema comes from the latest request header. A PTC binding freezes its schema and carries it through the scheduler into transient execution metadata; start and settle events never serialize description or parameters. Main-agent `system/message` nodes, assistant text and reasoning, and tool results are excluded. The outer review input is a frozen `RequestUserInput` without durable identity or source; retained history keeps its original source attribution in the review text. [The decision record](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.md) owns authority, lifecycle, and child-inheritance rationale.

Unloading closes selection and review admission. If the application root remains active, unload then migrates live Auto Sessions to Full access through the existing preset writer; this includes plugin removal and reload. The migration writes the `never` approval policy without queuing a policy-change notice; the model sees the new policy in the next runtime-context snapshot. The sandbox value and persistent terminals survive the migration. Application shutdown preserves the selected preset and approval policy. Both paths abort and drain reviews before withdrawing the listener and contribution. A persisted Auto Session cannot publish without the complete integration, even when the reopening request selects another preset.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Base bundle](../../bundle/base/README.md) — the shared composition that mounts this row.
- [Permission presets](../../interaction/permission-presets/README.md) — identity, bundles, and the current-session catalog.
- [Approval](../../interaction/user-approval/README.md) — the `ask` and `never` policies and their audit events.
- [Tools](../../core/tools/README.md) — execution, cancellation, and PTC result propagation.
- [Auto review decision](../../../.agents/notes/implemented/feature/2026-08-28-auto-review.md) — fixed risk policy, authority, and lifecycle.

-----

<a id="model-experience"></a>
## Model Experience

### Per-call reviewer

#### What the model sees

The reviewer uses the latest `request/header.config` provider and model with the shipped adapter's default reasoning. Its fixed `REVIEW_POLICY` replaces human approval for exactly one action: allow executes immediately with Full access. The user messages contain only the retained facts described above. It returns one strict JSON text object with `risk` and `decision`; deny may include a string `reason`. Reasoning blocks may precede that single text block. Only `low + allow`, `medium + allow/deny`, and `high + deny` are valid.

#### Token effect

One additional model request per supported call, without caching, retries, truncation, compaction, or a separate small output budget. An oversized request fails the call with the provider error.

#### KV Cache effect

Each review's messages begin with all messages of the previous review, including its pending call, so routes that cache by prompt prefix, at message ends, or at a final marker with lookback reuse the policy and earlier history. Compaction, a cwd change, an earlier item leaving the surface, and the first review after a restart end that reuse once. Auto adds no dedicated runtime context or mode-switch prompt to the main agent. Each review request carries the reviewed Session's `sessionId` and `purpose: 'auto-review'` as model-hidden transport metadata. Routes that key prompt caching or request routing by Session, such as OpenAI `prompt_cache_key` and the `x-opencode-session` header that OpenCode requires, send reviews under that Session's key; [the DeepSeek Session-log upload](../../session/session-log-deepseek/README.md#request-field) contributes the canonical Session log when enabled and no registered exclusion matches.

### Tool denial

#### What the model sees

Under the `ask` approval policy, the model sees only the approval outcome, such as `the user rejected tool "<name>"`, or the approved call's ordinary result. A final denial message is `Auto review rejected tool "<name>"; its body was not executed`. A reviewer failure message is `Auto review of tool "<name>" failed; its body was not executed: <error>`. Ordinary native error rendering prefixes each message with `Error: `. PTC uses the existing inner-call exception and catch behavior; a caught denial does not force the outer `run_code` to fail. The raw optional reason is durable structured error detail for users, never main-model content. Risk, reviewer prompt, reasoning, and raw response are not persisted.

#### Token effect

A denied or failed call contributes only its ordinary error result to the main conversation.

#### KV Cache effect

The denial appends an ordinary tool result; it does not rewrite earlier context or hide existing model-visible information.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Auto provides no file sandbox. The outer `run_code` transport and direct Node effects inside a PTC program do not pass through inner-tool review.
- Model classification can be wrong. There are no deterministic tool exemptions, persistent grants, configurable policy, or retry layer.
- One review request per supported call uses the current agent's route and token budget; the mode adds no separate small-model or spending cap.
- In-process Auto children review their own calls. Out-of-process children retain their native permission systems after the parent delegation call is allowed.
- Unloading the integration while the application root stays active migrates live Auto Sessions to Full access. A persisted Auto Session cannot publish without the integration, even to switch presets.
- Mods can submit user-sourced text. The [Claude Code mods bridge](../../experimental/claude-code-mods/README.md#model-experience) gives both `$.prompt.submit` and `prompt.submit` hook context user authority, including framed submissions without `asUser: true`; text framing does not reduce that authority.
- The reviewer reads the Session action history through the deprecated synchronous `snapshotEvents()` reader under a line-scoped waiver. Prior calls, PTC starts, and the direct parent's initial prompt have no projection or paged reader yet, so the migration stays deferred by [the synchronous-read decision](../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
