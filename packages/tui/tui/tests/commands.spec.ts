/**
 * Slash-command surface: dispatch precedence, local commands, model/resume
 * listing and selection, and every notice path.
 */

import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent/types'
import { createInboxStub, unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asSessionId, runCommandLine, type SlashCommandHost } from '../src/commands.ts'

let sharedCtx: Context
let sharedSession: Session
let noCwdSession: Session

beforeAll(async () => {
  sharedCtx = new Context()
  await sharedCtx.plugin(SessionStore)
  sharedSession = sharedCtx.sessions.create(brandString<SessionId>('session-command-test'), { meta: { cwd: '/work' } })
  noCwdSession = sharedCtx.sessions.create(brandString<SessionId>('session-command-no-cwd'))
})

afterAll(async () => {
  await sharedCtx.fiber.dispose()
})

/** The complete Agent surface with one configurable lifecycle fact. */
function fakeAgent(options: { status?: 'idle' | 'running' } = {}, session: Session = sharedSession): Agent {
  let status = options.status ?? 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    model: unsupportedModel(),
    session,
    inbox: createInboxStub(),
    get status() { return status },
    ctx: sharedCtx,
    cancel: () => { status = 'idle' },
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  }
  return agent
}

/** Recorded host effects. */
interface Hosted {
  readonly host: SlashCommandHost
  notices(): { level: string; text: string }[]
  exited(): boolean
  selected(): ModelSelection | undefined
  resumed(): string[]
  cleared(): number
  redraws(): number
}

function hosted(current?: ModelSelection): Hosted {
  const notices: { level: string; text: string }[] = []
  let exited = false
  let selected: ModelSelection | undefined
  const resumed: string[] = []
  let cleared = 0
  let redraws = 0
  const controller = new AbortController()
  return {
    host: {
      notice: (text, level) => { notices.push({ level, text }) },
      exit: () => { exited = true },
      selectModel: (selection) => { selected = selection },
      currentModel: () => current,
      resumeSession: async (id) => { resumed.push(id) },
      clearTranscript: () => { cleared += 1 },
      redraw: () => { redraws += 1 },
      signal: controller.signal,
    },
    notices: () => notices,
    exited: () => exited,
    selected: () => selected,
    resumed: () => resumed,
    cleared: () => cleared,
    redraws: () => redraws,
  }
}

/** A context carrying only the services a command resolves. */
function context(services: Record<string, unknown> = {}): Context {
  const ctx = new Context()
  for (const [name, value] of Object.entries(services)) ctx.provide(name, value)
  return ctx
}

const descriptors: CommandDescriptor[] = [
  { name: 'compact', description: 'Reduce context', input: { hint: '<focus>' } },
  { name: 'help', description: 'duplicate name is skipped' },
]

describe('command dispatch', () => {
  it('ignores a line that is not a command', async () => {
    const test = hosted()
    await expect(runCommandLine(context(), fakeAgent(), 'plain text', test.host)).resolves.toBe(false)
    expect(test.notices()).toEqual([])
  })

  it('prefers a registered command and renders its result', async () => {
    let executed = 0
    const execution: CommandExecution = { commandId: brandString('c1') as never, result: { kind: 'success', text: 'done' } }
    const ctx = context({
      commands: {
        find: () => ({ name: 'compact' }),
        list: () => descriptors,
        execute: async () => { executed += 1; return execution },
      },
    })
    const test = hosted()
    await expect(runCommandLine(ctx, fakeAgent(), '/compact now', test.host)).resolves.toBe(true)
    expect(executed).toBe(1)
    expect(test.notices()).toEqual([{ level: 'info', text: 'done' }])
  })

  it('accepts a silent registered success and reports a registered error', async () => {
    for (const [result, expected] of [
      [{ kind: 'success' } as const, undefined],
      [{ kind: 'error', text: 'nope' } as const, { level: 'error', text: 'nope' }],
    ] as const) {
      const ctx = context({
        commands: { find: () => ({}), list: () => [], execute: async () => ({ commandId: 'c', result }) },
      })
      const test = hosted()
      await runCommandLine(ctx, fakeAgent(), '/compact', test.host)
      expect(test.notices()).toEqual(expected === undefined ? [] : [expected])
    }
  })

  it('reports a registered name whose execution resolves undefined', async () => {
    const ctx = context({ commands: { find: () => ({}), list: () => [], execute: async () => undefined } })
    const test = hosted()
    await runCommandLine(ctx, fakeAgent(), '/compact', test.host)
    expect(test.notices()).toEqual([{ level: 'warning', text: 'unknown command: /compact' }])
  })

  it('lists local and registered commands with hints', async () => {
    const ctx = context({ commands: { find: () => undefined, list: () => descriptors, execute: async () => undefined } })
    const test = hosted()
    await runCommandLine(ctx, fakeAgent(), '/help', test.host)
    const text = test.notices()[0]?.text ?? ''
    expect(text).toContain('/help')
    expect(text).toContain('/compact <focus>')
    expect(text.match(/\/help/gu)?.length).toBe(1)
    expect(text).not.toContain('duplicate name is skipped')
  })

  it('lists local commands when no registry is mounted and shows a hintless registration', async () => {
    const noRegistry = hosted()
    await runCommandLine(context(), fakeAgent(), '/help', noRegistry.host)
    expect(noRegistry.notices()[0]?.text).toContain('/help')
    const registry = hosted()
    await runCommandLine(context({
      commands: { find: () => undefined, list: () => [{ name: 'goal', description: 'Manage goals' }], execute: async () => undefined },
    }), fakeAgent(), '/help', registry.host)
    expect(registry.notices()[0]?.text).toContain('/goal         Manage goals')
  })

  it('reports unset cwd, model, and title fallbacks', async () => {
    const test = hosted()
    const agent = fakeAgent({}, noCwdSession)
    const ctx = context({
      sessionTitle: { get: () => undefined },
      permissionPresets: { current: () => 'workspace-write' },
      approval: { overrideOf: () => undefined },
    })
    await runCommandLine(ctx, agent, '/status', test.host)
    const text = test.notices()[0]?.text ?? ''
    expect(text).toContain(process.cwd())
    expect(text).toContain('unset')
    expect(text).toContain('(untitled)')
    expect(text).toContain('ask')
  })

  it('reports a defined selection and effort', async () => {
    const test = hosted({ provider: 'p', model: 'm', reasoningEffort: brandString<ReasoningEffortId>('high') })
    await runCommandLine(context(), fakeAgent(), '/status', test.host)
    expect(test.notices()[0]?.text).toContain('p/m')
    expect(test.notices()[0]?.text).toContain('high')
  })

  it('exits through either spelling', async () => {
    for (const line of ['/exit', '/quit']) {
      const test = hosted()
      await runCommandLine(context(), fakeAgent(), line, test.host)
      expect(test.exited()).toBe(true)
    }
  })

  it('reports session facts with and without optional services', async () => {
    const full = hosted()
    const title = { title: 'A session' }
    const ctx = context({
      sessionTitle: { get: () => title },
      permissionPresets: { current: () => 'read-only' },
      approval: { overrideOf: () => 'never' },
    })
    await runCommandLine(ctx, fakeAgent(), '/status', full.host)
    const text = full.notices()[0]?.text ?? ''
    expect(text).toContain('A session')
    expect(text).toContain('read-only')
    expect(text).toContain('never')
    expect(text).toContain('/work')

    const bare = hosted()
    await runCommandLine(context(), fakeAgent({ status: 'running' }), '/status', bare.host)
    const bareText = bare.notices()[0]?.text ?? ''
    expect(bareText).toContain('(untitled)')
    expect(bareText).toContain('unknown')
    expect(bareText).toContain('ask')
    expect(bareText).toContain('running')
  })

  it('clears and redraws, and warns on an unknown command', async () => {
    const test = hosted()
    await runCommandLine(context(), fakeAgent(), '/clear', test.host)
    await runCommandLine(context(), fakeAgent(), '/redraw', test.host)
    await runCommandLine(context(), fakeAgent(), '/nope', test.host)
    expect(test.cleared()).toBe(1)
    expect(test.redraws()).toBe(1)
    expect(test.notices().at(-1)).toEqual({ level: 'warning', text: 'unknown command: /nope — try /help' })
  })
})

describe('model command', () => {
  const rows = [
    { provider: 'deepseek', id: 'flash', name: 'Flash' },
    { provider: 'deepseek', id: 'pro', name: 'Pro' },
    { provider: 'local', id: 'flash', name: 'Flash' },
  ]
  const llm = {
    listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'local', name: 'Local' }, { id: 'broken', name: 'Broken' }],
    listModels: async (provider: string) => {
      if (provider === 'broken') throw new Error('catalog unavailable')
      return rows.filter(row => row.provider === provider).map(({ id, name }) => ({ id, name }))
    },
  }

  it('lists advertised models and the current route', async () => {
    const test = hosted({ provider: 'deepseek', model: 'flash' })
    await runCommandLine(context({ llm }), fakeAgent(), '/model', test.host)
    const text = test.notices()[0]?.text ?? ''
    expect(text).toContain('deepseek/flash')
    expect(text).toContain('current: deepseek/flash')
  })

  it('warns when no llm service is mounted', async () => {
    const test = hosted()
    await runCommandLine(context(), fakeAgent(), '/model', test.host)
    expect(test.notices()[0]?.level).toBe('warning')
  })

  it('lists rows whose name equals the id and omits the current line', async () => {
    const test = hosted()
    const llmEqual = { listProviders: () => [{ id: 'solo', name: 'Solo' }], listModels: async () => [{ id: 'solo', name: 'solo' }] }
    await runCommandLine(context({ llm: llmEqual }), fakeAgent(), '/model', test.host)
    const text = test.notices()[0]?.text ?? ''
    expect(text).toContain('solo/solo')
    expect(text).not.toContain('current:')
  })

  it('omits the effort when a same-provider id is selected without one', async () => {
    const test = hosted({ provider: 'deepseek', model: 'flash' })
    await runCommandLine(context({ llm }), fakeAgent(), '/model pro', test.host)
    expect(test.selected()).toEqual({ provider: 'deepseek', model: 'pro' })
  })

  it('selects a unique id from another provider and omits an absent effort', async () => {
    const test = hosted({ provider: 'deepseek', model: 'flash' })
    const llmUnique = {
      listProviders: () => [{ id: 'deepseek' }, { id: 'other' }],
      listModels: async (provider: string) => provider === 'deepseek'
        ? [{ id: 'flash', name: 'Flash' }]
        : [{ id: 'unique', name: 'Unique' }],
    }
    await runCommandLine(context({ llm: llmUnique }), fakeAgent(), '/model unique', test.host)
    expect(test.selected()).toEqual({ provider: 'other', model: 'unique' })
  })

  it('warns when the deployment advertises no routable model', async () => {
    const test = hosted()
    await runCommandLine(context({ llm: { listProviders: () => [], listModels: async () => [] } }), fakeAgent(), '/model', test.host)
    expect(test.notices()[0]?.level).toBe('warning')
  })

  it('selects an explicit provider route without catalog validation', async () => {
    const test = hosted()
    await runCommandLine(context({ llm }), fakeAgent(), '/model anything/whatever', test.host)
    expect(test.selected()).toEqual({ provider: 'anything', model: 'whatever' })
  })

  it('selects a unique model id and keeps the current effort', async () => {
    const test = hosted({ provider: 'deepseek', model: 'flash', reasoningEffort: brandString<ReasoningEffortId>('high') })
    await runCommandLine(context({ llm }), fakeAgent(), '/model pro', test.host)
    expect(test.selected()).toEqual({ provider: 'deepseek', model: 'pro', reasoningEffort: 'high' })
  })

  it('falls back to the only provider for an unlisted id', async () => {
    const test = hosted()
    const single = { listProviders: () => [{ id: 'solo', name: 'Solo' }], listModels: async () => [{ id: 'known', name: 'Known' }] }
    await runCommandLine(context({ llm: single }), fakeAgent(), '/model unknown-id', test.host)
    expect(test.selected()).toEqual({ provider: 'solo', model: 'unknown-id' })
  })

  it('warns when no route matches', async () => {
    const test = hosted()
    await runCommandLine(context({ llm }), fakeAgent(), '/model missing', test.host)
    expect(test.notices()[0]).toEqual({ level: 'warning', text: 'no model matches "missing"' })
  })
})

describe('resume command', () => {
  it('resumes an explicit id', async () => {
    const test = hosted()
    await runCommandLine(context(), fakeAgent(), '/resume session-9', test.host)
    expect(test.resumed()).toEqual(['session-9'])
  })

  it('lists recent sessions with titles, clipping the list', async () => {
    const records: SessionRecord[] = Array.from({ length: 12 }, (_, index) => {
      const session = sharedCtx.sessions.create(brandString<SessionId>(`s-${index}`), { meta: { cwd: `/w/${index}` } })
      return { header: session.header, live: false, persisted: true }
    })
    const observations = (ids: readonly SessionId[]): SessionTitleObservationResult[] => ids.map((sessionId, index) =>
      index === 0
        ? { sessionId, status: 'rejected', reason: new Error('unreadable') }
        : { sessionId, status: 'fulfilled', value: { session: {} as never, title: { title: `title-${index}` } as never } })
    const ctx = context({
      sessionQuery: {
        listSessions: async () => records,
        readTitleSnapshots: async (ids: readonly SessionId[]) => observations(ids),
      },
    })
    const test = hosted()
    await runCommandLine(ctx, fakeAgent(), '/resume', test.host)
    const text = test.notices()[0]?.text ?? ''
    expect(text).toContain('(untitled)')
    expect(text).toContain('title-1')
    expect(text).toContain('s-9')
    expect(text).not.toContain('s-10')
    // A record with no recorded directory reports the absence rather than guessing.
    const noCwd = hosted()
    await runCommandLine(context({
      sessionQuery: {
        listSessions: async () => [{ header: sharedCtx.sessions.create(brandString<SessionId>('s-x')).header, live: false, persisted: true }],
        readTitleSnapshots: async () => [{ sessionId: brandString<SessionId>('s-x'), status: 'fulfilled', value: { session: sharedCtx.sessions.create(brandString<SessionId>('s-x')).header } }],
      },
    }), fakeAgent(), '/resume', noCwd.host)
    expect(noCwd.notices()[0]?.text).toContain('(no recorded cwd)')
  })

  it('keeps ids when the title scan is cancelled', async () => {
    const ctx = context({
      sessionQuery: {
        listSessions: async () => [{ header: { id: 's-1', cwd: '/w' } }],
        readTitleSnapshots: async () => { throw new Error('cancelled') },
      },
    })
    const test = hosted()
    await runCommandLine(ctx, fakeAgent(), '/resume', test.host)
    expect(test.notices()[0]?.text).toContain('s-1')
    expect(test.notices()[0]?.text).toContain('(untitled)')
  })

  it('reports an empty corpus and a missing query service', async () => {
    const empty = hosted()
    await runCommandLine(context({ sessionQuery: { listSessions: async () => [] } }), fakeAgent(), '/resume', empty.host)
    expect(empty.notices()[0]).toEqual({ level: 'info', text: 'no persisted sessions' })

    const missing = hosted()
    await runCommandLine(context(), fakeAgent(), '/resume', missing.host)
    expect(missing.notices()[0]?.level).toBe('error')
  })

  it('brands a session id unchanged', () => {
    expect(asSessionId('session-x')).toBe('session-x')
  })
})
