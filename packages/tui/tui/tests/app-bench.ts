/**
 * Interactive-surface bench: real registries, a scripted Agent, and a
 * terminal double, with the overrides each behavior test needs. Keeping one
 * fixture here prevents the per-file specs from drifting apart.
 * @module @deepseek-ai/dsh-tui/tests/app-bench
 */

import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentRegistry, { AgentModel, modelSelectionProjectionDefinition, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { TuiApp, type TuiAppConfig } from '../src/app.ts'
import { FakeTerminal } from './fake-terminal.ts'

/** Overrides one behavior test may need. */
export interface AppBenchOptions {
  readonly config?: Partial<TuiAppConfig>
  readonly cwd?: string | undefined
  /** Tools service value; omission leaves `ctx.get('tools')` undefined. */
  readonly tools?: unknown
  /** Session title reported by the mounted title service. */
  readonly title?: string | undefined
  /** Permission preset reported by the mounted preset service. */
  readonly permission?: string
  /** Permission-preset service stub used by Shift+Tab cycling. */
  readonly permissionPresets?: {
    readonly names: readonly string[]
    readonly current: () => string
    readonly resolve: (name: string) => { readonly sandbox: string; readonly approval: string }
    readonly set?: (session: Session, name: string) => void
  }
  /** Command registry stub; `find` decides whether `/permission` routes through it. */
  readonly commands?: {
    readonly find: (agent: Agent, name: string) => unknown
    readonly list: (agent: Agent) => readonly unknown[]
    readonly execute: (agent: Agent, line: string, args: readonly string[], signal: AbortSignal) => Promise<unknown>
  }
  /** Approval override reported by the mounted approval service. */
  readonly approvalOverride?: 'ask' | 'never' | undefined
  /** Agent handle the surface starts with. */
  readonly handle?: AgentHandle
  readonly resume?: (sessionId: SessionId) => Promise<AgentHandle>
  readonly flush?: (session: Session) => Promise<void>
  readonly dispose?: () => Promise<void>
  readonly exit?: (code: number) => void
  /** Mount the real approval service so `approval/request` resolves through this surface. */
  readonly mountApproval?: boolean
  /** Mount the real user-question service so `user-questions/request` resolves through this surface. */
  readonly mountQuestions?: boolean
  /** Leave the agent running forever so the shutdown bound is exercised. */
  readonly neverIdle?: boolean
}

/** One booted surface plus the controls a test drives. */
export interface AppBench {
  readonly ctx: Context
  readonly terminal: FakeTerminal
  readonly agent: Agent
  readonly session: Session
  readonly app: TuiApp
  readonly prompts: UserMessage[]
  readonly steered: UserMessage[]
  readonly flushed: Session[]
  running: boolean
  canceled: number
  exitCode: number | undefined
  start(): void
  settle(): Promise<void>
  dispose(): Promise<void>
  emitStream(frame: AssistantStreamFrame): void
  /** Release an agent whose idle wait was held open by `neverIdle`. */
  releaseIdle(): void
}

/** Let the renderer's coalesced frame timer run. */
export async function settle(ms = 60): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Build one bench. Nothing starts until {@link AppBench.start}; mounted
 * optional services are provided before the app captures its lookups.
 * @param options - behavior-specific overrides.
 */
export async function createAppBench(options: AppBenchOptions = {}): Promise<AppBench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  if (options.mountApproval === true) await ctx.plugin(ApprovalService, { policy: 'ask' })
  if (options.mountQuestions === true) await ctx.plugin(UserQuestionService)
  const sessionId = brandString<SessionId>('session-app-test')
  const session = ctx.sessions.create(sessionId, {
    meta: options.cwd === undefined ? {} : { cwd: options.cwd },
  })
  const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  const agentOptions = { provider: 'test-provider', model: 'test-model' }
  const prompts: UserMessage[] = []
  const steered: UserMessage[] = []
  const flushed: Session[] = []
  let releaseIdle: (() => void) | undefined
  const state = {
    running: false,
    canceled: 0,
    exitCode: undefined as number | undefined,
  }
  const agent: Agent = {
    id: session.id,
    options: agentOptions,
    model: new AgentModel(() => projection.stateOf(session), session, agentOptions),
    session,
    inbox: createInboxStub(),
    get status() { return state.running ? 'running' : 'idle' },
    ctx,
    cancel: () => { state.canceled += 1 },
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: (message: UserMessage) => { prompts.push(message) },
    steer: (message: UserMessage) => { steered.push(message) },
    inject: () => {},
    whenIdle: () => options.neverIdle === true ? new Promise<void>((resolve) => { releaseIdle = resolve }) : Promise.resolve(),
  }
  await ctx.agents.register(agent)
  if (options.tools !== undefined) ctx.provide('tools', options.tools)
  if (options.title !== undefined) ctx.provide('sessionTitle', { get: () => ({ title: options.title }) })
  if (options.permissionPresets !== undefined) {
    ctx.provide('permissionPresets', {
      ...options.permissionPresets,
      names: options.permissionPresets.names,
      current: options.permissionPresets.current,
      resolve: options.permissionPresets.resolve,
      set: options.permissionPresets.set ?? (() => {}),
    })
  } else if (options.permission !== undefined) {
    ctx.provide('permissionPresets', { current: () => options.permission })
  }
  if (options.commands !== undefined) ctx.provide('commands', options.commands)
  if (options.approvalOverride !== undefined) ctx.provide('approval', { overrideOf: () => options.approvalOverride })
  const terminal = new FakeTerminal()
  const handle = options.handle ?? { agent, dispose: () => options.dispose === undefined ? Promise.resolve() : options.dispose() }
  const app = new TuiApp({
    ctx,
    terminal,
    config: {
      showReasoning: true,
      maxToolOutputLines: 4,
      color: false,
      title: 'DeepSeek Harness',
      shutdownTimeoutMs: 10_000,
      ...options.config,
    },
    handle,
    exit: (code: number) => { state.exitCode = code; options.exit?.(code) },
    flush: async (target) => {
      flushed.push(target)
      await options.flush?.(target)
    },
    resume: options.resume ?? (() => Promise.reject(new Error('resume is not exercised here'))),
  })
  return {
    ctx,
    terminal,
    agent,
    session,
    app,
    prompts,
    steered,
    flushed,
    get running() { return state.running },
    set running(value: boolean) { state.running = value },
    get canceled() { return state.canceled },
    set canceled(value: number) { state.canceled = value },
    get exitCode() { return state.exitCode },
    set exitCode(value: number | undefined) { state.exitCode = value },
    start: () => { app.start() },
    settle: async () => { await settle() },
    dispose: async () => { await ctx.fiber.dispose() },
    emitStream: (frame: AssistantStreamFrame) => { ctx.emit('agent/assistant-stream', { agent, frame }) },
    releaseIdle: () => { releaseIdle?.() },
  }
}
