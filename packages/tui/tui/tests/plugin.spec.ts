/**
 * Plugin acceptance: the real `apply` entry over a real Cordis tree, deferred
 * startup through `appReady`, the non-TTY refusal, and the exit path. The
 * renderer runs on the terminal double, so no PTY is required.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { AgentModel, modelSelectionProjectionDefinition, type Agent, type AgentHandle, type AgentStatus, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { internals } from '../src/internals.ts'
import { FakeTerminal } from './fake-terminal.ts'

const originalInternals = { ...internals }
const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  Object.assign(internals, originalInternals)
})

/** Let the deferred start and the renderer's frame timer run. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 120))
}

/** One booted plugin tree and its observable process effects. */
interface Bench {
  readonly ctx: Context
  readonly terminal: FakeTerminal
  readonly prompts: UserMessage[]
  flushed(): Session[]
  exitCode(): number | undefined
  stderr(): string
  ready(): void
  started(): boolean
  releaseCreate(): void
  agentSession(): Session | undefined
  disposed(): number
}

/** Boot options that force one failure or fallback path. */
interface BenchOptions {
  tty?: boolean
  startup?: Record<string, unknown>
  config?: Record<string, unknown>
  bareConfig?: boolean
  omitReady?: boolean
  omitLoader?: boolean
  omitFs?: boolean
  omitAgents?: boolean
  omitDefaultModel?: boolean
  omitSessions?: boolean
  omitAppExit?: boolean
  terminalError?: string
  createGate?: boolean
  resumeFactory?: (ctx: Context, id: SessionId) => Promise<AgentHandle>
}

/**
 * Boot `apply` over the real registries with a scripted Agent factory.
 * @param options - TTY facts, startup values, and forced failure paths.
 */
async function bench(options: BenchOptions = {}): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (options.omitAgents !== true) await ctx.plugin(AgentRegistry)
  if (options.omitDefaultModel !== true) await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  disposers.push(async () => { await ctx.fiber.dispose() })

  const prompts: UserMessage[] = []
  const flushed: Session[] = []
  const created: Session[] = []
  let disposedHandles = 0
  let exitCode: number | undefined
  let stderr = ''
  let readyListener: (() => void) | undefined
  let started = false
  const terminal = new FakeTerminal()
  let releaseCreate = (): void => {}
  const gate = options.createGate === true
    ? new Promise<void>((resolve) => { releaseCreate = resolve })
    : Promise.resolve()
  internals.stdinIsTty = () => options.tty !== false
  internals.stdoutIsTty = () => options.tty !== false
  internals.createTerminal = () => {
    if (options.terminalError !== undefined) throw options.terminalError
    started = true
    return terminal
  }
  internals.stderr = { write: (chunk: string) => { stderr += chunk; return true } }
  if (options.omitFs !== true) {
    ctx.provide('fs', {
      resolve: async () => ({ targetKey: process.cwd(), displayPath: process.cwd() }),
      processPath: () => process.cwd(),
    })
  }
  if (options.omitLoader !== true) ctx.provide('loader', { await: async () => {} })
  if (options.startup !== undefined) ctx.provide('tuiStartup', options.startup)

  if (options.omitAgents !== true) ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, createOptions: CreateAgentOptions): Promise<AgentHandle> {
      await gate
      const session = ctx.sessions.create(createOptions.sessionId, {
        ...createOptions.meta === undefined ? {} : { meta: createOptions.meta },
      })
      created.push(session)
      const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
      const agentOptions = createOptions.agentOptions ?? {}
      const agent: Agent = {
        id: session.id,
        options: agentOptions,
        model: new AgentModel(() => projection.stateOf(session), session, agentOptions),
        session,
        inbox: createInboxStub(),
        get status(): AgentStatus { return 'idle' },
        ctx: ownerCtx,
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: (message: UserMessage) => { prompts.push(message) },
        steer: (message: UserMessage) => { prompts.push(message) },
        inject: () => {},
        whenIdle: () => Promise.resolve(),
      }
      await createOptions.setup?.(ownerCtx, agent)
      await ctx.agents.register(agent)
      return { agent, dispose: async () => { disposedHandles += 1 } }
    },
    resume: (ownerCtx: Context, resumeOptions: { resumeSessionId: SessionId }) => options.resumeFactory === undefined
      ? Promise.reject(new Error('resume is not exercised here'))
      : options.resumeFactory(ownerCtx, resumeOptions.resumeSessionId),
  })

  provideCmdline(ctx, {
    args: [],
    exit: (code: number) => { exitCode = code },
    ...options.omitReady === true ? {} : {
      ready: {
        onReady: (listener: () => void) => {
          readyListener = listener
          return () => { readyListener = undefined }
        },
      },
    },
  })
  if (options.omitAppExit !== true) {
    if (options.bareConfig === true) apply(ctx, {})
    else {
      apply(ctx, {
        showReasoning: true,
        maxToolOutputLines: 4,
        color: false,
        title: 'DeepSeek Harness',
        ...options.config,
      })
    }
  }
  return {
    ctx,
    terminal,
    prompts,
    flushed: () => flushed,
    exitCode: () => exitCode,
    stderr: () => stderr,
    ready: () => { readyListener?.() },
    started: () => started,
    releaseCreate,
    agentSession: () => created.at(-1),
    disposed: () => disposedHandles,
  }
}

describe('terminal plugin', () => {
  it('refuses to mount without a launcher exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, {}) }).toThrow('must provide ctx.appExit')
  })

  it('starts only after readiness and renders the composer', async () => {
    const test = await bench()
    expect(test.started()).toBe(false)
    test.ready()
    await settle()
    expect(test.started()).toBe(true)
    expect(test.terminal.started).toBe(true)
    expect(test.terminal.visible()).toContain('Harness')
    await test.ctx.fiber.dispose()
  })

  it('refuses a non-interactive invocation and exits nonzero', async () => {
    const test = await bench({ tty: false })
    test.ready()
    await settle()
    expect(test.started()).toBe(false)
    expect(test.exitCode()).toBe(1)
    expect(test.stderr()).toContain('requires stdin and stdout to be interactive TTYs')
    await test.ctx.fiber.dispose()
  })

  it('submits a startup prompt on the live surface', async () => {
    const test = await bench({ startup: { prompt: 'explain the repo' } })
    test.ready()
    await settle()
    expect(test.prompts).toHaveLength(1)
    expect(JSON.stringify(test.prompts[0]?.content)).toContain('explain the repo')
    await test.ctx.fiber.dispose()
  })

  it('flushes the session and requests exit on Ctrl+D', async () => {
    const test = await bench({ startup: {} })
    test.ready()
    await settle()
    test.terminal.send('\u0004')
    await settle()
    expect(test.exitCode()).toBe(0)
    expect(test.terminal.started).toBe(false)
    await test.ctx.fiber.dispose()
  })

  it('immediately starts when no readiness service is mounted', async () => {
    const test = await bench({ omitReady: true })
    await settle()
    expect(test.started()).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('reports a non-Error terminal failure', async () => {
    const test = await bench({ terminalError: 'terminal exploded' })
    test.ready()
    await settle()
    expect(test.exitCode()).toBe(1)
    expect(test.stderr()).toContain('terminal exploded')
    expect(test.disposed()).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('reports a missing core service and a missing loader/fs fallback', async () => {
    const missing = await bench({ omitAgents: true })
    missing.ready()
    await settle()
    expect(missing.stderr()).toContain('required core services are not mounted')

    const defaults = await bench({ omitFs: true, omitLoader: true })
    defaults.ready()
    await settle()
    expect(defaults.started()).toBe(true)
    expect(defaults.terminal.visible()).toContain('Harness')
  })

  it('falls back to default surface configuration', async () => {
    const test = await bench({ bareConfig: true })
    test.ready()
    await settle()
    expect(test.started()).toBe(true)
    expect(test.terminal.visible()).toContain('Harness')
  })

  it('creates the configured session id and submits the configured prompt', async () => {
    const test = await bench({ config: { sessionId: 'session-from-config', prompt: 'config prompt' } })
    test.ready()
    await settle()
    expect(test.agentSession()?.id).toBe('session-from-config')
    expect(JSON.stringify(test.prompts[0]?.content)).toContain('config prompt')
  })

  it('applies a permission preset and an approval policy from startup values', async () => {
    const applied: string[] = []
    const test = await bench({ startup: { permissionMode: 'read-only', approvalPolicy: 'never' } })
    test.ctx.provide('permissionPresets', {
      resolve: () => {},
      current: () => 'read-only',
      set: (_session: Session, name: string) => { applied.push(name) },
    })
    test.ctx.provide('approval', { overrideOf: () => 'ask' })
    test.ready()
    await settle()
    expect(applied).toEqual(['read-only'])
    const session = test.agentSession()
    expect(session?.seq).toBeGreaterThan(0)
  })

  it('shows a configured welcome line on the surface', async () => {
    const test = await bench({ config: { welcome: 'Welcome from config' } })
    test.ready()
    await settle()
    expect(test.terminal.visible()).toContain('Welcome from config')
  })

  it('rejects a permission preset or approval policy without its service', async () => {
    const preset = await bench({ startup: { permissionMode: 'read-only' } })
    preset.ready()
    await settle()
    expect(preset.stderr()).toContain('requires the permissionPresets service')
    const policy = await bench({ startup: { approvalPolicy: 'never' } })
    policy.ready()
    await settle()
    expect(policy.stderr()).toContain('requires the approval service')
  })

  it('rethrows a non-Error query failure', async () => {
    const test = await bench({ startup: { resume: 'session-existing' } })
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the non-Error diagnostic fallback.
    test.ctx.provide('sessionQuery', { observeSession: () => Promise.reject('plain query failure') })
    test.ready()
    await settle()
    expect(test.exitCode()).toBe(1)
    expect(test.stderr()).toContain('plain query failure')

    const object = await bench({ startup: { resume: 'session-existing' } })
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the non-object failure fallback.
    object.ctx.provide('sessionQuery', { observeSession: () => Promise.reject({ reason: 'unexpected' }) })
    object.ready()
    await settle()
    expect(object.exitCode()).toBe(1)
  })

  it('disposes the handle when the initial run options fail', async () => {
    const test = await bench({ startup: { permissionMode: 'read-only' } })
    test.ctx.provide('permissionPresets', {
      resolve: () => {},
      current: () => 'read-only',
      set: () => { throw new Error('set failed') },
    })
    test.ready()
    await settle()
    expect(test.exitCode()).toBe(1)
    expect(test.stderr()).toContain('set failed')
    expect(test.disposed()).toBe(1)
  })

  it('disposes a resumed handle when its run options fail', async () => {
    let sets = 0
    const test = await bench({
      startup: { permissionMode: 'read-only' },
      resumeFactory: (ownerCtx: Context, id: SessionId) => ownerCtx.agents.create({ sessionId: id, meta: { cwd: process.cwd() } }),
    })
    test.ctx.provide('permissionPresets', {
      resolve: () => {},
      current: () => 'read-only',
      set: () => { sets += 1; if (sets === 2) throw new Error('set failed') },
    })
    test.ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve({ header: { cwd: process.cwd() }, events: [], [Symbol.dispose]: () => {} }),
    })
    test.ready()
    await settle()
    test.terminal.send('/resume session-resumed')
    test.terminal.send('\r')
    await settle()
    expect(sets).toBe(2)
    expect(test.terminal.visible()).toContain('resume failed: set failed')
    expect(test.disposed()).toBe(1)
  })

  it('rejects every non-adoptable persisted session', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ agentPreset: 'standard', cwd: process.cwd() }, 'runs under agent preset'],
      [{ origin: 'subagent', cwd: process.cwd() }, 'is a subagent session'],
      [{}, 'recorded no working directory'],
      [{ cwd: '/somewhere/else' }, 'was recorded in'],
    ]
    for (const [header, expected] of cases) {
      const test = await bench({ startup: { resume: 'session-existing' } })
      test.ctx.provide('sessionQuery', {
        observeSession: () => Promise.resolve({
          header,
          events: [],
          [Symbol.dispose]: () => {},
        }),
      })
      test.ready()
      await settle()
      expect(test.stderr()).toContain(expected)
    }
  })

  it('requires the query service for resume and rethrows its non-query failure', async () => {
    const missing = await bench({ startup: { resume: 'session-existing' } })
    missing.ready()
    await settle()
    expect(missing.stderr()).toContain('requires the sessionQuery service')

    const other = await bench({ startup: { resume: 'session-existing' } })
    other.ctx.provide('sessionQuery', { observeSession: () => Promise.reject(new Error('corpus broken')) })
    other.ready()
    await settle()
    expect(other.stderr()).toContain('corpus broken')
  })

  it('validates a preset before creating a session', async () => {
    const test = await bench({ startup: { permissionMode: 'unknown-preset' } })
    test.ctx.provide('permissionPresets', { resolve: () => { throw new Error('unknown preset') }, set: () => {} })
    test.ready()
    await settle()
    expect(test.exitCode()).toBe(1)
    expect(test.stderr()).toContain('unknown preset')
    expect(test.ctx.agents.list()).toEqual([])
  })

  it('reapplies the invocation preset and policy to a resumed session', async () => {
    const applied: string[] = []
    const test = await bench({
      startup: { permissionMode: 'read-only' },
      resumeFactory: (ownerCtx: Context, id: SessionId) => ownerCtx.agents.create({ sessionId: id, meta: { cwd: process.cwd() } }),
    })
    test.ctx.provide('permissionPresets', {
      resolve: () => {},
      current: () => 'read-only',
      set: (_session: Session, name: string) => { applied.push(name) },
    })
    test.ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve({ header: { cwd: process.cwd() }, events: [], [Symbol.dispose]: () => {} }),
    })
    test.ready()
    await settle()
    expect(applied).toEqual(['read-only'])
    test.terminal.send('/resume session-resumed')
    test.terminal.send('\r')
    await settle()
    expect(applied).toEqual(['read-only', 'read-only'])
  })

  it('resumes a persisted session through the in-process surface', async () => {
    const test = await bench({
      startup: {},
      resumeFactory: (ownerCtx: Context, id: SessionId) => ownerCtx.agents.create({ sessionId: id, meta: { cwd: process.cwd() } }),
    })
    test.ctx.provide('sessionQuery', {
      observeSession: () => Promise.resolve({
        header: { cwd: process.cwd() },
        events: [],
        [Symbol.dispose]: () => {},
      }),
    })
    test.ready()
    await settle()
    test.terminal.send('/resume session-resumed')
    test.terminal.send('\r')
    await settle()
    expect(test.terminal.visible()).toContain('Harness')
  })

  it('shuts down a surface that resolves after the tree closed', async () => {
    const test = await bench({ createGate: true })
    test.ready()
    await settle()
    expect(test.exitCode()).toBeUndefined()
    await test.ctx.fiber.dispose()
    test.releaseCreate()
    await settle()
    expect(test.stderr()).not.toContain('fatal')
  })

  it('rejects a resume id that has no persisted session', async () => {
    const test = await bench({ startup: { resume: 'session-missing' } })
    test.ctx.provide('sessionQuery', {
      observeSession: () => Promise.reject(new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')),
    })
    test.ready()
    await settle()
    expect(test.exitCode()).toBe(1)
    expect(test.stderr()).toContain('does not exist')
    await test.ctx.fiber.dispose()
  })
})
