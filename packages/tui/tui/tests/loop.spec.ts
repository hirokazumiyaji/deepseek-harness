/**
 * Real agent-loop acceptance: the surface drives a production Agent through
 * the mounted `dsh-agent-loop` with a scripted model adapter, so turn flow,
 * streaming frames, and the durable settlement all cross the real code.
 */

import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { TuiApp } from '../src/app.ts'
import { FakeTerminal } from './fake-terminal.ts'

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/** Keyless adapter: one reasoning block followed by one text answer. */
class ScriptedAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reasoning = 'Considering the request.'
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: reasoning }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: reasoning } }
    const text = 'The real loop answered this prompt.'
    yield { type: 'block-start', index: 1, blockType: 'text' }
    for (const word of text.split(' ')) {
      yield { type: 'text-delta', index: 1, text: `${word} ` }
    }
    yield { type: 'block-end', index: 1, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Poll until the predicate holds or the deadline passes. */
async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the surface')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('terminal surface over the real agent loop', () => {
  it('streams a reply produced by the production loop into the terminal', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['scripted'], new ScriptedAdapter())
    disposers.push(async () => { await ctx.fiber.dispose() })

    const handle = await ctx.agents.create({
      sessionId: brandString<SessionId>('session-loop-test'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'scripted', model: 'scripted' },
    })
    const terminal = new FakeTerminal()
    const app = new TuiApp({
      ctx,
      terminal,
      config: { showReasoning: true, maxToolOutputLines: 4, color: false, title: 'DeepSeek Harness', shutdownTimeoutMs: 10_000 },
      handle,
      exit: () => {},
      flush: async () => {},
      resume: () => Promise.reject(new Error('resume is not exercised here')),
    })
    disposers.push(async () => {
      app.stop()
      await handle.dispose()
    })
    app.start()
    await new Promise(resolve => setTimeout(resolve, 60))
    terminal.send('answer me')
    terminal.send('\r')
    await until(() => handle.agent.status === 'idle' && terminal.visible().includes('The real loop'))
    await new Promise(resolve => setTimeout(resolve, 60))
    const screen = terminal.visible()
    expect(screen).toContain('You')
    expect(screen).toContain('answer me')
    expect(screen).toContain('Assistant')
    expect(screen).toContain('The real loop answered this prompt.')
    expect(screen).toContain('21 in / 7 out')
    expect(screen).toContain('↑21')
    // The durable settlement replaced the live block instead of duplicating it.
    expect(screen.match(/Assistant/gu)?.length).toBe(1)
    // Committed transcript acceptance: the rendered surface, normalized for the
    // host working directory, is compared against owner-local expected output.
    const transcript = screen
      .split('\n')
      .map(line => line.replaceAll(process.cwd(), '<cwd>').replace(/\s+$/u, ''))
      .join('\n')
      .trimEnd()
    await expect(`${transcript}\n`).toMatchFileSnapshot('./expected/real-loop-transcript.txt')
  })
})
