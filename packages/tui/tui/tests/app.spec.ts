/**
 * Interactive-surface behavior: banner, presenters, submit routing, live
 * frames, teardown, Ctrl+C/D/L, foreign-event isolation, and in-process
 * session resume, all against real registries and the terminal double.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createToolResultMessage, createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppBench, settle } from './app-bench.ts'

const benches: Awaited<ReturnType<typeof createAppBench>>[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const bench of benches.splice(0)) {
    bench.app.stop()
    await bench.dispose()
  }
})

/** Build and start one surface, registering its teardown. */
async function started(options: Parameters<typeof createAppBench>[0] = {}) {
  const bench = await createAppBench(options)
  benches.push(bench)
  bench.start()
  await settle()
  return bench
}

/** Type one line and submit it, as two terminal reads like a real keyboard. */
function typeLine(bench: { terminal: { send(data: string): void } }, text: string): void {
  bench.terminal.send(text)
  bench.terminal.send('\r')
}

/** Build a second agent handle over a distinct session. */
async function otherHandle(bench: Awaited<ReturnType<typeof createAppBench>>, id: string): Promise<AgentHandle> {
  const session = bench.ctx.sessions.create(brandString<SessionId>(id), { meta: { cwd: process.cwd() } })
  const other: Agent = { ...bench.agent, id: session.id, session }
  return { agent: other, dispose: () => Promise.resolve() }
}

/** One live assistant frame helper. */
function frames(turn = 1, step = 1): {
  start: AssistantStreamFrame
  text: (text: string) => AssistantStreamFrame
  reasoning: (text: string) => AssistantStreamFrame
  end: (abandoned?: boolean) => AssistantStreamFrame
} {
  const attemptId = brandString('attempt') as never
  let revision = 1
  let index = 0
  return {
    start: { type: 'start', attemptId, revision: 1, turn, step },
    text: (text: string) => ({
      type: 'chunk', attemptId, revision: ++revision, index: index++, time: Date.now(),
      chunk: { type: 'text-delta', index: 0, text },
    }),
    reasoning: (text: string) => ({
      type: 'chunk', attemptId, revision: ++revision, index: index++, time: Date.now(),
      chunk: { type: 'reasoning-delta', index: 0, text },
    }),
    end: (abandoned = false) => ({
      type: 'end', attemptId, revision: ++revision, index,
      outcome: abandoned ? { kind: 'abandoned' } : { kind: 'committed', eventType: 'assistant/message', seq: 1 as never },
    }),
  }
}

describe('banner and presenters', () => {
  it('shows the session title, welcome line, or neither', async () => {
    const titled = await started({ title: 'Session title' })
    expect(titled.terminal.visible()).toContain('Session title')
    expect(titled.terminal.title).toContain('Session title')
    await titled.dispose()

    const welcome = await started({ config: { welcome: 'Welcome aboard' } })
    expect(welcome.terminal.visible()).toContain('Welcome aboard')
    expect(welcome.terminal.title).toContain('new session')

    const narrow = await createAppBench({ config: { welcome: 'A long welcome line that cannot fit' } })
    benches.push(narrow)
    narrow.terminal.columns = 40
    narrow.start()
    await settle()
    expect(narrow.terminal.visible()).toContain('A long')
  })

  it('escapes control characters in the terminal title', async () => {
    const bench = await started({ title: 'evil\u0007\u001B[2Jtitle' })
    expect(bench.terminal.title).toContain('\\x07')
    expect(bench.terminal.title).toContain('\\x1B[2J')
    expect(bench.terminal.title).not.toContain('\u0007')
    bench.session.append('session/title', {
      title: 'event\u0007\u001B]0;injected\u0007',
      messageSeqs: [],
      source: { kind: 'user' },
    })
    await settle()
    expect(bench.terminal.title).toContain('\\x07')
    expect(bench.terminal.title).not.toContain('\u0007')
  })

  it('uses a tool presentCall and presentResult when declared', async () => {
    const tools = {
      get: () => ({
        presentCall: () => ({ card: 'generic' as const, title: 'Presented call' }),
        presentResult: () => ({ card: 'generic' as const, title: 'Presented result' }),
      }),
    }
    const bench = await started({ tools })
    bench.session.append('tool/call', { turn: 1, step: 1, callId: brandString<ToolCallId>('c1'), name: 'bash', arguments: '{}' })
    await settle()
    expect(bench.terminal.visible()).toContain('Presented call')
    bench.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: brandString<ToolCallId>('c1'), content: [], isError: false }),
    }, { surfaceOp: 'append' })
    await settle()
    expect(bench.terminal.visible()).toContain('Presented result')
  })

  it('falls back when a tool declares no presenter or has no definition', async () => {
    const bench = await started({ tools: { get: () => ({}) } })
    bench.session.append('tool/call', { turn: 1, step: 1, callId: brandString<ToolCallId>('c1'), name: 'plain', arguments: '{}' })
    bench.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: brandString<ToolCallId>('c1'), content: [{ type: 'text', text: 'raw' }], isError: false }),
    }, { surfaceOp: 'append' })
    await settle()
    expect(bench.terminal.visible()).toContain('plain')
    const missing = await started({ tools: { get: () => undefined } })
    missing.session.append('tool/call', { turn: 1, step: 1, callId: brandString<ToolCallId>('c2'), name: 'absent', arguments: '{}' })
    await settle()
    expect(missing.terminal.visible()).toContain('absent')
  })

  it('falls back to a generic card when a presenter or its arguments throw', async () => {
    const tools = {
      get: () => ({
        presentCall: () => { throw new Error('boom') },
        presentResult: () => { throw new Error('boom') },
      }),
    }
    const bench = await started({ tools })
    bench.session.append('tool/call', { turn: 1, step: 1, callId: brandString<ToolCallId>('c1'), name: 'bash', arguments: '{' })
    bench.session.append('tool/call', { turn: 1, step: 1, callId: brandString<ToolCallId>('c2'), name: 'bash', arguments: '{}' })
    bench.session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: brandString<ToolCallId>('c2'), content: [], isError: false }),
    }, { surfaceOp: 'append' })
    await settle()
    expect(bench.terminal.visible()).toContain('bash')
  })
})

describe('startup', () => {
  it('submits a configured first prompt once and ignores a blank one', async () => {
    const bench = await started({ config: { initialPrompt: 'first prompt' } })
    expect(bench.prompts).toHaveLength(1)
    const blank = await started({ config: { initialPrompt: '   ' } })
    expect(blank.prompts).toHaveLength(0)
    bench.start()
    await settle()
    expect(bench.prompts).toHaveLength(1)
  })

  it('folds historical usage into the status line', async () => {
    const bench = await createAppBench()
    benches.push(bench)
    bench.session.append('turn/start', { turn: 1 })
    bench.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'done' }],
        source: { provider: 'p', model: 'm' },
      }),
      stream: [],
      usage: { inputTokens: 1500, outputTokens: 2000 },
    }, { surfaceOp: 'append' })
    bench.start()
    await settle()
    const screen = bench.terminal.visible()
    expect(screen).toContain('1.5k')
    expect(screen).toContain('2.0k')
  })
})

describe('composer routing', () => {
  it('submits ordinary text as a follow-up while idle', async () => {
    const bench = await started()
    bench.terminal.send('hello')
    typeLine(bench, '')
    await settle()
    expect(bench.prompts).toHaveLength(1)
    expect(bench.steered).toHaveLength(0)
  })

  it('steers while the agent runs', async () => {
    const bench = await started()
    bench.running = true
    bench.terminal.send('steer please')
    typeLine(bench, '')
    await settle()
    expect(bench.steered).toHaveLength(1)
    expect(bench.prompts).toHaveLength(0)
    expect(bench.terminal.visible()).toContain('Steering')
  })

  it('ignores blank input and input after exit begins', async () => {
    const bench = await started()
    typeLine(bench, '   ')
    await settle()
    expect(bench.prompts).toHaveLength(0)
    void bench.app.shutdown(0)
    await settle()
    typeLine(bench, 'too late')
    await settle()
    expect(bench.prompts).toHaveLength(0)
  })

  it('routes slash commands and treats a non-command slash line as a prompt', async () => {
    const bench = await started()
    typeLine(bench, '/help')
    await settle()
    expect(bench.terminal.visible()).toContain('Commands:')
    typeLine(bench, '/BadSyntax')
    await settle()
    expect(bench.prompts).toHaveLength(1)
  })

  it('clears and redraws through local commands', async () => {
    const bench = await started()
    typeLine(bench, 'first line')
    await settle()
    bench.terminal.reset()
    typeLine(bench, '/clear')
    await settle()
    expect(bench.terminal.visible()).not.toContain('first line')
    typeLine(bench, '/redraw')
    await settle()
    expect(bench.terminal.visible()).toContain('Harness')
  })

  it('selects a model through the host callback', async () => {
    const bench = await started()
    typeLine(bench, '/model other/model')
    await settle()
    expect(bench.agent.model.current()).toEqual({ provider: 'other', model: 'model' })
    expect(bench.terminal.visible()).toContain('other/model')
  })

  it('exits through the local exit command', async () => {
    const bench = await started()
    typeLine(bench, '/exit')
    await settle()
    expect(bench.exitCode).toBe(0)
  })
})

describe('live frames', () => {
  it('streams text and reasoning and ignores non-text chunk kinds', async () => {
    const bench = await started()
    const f = frames()
    const attemptId = brandString('attempt') as never
    const chunk = (revision: number, value: object): AssistantStreamFrame => ({
      type: 'chunk', attemptId, revision, index: revision, time: Date.now(), chunk: value as never,
    })
    bench.emitStream(f.start)
    bench.emitStream(f.reasoning('thinking'))
    bench.emitStream(f.text('streamed'))
    bench.emitStream(chunk(20, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }))
    bench.emitStream(chunk(21, { type: 'block-start', index: 0, blockType: 'text' }))
    bench.emitStream(chunk(22, { type: 'block-end', index: 0, block: { type: 'text', text: '' } }))
    bench.emitStream(chunk(23, { type: 'tool-call-delta', index: 0, argumentsDelta: '{}' }))
    bench.emitStream(chunk(24, { type: 'finish', reason: { kind: 'stop' } }))
    await settle()
    expect(bench.terminal.visible()).toContain('streamed')
    expect(bench.terminal.visible()).toContain('thinking')
    bench.emitStream(f.end())
    await settle()
    expect(bench.terminal.visible()).toContain('streamed')
  })

  it('ignores chunks and ends without a start and marks an abandoned end', async () => {
    const bench = await started()
    const f = frames()
    bench.emitStream(f.text('dropped'))
    bench.emitStream(f.end())
    await settle()
    expect(bench.terminal.visible()).not.toContain('dropped')
    bench.emitStream(f.start)
    bench.emitStream(f.text('partial'))
    bench.emitStream(f.end(true))
    await settle()
    expect(bench.terminal.visible()).toContain('Interrupted')
  })

  it('ticks the status timer while running and while idle', async () => {
    const bench = await started()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    await settle(600)
    expect(bench.terminal.visible()).toContain('working')
    bench.running = false
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'idle' })
    await settle(600)
    expect(bench.terminal.visible()).toContain('idle')
  })

  it('reports the running phase with and without an elapsed start', async () => {
    const bench = await started()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    await settle()
    expect(bench.terminal.visible()).toContain('working')
    bench.running = false
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'idle' })
    const f = frames(2, 2)
    bench.emitStream(f.start)
    await settle()
    expect(bench.terminal.visible()).toContain('working')
  })
})

describe('event isolation', () => {
  it('ignores session events from another session', async () => {
    const bench = await started()
    const other = bench.ctx.sessions.create(brandString<SessionId>('session-other'), { meta: { cwd: '/other' } })
    other.append('turn/start', { turn: 1 })
    other.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'foreign' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await settle()
    expect(bench.terminal.visible()).not.toContain('foreign')
  })

  it('delegates approvals and questions for another agent', async () => {
    const bench = await started()
    const foreign = { ...bench.agent, id: brandString<SessionId>('foreign-agent') }
    let approvals = 0
    let questions = 0
    bench.ctx.emit('approval/request', { agent: foreign, toolName: 'bash' }, () => {
      approvals += 1
      return Promise.resolve('rejected')
    })
    bench.ctx.emit('user-questions/request', { agent: foreign, questions: [] }, () => {
      questions += 1
      return Promise.resolve({ answers: [] })
    })
    bench.ctx.emit('user-questions/request', { questions: [{ id: 'q', question: 'Q', options: [{ label: 'a' }] }] }, () => {
      questions += 100
      return Promise.resolve({ answers: [] })
    })
    await settle()
    expect(approvals).toBe(1)
    expect(questions).toBe(1)
    // The agent-less question is answered by this surface.
    expect(bench.terminal.visible()).toContain('Q')
  })

  it('ignores a discarded message that was never suppressed', async () => {
    const bench = await started()
    bench.ctx.emit('agent/inbox/discarded', {
      agent: bench.agent,
      message: createUserMessage({ content: [], source: { kind: 'user' } }),
    })
    await settle()
    expect(bench.terminal.visible()).not.toContain('queued message discarded')
  })

  it('reports agent errors and discarded suppressed messages', async () => {
    const bench = await started()
    const foreign = { ...bench.agent, id: brandString<SessionId>('foreign-agent') }
    bench.ctx.emit('agent/error', { agent: bench.agent, turn: 1, step: 1, error: new Error('agent failed') })
    bench.ctx.emit('agent/error', { agent: bench.agent, turn: 1, step: 1, error: 'string failure' })
    bench.ctx.emit('agent/error', { agent: foreign, turn: 1, step: 1, error: new Error('foreign failure') })
    typeLine(bench, 'discard me')
    await settle()
    const message = bench.prompts.at(-1)
    if (message === undefined) throw new Error('no submitted message')
    bench.ctx.emit('agent/inbox/discarded', { agent: bench.agent, message })
    bench.ctx.emit('agent/inbox/discarded', { agent: bench.agent, message: createUserMessage({ content: [], source: { kind: 'user' } }) })
    bench.ctx.emit('agent/inbox/discarded', { agent: foreign, message })
    await settle()
    const screen = bench.terminal.visible()
    expect(screen).toContain('agent failed')
    expect(screen).toContain('string failure')
    expect(screen).not.toContain('foreign failure')
    expect(screen).toContain('queued message discarded')
  })

  it('ignores stream and status events for another agent', async () => {
    const bench = await started()
    const f = frames()
    const foreign = { ...bench.agent, id: brandString<SessionId>('foreign-agent') }
    bench.ctx.emit('agent/assistant-stream', { agent: foreign, frame: f.start })
    bench.ctx.emit('agent/status', { agent: foreign, status: 'running' })
    bench.emitStream(f.start)
    bench.emitStream(f.text('for us'))
    await settle()
    expect(bench.terminal.visible()).toContain('for us')
  })
})

describe('session updates', () => {
  it('renders a title event and refreshes a missing title at turn end', async () => {
    const titled = await started({ title: 'Service title' })
    titled.session.append('session/title', { title: 'Event title', messageSeqs: [], source: { kind: 'user' } })
    await settle()
    expect(titled.terminal.visible()).toContain('Event title')
    expect(titled.terminal.title).toContain('Event title')
    await titled.dispose()

    const fallback = await started({ title: 'Late service title' })
    fallback.session.append('turn/start', { turn: 2 })
    fallback.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await settle()
    expect(fallback.terminal.visible()).toContain('Late service title')
  })

  it('accumulates usage, renders errors, and reflows the plan', async () => {
    const bench = await started()
    bench.session.append('turn/start', { turn: 3 })
    bench.session.append('step/start', { turn: 3, step: 1 })
    bench.session.append('assistant/message', {
      turn: 3,
      step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'answer' }], source: { provider: 'p', model: 'm' } }),
      stream: [],
      usage: { inputTokens: 2_500_000, outputTokens: 1_200 },
    }, { surfaceOp: 'append' })
    bench.session.append('turn/end', { turn: 3, reason: { kind: 'error', error: { code: 'SERVER', message: 'failed' } } })
    bench.session.append('todo/write', { todos: [{ content: 'step', status: 'in_progress' }] })
    await settle()
    const screen = bench.terminal.visible()
    expect(screen).toContain('2.5M')
    expect(screen).toContain('1.2k')
    expect(screen).toContain('SERVER: failed')
    expect(screen).toContain('step')
  })

  it('keeps the plan visible across /clear and replaces it on resume', async () => {
    const bench = await createAppBench({
      resume: async (id) => {
        const handle = await otherHandle(bench, id)
        handle.agent.session.append('todo/write', { todos: [{ content: 'resumed-task', status: 'pending' }] })
        return handle
      },
    })
    benches.push(bench)
    bench.start()
    await settle()
    bench.session.append('todo/write', { todos: [{ content: 'first-task', status: 'pending' }] })
    await settle()
    expect(bench.terminal.visible()).toContain('first-task')
    typeLine(bench, '/clear')
    await settle()
    bench.session.append('todo/write', { todos: [{ content: 'after-clear', status: 'pending' }] })
    await settle()
    expect(bench.terminal.visible()).toContain('after-clear')
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.visible()).toContain('resumed-task')
    expect(bench.terminal.visible()).not.toContain('after-clear')
  })

  it('skips the rendered copy of a submitted message', async () => {
    const bench = await started()
    typeLine(bench, 'shown once')
    await settle()
    const message = bench.prompts.at(-1)
    if (message === undefined) throw new Error('no submitted message')
    bench.session.append('user/message', message, { surfaceOp: 'append' })
    await settle()
    expect(bench.terminal.visible().match(/shown once/gu)?.length).toBe(1)
  })
})

describe('permission modes', () => {
  interface PresetHarness {
    readonly applied: string[]
    currentValue(): string
    readonly service: {
      readonly names: string[]
      current: () => string
      resolve: (name: string) => { sandbox: string; approval: string }
      set: (session: Session, name: string) => void
    }
  }

  const presetHarness = (initial: string, names = ['read-only', 'workspace-write', 'danger-full-access', 'auto']): PresetHarness => {
    let current = initial
    const applied: string[] = []
    return {
      applied,
      currentValue: () => current,
      service: {
        names,
        current: () => current,
        resolve: name => ({
          sandbox: name === 'danger-full-access' || name === 'auto' ? 'danger-full-access' : name,
          approval: name === 'danger-full-access' ? 'never' : 'ask',
        }),
        set: (session, name) => {
          current = name
          applied.push(name)
          session.append('permission/preset', { preset: name })
        },
      },
    }
  }

  it('cycles a safe preset on Shift+Tab without a confirmation', async () => {
    const harness = presetHarness('read-only')
    const bench = await started({ permissionPresets: harness.service })
    bench.terminal.send('\x1b[Z')
    await settle()
    expect(bench.terminal.visible()).not.toContain('Enable Full access?')
    expect(harness.applied).toEqual(['workspace-write'])
    expect(bench.terminal.visible()).toContain('workspace-write')
  })

  it('confirms a full-access target and applies it when enabled', async () => {
    const harness = presetHarness('workspace-write')
    const bench = await started({ permissionPresets: harness.service })
    bench.terminal.send('\x1b[Z')
    await settle()
    expect(bench.terminal.visible()).toContain('Enable Full access?')
    expect(harness.applied).toEqual([])
    bench.terminal.send('2')
    await settle()
    expect(harness.applied).toEqual(['danger-full-access'])
  })

  it('keeps the current preset when the confirmation is cancelled', async () => {
    const harness = presetHarness('workspace-write')
    const bench = await started({ permissionPresets: harness.service })
    bench.terminal.send('\x1b[Z')
    await settle()
    bench.terminal.send('\r')
    await settle()
    expect(harness.applied).toEqual([])
    expect(bench.terminal.visible()).toContain('workspace-write')
  })

  it('routes the chosen preset through the permission command and announces Auto', async () => {
    const harness = presetHarness('danger-full-access')
    const lines: string[] = []
    const bench = await started({
      permissionPresets: harness.service,
      commands: {
        find: () => ({ name: 'permission' }),
        list: () => [],
        execute: (_agent, line) => {
          lines.push(line)
          return Promise.resolve({ commandId: 'c', result: { kind: 'success', text: 'preset auto' } })
        },
      },
    })
    bench.terminal.send('\x1b[Z')
    await settle()
    expect(bench.terminal.visible()).toContain('Enable Auto mode?')
    bench.terminal.send('2')
    await settle()
    expect(lines).toEqual(['/permission auto'])
    expect(bench.terminal.visible()).toContain('auto mode: each tool call is reviewed')
  })

  it('ignores a second cycle while the first switch is pending', async () => {
    const harness = presetHarness('read-only')
    const lines: string[] = []
    let release: ((value: unknown) => void) | undefined
    const bench = await started({
      permissionPresets: harness.service,
      commands: {
        find: () => ({ name: 'permission' }),
        list: () => [],
        execute: (_agent, line) => {
          lines.push(line)
          return new Promise((resolve) => { release = resolve })
        },
      },
    })
    bench.terminal.send('\x1b[Z')
    await settle()
    bench.terminal.send('\x1b[Z')
    await settle()
    expect(lines).toHaveLength(1)
    release?.({ commandId: 'c', result: { kind: 'success' } })
    await settle()
  })

  it('explains an absent preset service and a single selectable mode', async () => {
    const bare = await started()
    bare.terminal.send('\x1b[Z')
    await settle()
    expect(bare.terminal.visible()).toContain('this composition mounts no permission presets')
    const harness = presetHarness('read-only', ['read-only'])
    const single = await started({ permissionPresets: harness.service })
    single.terminal.send('\x1b[Z')
    await settle()
    expect(harness.applied).toEqual([])
  })

  it('marks Auto mode in the status line', async () => {
    const bench = await started({ permission: 'auto' })
    expect(bench.terminal.visible()).toContain('auto (reviewed)')
  })

  it('leaves Shift+Tab to a mounted decision panel', async () => {
    const harness = presetHarness('read-only')
    const bench = await started({ permissionPresets: harness.service })
    bench.ctx.emit('approval/request', { agent: bench.agent, toolName: 'bash' }, () => Promise.resolve('rejected'))
    await settle()
    expect(bench.terminal.visible()).toContain('Approve bash?')
    bench.terminal.send('\x1b[Z')
    await settle()
    expect(harness.applied).toEqual([])
    bench.terminal.send('\u001B')
    await settle()
  })
})

describe('keys and teardown', () => {
  it('interrupts a running turn and requires a second idle press to exit', async () => {
    const bench = await started()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    bench.terminal.send('\u0003')
    await settle()
    expect(bench.canceled).toBe(1)
    expect(bench.terminal.visible()).toContain('interrupted')
    bench.running = false
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'idle' })
    bench.terminal.send('\u0003')
    await settle()
    expect(bench.exitCode).toBeUndefined()
    expect(bench.terminal.visible()).toContain('press Ctrl+C again to exit')
    bench.terminal.send('\u0003')
    await settle()
    expect(bench.exitCode).toBe(0)
  })

  it('redraws on Ctrl+L and lets a mounted panel own the keyboard', async () => {
    const bench = await started()
    bench.terminal.send('\u000c')
    await settle()
    expect(bench.terminal.visible()).toContain('Harness')
    bench.ctx.emit('approval/request', { agent: bench.agent, toolName: 'bash' }, () => Promise.resolve('rejected'))
    await settle()
    expect(bench.terminal.visible()).toContain('Approve bash?')
    bench.terminal.send('\u0004')
    await settle()
    expect(bench.exitCode).toBeUndefined()
    bench.terminal.send('\u001B')
    await settle()
  })

  it('bounds the wait for a cancellation that never settles', async () => {
    const bench = await createAppBench({ neverIdle: true, config: { shutdownTimeoutMs: 20 } })
    benches.push(bench)
    bench.start()
    await settle()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    const startedAt = Date.now()
    await bench.app.shutdown(0)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(bench.canceled).toBe(1)
    expect(bench.exitCode).toBe(0)
    bench.releaseIdle()
  })

  it('cancels a running turn and flushes before exiting', async () => {
    const bench = await started()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    await bench.app.shutdown(0)
    expect(bench.canceled).toBe(1)
    expect(bench.flushed).toEqual([bench.session])
    expect(bench.exitCode).toBe(0)
    await bench.app.shutdown(0)
    expect(bench.exitCode).toBe(0)
  })

  it('reports a flush failure and a dispose failure without blocking exit', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const bench = await createAppBench({
      flush: () => Promise.reject(new Error('disk full')),
      dispose: () => Promise.reject(new Error('dispose failed')),
    })
    benches.push(bench)
    bench.start()
    await settle()
    await bench.app.shutdown(3)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('failed to flush the session'))
    expect(bench.exitCode).toBe(3)

    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the non-Error diagnostic fallback.
    const plain = await createAppBench({ flush: () => Promise.reject('plain flush failure') })
    benches.push(plain)
    plain.start()
    await settle()
    await plain.app.shutdown(0)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('plain flush failure'))
  })

  it('adopts a late title from the service at turn end', async () => {
    const bench = await createAppBench()
    benches.push(bench)
    let reads = 0
    bench.ctx.provide('sessionTitle', {
      get: () => {
        reads += 1
        return reads === 1 ? undefined : { title: 'Late event title' }
      },
    })
    bench.start()
    await settle()
    bench.session.append('turn/start', { turn: 6 })
    bench.session.append('turn/end', { turn: 6, reason: { kind: 'completed' } })
    await settle()
    expect(bench.terminal.visible()).toContain('Late event title')
  })

  it('keeps an empty title when the title service reports none at turn end', async () => {
    const bench = await started()
    bench.session.append('turn/start', { turn: 4 })
    bench.session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })
    await settle()
    expect(bench.terminal.title).toContain('new session')
  })

  it('reports a small token total and keeps a resumed session title', async () => {
    const bench = await createAppBench({
      title: 'Known title',
      resume: async id => otherHandle(bench, id),
    })
    benches.push(bench)
    bench.session.append('turn/start', { turn: 5 })
    bench.session.append('step/start', { turn: 5, step: 1 })
    bench.session.append('assistant/message', {
      turn: 5,
      step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'small' }], source: { provider: 'p', model: 'm' } }),
      stream: [],
      usage: { inputTokens: 5, outputTokens: 6 },
    }, { surfaceOp: 'append' })
    bench.start()
    await settle()
    expect(bench.terminal.visible()).toContain('↑5')
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.title).toContain('Known title')
  })
})

describe('session resume', () => {
  it('refuses while running and for the already-open session', async () => {
    const bench = await started()
    bench.running = true
    typeLine(bench, '/resume other')
    await settle()
    expect(bench.terminal.visible()).toContain('cannot resume another session while a turn is running')
    bench.running = false
    typeLine(bench, `/resume ${bench.agent.id}`)
    await settle()
    expect(bench.terminal.visible()).toContain('this session is already open')
  })

  it('blocks input and further switches while a resume is pending', async () => {
    let releaseResume: (() => void) | undefined
    let resumeCalls = 0
    const bench = await createAppBench({
      resume: (id) => {
        resumeCalls += 1
        return new Promise((resolve) => {
          releaseResume = () => { void otherHandle(bench, id).then(resolve) }
        })
      },
    })
    benches.push(bench)
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    typeLine(bench, 'typed during switch')
    await settle()
    expect(bench.prompts).toHaveLength(0)
    expect(bench.terminal.visible()).toContain('session switch is in progress')
    typeLine(bench, '/resume session-other-2')
    await settle()
    expect(bench.terminal.visible()).toContain('session switch is in progress')
    // The previous agent begins a turn while the swap is in flight; the swap
    // cancels it before disposing the handle.
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    releaseResume?.()
    await settle()
    expect(resumeCalls).toBe(1)
    expect(bench.canceled).toBe(1)
    expect(bench.terminal.visible()).not.toContain('resume failed')
  })

  it('disposes the opened session when the swap cannot proceed', async () => {
    let disposed = 0
    let releaseResume: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseResume = resolve })
    const bench = await createAppBench({
      neverIdle: true,
      config: { shutdownTimeoutMs: 20 },
      resume: async (id) => {
        await gate
        const handle = await otherHandle(bench, id)
        return { agent: handle.agent, dispose: async () => { disposed += 1; throw new Error('dispose failed') } }
      },
    })
    benches.push(bench)
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    releaseResume?.()
    await settle(150)
    expect(bench.terminal.visible()).toContain('resume failed')
    expect(bench.terminal.visible()).toContain('the opened session did not close cleanly: dispose failed')
    expect(disposed).toBe(1)
    bench.releaseIdle()
  })

  it('reports a non-Error disposal failure of an opened session', async () => {
    let releaseResume: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseResume = resolve })
    const bench = await createAppBench({
      neverIdle: true,
      config: { shutdownTimeoutMs: 20 },
      resume: async (id) => {
        await gate
        const handle = await otherHandle(bench, id)
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the non-Error diagnostic fallback.
        return { agent: handle.agent, dispose: () => Promise.reject('dispose failure') }
      },
    })
    benches.push(bench)
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    bench.running = true
    bench.ctx.emit('agent/status', { agent: bench.agent, status: 'running' })
    releaseResume?.()
    await settle(150)
    expect(bench.terminal.visible()).toContain('the opened session did not close cleanly: dispose failure')
    bench.releaseIdle()
  })

  it('reports a refresh failure after the swap without calling it a resume failure', async () => {
    const bench = await createAppBench({ resume: async id => otherHandle(bench, id) })
    benches.push(bench)
    bench.start()
    await settle()
    bench.terminal.setTitle = () => { throw new Error('title failed') }
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.visible()).toContain('session switched, but the surface failed to refresh: title failed')
    expect(bench.terminal.visible()).not.toContain('resume failed')
  })

  it('reports a non-Error disposal failure', async () => {
    const bench = await createAppBench({
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the non-Error diagnostic fallback.
      dispose: () => Promise.reject('close failed'),
      resume: async id => otherHandle(bench, id),
    })
    benches.push(bench)
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.visible()).toContain('previous session did not close cleanly: close failed')
  })

  it('reports a previous-session disposal failure separately from a resume failure', async () => {
    const bench = await createAppBench({
      dispose: () => Promise.reject(new Error('close failed')),
      resume: async id => otherHandle(bench, id),
    })
    benches.push(bench)
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.visible()).toContain('previous session did not close cleanly: close failed')
    expect(bench.terminal.visible()).not.toContain('resume failed')
  })

  it('swaps the agent and disposes the previous handle on success', async () => {
    let disposed = 0
    const bench = await createAppBench({
      dispose: () => { disposed += 1; return Promise.resolve() },
      resume: async id => otherHandle(bench, id),
    })
    benches.push(bench)
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    expect(disposed).toBe(1)
    expect(bench.terminal.visible()).toContain('Harness')
  })

  it('reports a resume failure for an error and a non-error rejection', async () => {
    const error = await started({ resume: () => Promise.reject(new Error('not adoptable')) })
    typeLine(error, '/resume session-broken')
    await settle()
    expect(error.terminal.visible()).toContain('resume failed: not adoptable')
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercises the non-Error diagnostic fallback.
    const plain = await started({ resume: () => Promise.reject('plain failure') })
    typeLine(plain, '/resume session-broken')
    await settle()
    expect(plain.terminal.visible()).toContain('resume failed: plain failure')
  })

  it('clears the banner subtitle when a resumed session has no title or welcome', async () => {
    const bench = await createAppBench({ resume: async id => otherHandle(bench, id) })
    benches.push(bench)
    const firstId = bench.agent.id
    bench.ctx.provide('sessionTitle', {
      get: (session: { id: SessionId }) => session.id === firstId ? { title: 'Starting title' } : undefined,
    })
    bench.start()
    await settle()
    expect(bench.terminal.visible()).toContain('Starting title')
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.title).toContain('new session')
    expect(bench.terminal.visible()).not.toContain('Starting title')
  })

  it('falls back to the welcome line when a resumed session has no title', async () => {
    const bench = await createAppBench({
      config: { welcome: 'Welcome back' },
      resume: async id => otherHandle(bench, id),
    })
    benches.push(bench)
    const firstId = bench.agent.id
    bench.ctx.provide('sessionTitle', {
      get: (session: { id: SessionId }) => session.id === firstId ? { title: 'Starting title' } : undefined,
    })
    bench.start()
    await settle()
    typeLine(bench, '/resume session-other')
    await settle()
    expect(bench.terminal.visible()).toContain('Welcome back')
    expect(bench.terminal.visible()).not.toContain('Starting title')
  })
})
