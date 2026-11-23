/**
 * `@deepseek-ai/dsh-tui` — the interactive terminal front door. It mounts over
 * `dsh-base` like the one-shot runner, but keeps one Agent live and renders its
 * session in the terminal: streamed replies, tool cards, the standing plan,
 * approvals, the model's questions, slash commands, and `/resume`.
 *
 * The surface owns no agent lifecycle beyond the handle it creates or resumes;
 * it exits through the launcher's bounded request after restoring the terminal.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { APPROVAL_POLICIES, setApprovalPolicy, type ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Terminal } from '@earendil-works/pi-tui'
import { TuiApp, type TuiAppConfig } from './app.ts'
import { internals } from './internals.ts'
import type {} from './startup.ts'

/** Stable Cordis plugin name. */
export const name = 'tui'

/** Core services required before the terminal surface can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: invocation options for the terminal surface. */
export interface Config {
  /** Exact Session identity to open; omitted mints a fresh identity. */
  sessionId?: string
  /** Persisted Session identity to resume instead of creating one. */
  resume?: string
  /** Prompt submitted as the first turn once the surface is live. */
  prompt?: string
  /** Permission preset applied before the first prompt. */
  permissionMode?: string
  /** Approval behavior applied before the first prompt. */
  approvalPolicy?: ApprovalPolicy
  /** Extra banner line shown until the session has a title. */
  welcome?: string
  /** Render the model's reasoning blocks. */
  showReasoning?: boolean
  /** Collapsed tool-card output lines. */
  maxToolOutputLines?: number
  /** Apply the built-in ANSI palette. */
  color?: boolean
  /** Product suffix for the terminal window title. */
  title?: string
  /** Maximum wait in milliseconds for cancellation or session disposal during exit. */
  shutdownTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  sessionId: z.string(),
  resume: z.string(),
  prompt: z.string(),
  permissionMode: z.string(),
  approvalPolicy: z.union([...APPROVAL_POLICIES]),
  welcome: z.string(),
  showReasoning: z.boolean().default(true),
  maxToolOutputLines: z.number().default(6),
  color: z.boolean().default(true),
  title: z.string().default('DeepSeek Harness'),
  shutdownTimeoutMs: z.number().step(1).min(1).default(10000),
})

/** The Session facts that decide whether this surface may adopt a persisted log. */
interface AdoptableHeader {
  readonly cwd?: string | undefined
  readonly origin?: 'subagent' | undefined
  readonly agentPreset?: string | undefined
}

/** Reject a persisted Session this composition cannot continue faithfully. */
function assertAdoptable(header: AdoptableHeader, sessionId: SessionId, cwd: string): void {
  if (header.agentPreset !== undefined) {
    throw new Error(`session "${sessionId}" runs under agent preset "${header.agentPreset}", which the terminal surface does not compose`)
  }
  if (header.origin === 'subagent') {
    throw new Error(`session "${sessionId}" is a subagent session and cannot be driven directly`)
  }
  if (header.cwd === undefined) {
    throw new Error(`session "${sessionId}" recorded no working directory, so it cannot be resumed`)
  }
  if (header.cwd !== cwd) {
    throw new Error(`session "${sessionId}" was recorded in "${header.cwd}", not "${cwd}"`)
  }
}

/** Resolve the operational working directory through the mounted filesystem. */
async function resolveCwd(ctx: Context): Promise<string> {
  const fs = ctx.get('fs')
  if (fs === undefined) return process.cwd()
  return fs.processPath(await fs.resolve('.'))
}

/** Resolve the persisted identity named by `--resume`, rejecting an unknown one. */
async function resolvePersistedSession(ctx: Context, sessionId: SessionId, cwd: string): Promise<void> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('--resume requires the sessionQuery service; dsh-base provides it')
  }
  try {
    using observation = await query.observeSession(sessionId)
    assertAdoptable(observation.header, sessionId, cwd)
  } catch (error: unknown) {
    if (!isMissingSession(error)) throw error
    throw new Error(`session "${sessionId}" does not exist; omit --resume to start a new session`)
  }
}

/** Whether a query failure is the session-query service's not-found code. */
function isMissingSession(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'SESSION_QUERY_SESSION_NOT_FOUND'
}

/**
 * Compose the agent this surface drives.
 * @param ctx - plugin context carrying the registries.
 * @param selection - provider/model pair for later steps.
 * @param sessionId - exact identity to create or resume.
 * @param resume - whether the identity already exists.
 * @returns the owned agent handle.
 */
async function openAgent(
  ctx: Context,
  selection: ModelSelection,
  sessionId: SessionId,
  resume: boolean,
  cwd: string,
): Promise<AgentHandle> {
  const agents = ctx.get('agents')
  /* v8 ignore next -- run() resolves this service before opening the agent. */
  if (agents === undefined) throw new Error('tui: the agents registry is not mounted')
  const agentOptions = { ...selection }
  const setup = (agentCtx: Context): void => {
    installModelSelection(agentCtx)
  }
  return resume
    ? agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    : agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
}

/**
 * Mount the interactive terminal surface.
 * @param ctx - plugin context carrying core services and the launcher hooks.
 * @param config - validated invocation options.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui: the launcher must provide ctx.appExit before the tree mounts')
  }
  let app: TuiApp | undefined
  let closed = false

  const fail = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    internals.stderr.write(`dsh: ${message}\n`)
    exit(1)
  }

  const start = (): void => {
    void run(ctx, config, exit, (value) => {
      app = value
      /* v8 ignore next 3 -- a launcher unload between ready and agent creation. */
      if (closed) {
        void value.shutdown(0)
        return
      }
      value.start()
    }).catch((error: unknown) => {
      if (!closed) fail(error)
    })
  }

  const ready = ctx.get('appReady')
  if (ready === undefined) start()
  else ctx.effect(() => ready.onReady(start), 'tui: deferred start')

  // Unloading the tree (launcher shutdown, HMR, fatal boot elsewhere) must
  // restore the terminal before the process goes away.
  ctx.effect(() => () => {
    closed = true
    app?.stop()
  }, 'tui: terminal cleanup')
}

/**
 * Resolve the invocation, open its agent, and hand the live surface back.
 * @param ctx - plugin context.
 * @param config - validated invocation options.
 * @param exit - bounded process exit request from the launcher.
 * @param onReady - receives the live surface.
 */
async function run(
  ctx: Context,
  config: Config,
  exit: (code: number) => void,
  onReady: (app: TuiApp) => void,
): Promise<void> {
  if (!internals.stdinIsTty() || !internals.stdoutIsTty()) {
    throw new Error('the terminal surface requires stdin and stdout to be interactive TTYs; use `dsh --profile headless "task"` for automation')
  }
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error('tui: required core services are not mounted')
  }
  const startup = ctx.get('tuiStartup')
  const resumeId = startup?.resume ?? config.resume
  const requestedId = config.sessionId
  const cwd = await resolveCwd(ctx)
  const resume = resumeId !== undefined && resumeId.trim() !== ''
  const sessionId: SessionId = resume
    ? brandString<SessionId>(resumeId)
    : brandString<SessionId>(requestedId ?? `session-${randomUUID()}`)
  if (resume) await resolvePersistedSession(ctx, sessionId, cwd)

  const selection = defaultModel.currentSelection()
  const permissionMode = startup?.permissionMode ?? config.permissionMode
  const approvalPolicy = startup?.approvalPolicy ?? config.approvalPolicy
  const permissions = ctx.get('permissionPresets')
  const approval = ctx.get('approval')
  if (permissionMode !== undefined && permissions === undefined) {
    throw new Error('tui --permission-mode requires the permissionPresets service')
  }
  if (approvalPolicy !== undefined && approval === undefined) {
    throw new Error('tui --approval-policy requires the approval service')
  }

  // Validate invocation options before creating anything durable: an unknown
  // preset must not leave an empty Session behind.
  if (permissionMode !== undefined) permissions?.resolve(permissionMode)

  const applyRunOptions = (target: AgentHandle): void => {
    if (permissionMode !== undefined) permissions?.set(target.agent.session, permissionMode)
    if (approvalPolicy !== undefined && approval?.overrideOf(target.agent.session) !== approvalPolicy) {
      setApprovalPolicy(target.agent.session, approvalPolicy)
    }
  }
  const handle = await openAgent(ctx, selection, sessionId, resume, cwd)
  try {
    applyRunOptions(handle)
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }

  const resumeAgent = async (target: SessionId): Promise<AgentHandle> => {
    await resolvePersistedSession(ctx, target, cwd)
    const resumed = await openAgent(ctx, selection, target, true, cwd)
    try {
      applyRunOptions(resumed)
    } catch (error: unknown) {
      await resumed.dispose()
      throw error
    }
    return resumed
  }
  const initialPrompt = startup?.prompt ?? config.prompt
  const surfaceConfig: TuiAppConfig = {
    showReasoning: config.showReasoning ?? true,
    maxToolOutputLines: config.maxToolOutputLines ?? 6,
    color: config.color ?? true,
    title: config.title ?? 'DeepSeek Harness',
    shutdownTimeoutMs: config.shutdownTimeoutMs ?? 10000,
    ...config.welcome === undefined ? {} : { welcome: config.welcome },
    ...initialPrompt === undefined ? {} : { initialPrompt },
  }
  try {
    const terminal: Terminal = internals.createTerminal()
    const app = new TuiApp({
      ctx,
      terminal,
      config: surfaceConfig,
      handle,
      exit,
      flush: async (session: Session) => { await sessions.flush(session) },
      resume: resumeAgent,
    })
    onReady(app)
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }
}
