/**
 * Transcript projection: durable events and live frames become the rendered
 * blocks a terminal shows, through the same path for replay and live steps.
 */

import { Container, type Component } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  type ContentBlock,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { PlanPanel } from '../src/components.ts'
import { TranscriptView, type ToolPresenter } from '../src/transcript.ts'
import { createPalette, markdownThemeFor } from '../src/theme.ts'

const palette = createPalette({ color: false })

/** A presenter that labels every card so assertions see the source. */
const presenter: ToolPresenter = {
  presentCall: (name, rawArguments): ToolCallView | undefined => ({ card: 'generic', title: `call:${name}`, rawInput: rawArguments }),
  presentResult: (name, _rawArguments, result: ToolResult): ToolResultView | undefined => ({
    card: 'generic',
    title: `done:${name}:${result.isError ? 'error' : 'ok'}`,
  }),
}

/** Render a component tree to plain visible lines. */
function lines(component: Component, width = 80): string[] {
  const container = new Container()
  container.addChild(component)
  return container.render(width)
}

function transcript(): TranscriptView {
  return new TranscriptView({
    palette,
    markdownTheme: markdownThemeFor(palette),
    maxToolOutputLines: 2,
    showReasoning: true,
    presenter,
    plan: new PlanPanel(palette),
  })
}

/** Create one minimal session for event projection. */
async function session(): Promise<Session> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx.sessions.create(brandString<SessionId>('session-transcript-test'), { meta: { cwd: process.cwd() } })
}

describe('transcript projection', () => {
  it('starts empty and becomes populated', () => {
    const view = transcript()
    expect(view.isEmpty).toBe(true)
    view.notice('hello')
    expect(view.isEmpty).toBe(false)
    expect(view.plan).toBeDefined()
  })

  it('renders reasoning blocks from a settled assistant message', () => {
    const view = transcript()
    const message = createAssistantMessage({
      content: [
        { type: 'reasoning', text: 'because' },
        { type: 'text', text: 'answer' },
      ],
      source: { provider: 'test-provider', model: 'test-model' },
    })
    view.applyEvent({ type: 'assistant/message', data: { turn: 1, step: 1, message, stream: [] } } as never)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('because')
    expect(rendered).toContain('answer')
  })

  it('restarts a live step and finalizes an abandoned stream', () => {
    const view = transcript()
    view.streamStart(1, 1)
    view.streamDelta(1, 1, 'text', 'discarded')
    view.streamStart(1, 1)
    view.streamDelta(1, 1, 'text', 'again')
    view.streamEnd(1, 1, true)
    view.streamEnd(9, 9, false)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('again')
    expect(rendered).not.toContain('discarded')
    expect(rendered).toContain('Interrupted')
  })

  it('creates a live block on a delta without a start frame', () => {
    const view = transcript()
    view.streamDelta(2, 3, 'reasoning', 'late reasoning')
    expect(lines(view.container).join('\n')).toContain('late reasoning')
  })

  it('keeps streamed reasoning when the settlement has none and marks interruption', () => {
    const view = transcript()
    view.streamStart(1, 1)
    view.streamDelta(1, 1, 'reasoning', 'streamed')
    const settled = createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: { provider: 'test-provider', model: 'test-model' },
    })
    view.settleAssistant(1, 1, settled, 'done', true)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('streamed')
    expect(rendered).toContain('Interrupted')
    // A live step with no reasoning either receives the durable reasoning.
    const second = transcript()
    second.streamStart(1, 1)
    second.settleAssistant(1, 1, createAssistantMessage({
      content: [{ type: 'reasoning', text: 'durable reasoning' }, { type: 'text', text: 'x' }],
      source: { provider: 'test-provider', model: 'test-model' },
    }), '', false)
    expect(lines(second.container).join('\n')).toContain('durable reasoning')
  })

  it('renders a human prompt and one completed assistant reply', () => {
    const view = transcript()
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'Hello **world**' }],
      source: { provider: 'test-provider', model: 'test-model' },
    })
    view.applyEvent({ type: 'user/message', data: createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }) } as never)
    view.applyEvent({
      type: 'assistant/message',
      data: { turn: 1, step: 1, message, stream: [], usage: { inputTokens: 3, outputTokens: 4 } },
    } as never)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('You')
    expect(rendered).toContain('hi')
    expect(rendered).toContain('Assistant')
    expect(rendered).toContain('Hello')
    expect(rendered).toContain('world')
    expect(rendered).toContain('3 in / 4 out')
  })

  it('settles a streamed step in place instead of duplicating it', () => {
    const view = transcript()
    view.streamStart(1, 1)
    view.streamDelta(1, 1, 'reasoning', 'thinking')
    view.streamDelta(1, 1, 'text', 'partial ')
    view.streamDelta(1, 1, 'text', 'answer')
    view.streamEnd(1, 1, false)
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'partial answer' }],
      source: { provider: 'test-provider', model: 'test-model' },
    })
    view.applyEvent({ type: 'assistant/message', data: { turn: 1, step: 1, message, stream: [] } } as never)
    const rendered = lines(view.container).join('\n')
    expect(rendered.match(/Assistant/gu)?.length).toBe(1)
    expect(rendered).toContain('thinking')
    expect(rendered).toContain('partial answer')
  })

  it('renders a pending tool card and completes it with the presented result', () => {
    const view = transcript()
    const callId = brandString<ToolCallId>('call-1')
    view.applyEvent({ type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"ls"}' } } as never)
    expect(lines(view.container).join('\n')).toContain('call:bash')
    view.applyEvent({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'file.txt\nsecond\nthird' }], isError: false }),
      },
    } as never)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('done:bash:ok')
    expect(rendered).toContain('file.txt')
    expect(rendered).toContain('… 1 more line')
  })

  it('settles a step that was never streamed and skips a non-notice context message', () => {
    const view = transcript()
    view.settleAssistant(1, 1, createAssistantMessage({
      content: [{ type: 'text', text: 'unstreamed' }],
      source: { provider: 'test-provider', model: 'test-model' },
    }), '', true)
    view.applyEvent({
      type: 'user/message',
      data: createUserMessage({
        content: [{ type: 'text', text: 'instructions' }],
        source: { kind: 'model-selection' },
      }),
    } as never)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('unstreamed')
    expect(rendered).toContain('Interrupted')
    expect(rendered).not.toContain('instructions')
  })

  it('ignores a tool result for an unknown call and forwards presentation meta', () => {
    const view = transcript()
    const callId = brandString<ToolCallId>('call-with-meta')
    view.toolResult(callId, [{ type: 'text', text: 'ignored' }], false, undefined, undefined)
    view.applyEvent({ type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'bash', arguments: '{}' } } as never)
    view.applyEvent({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }], isError: false }),
        meta: { secret: true },
      },
    } as never)
    expect(lines(view.container).join('\n')).toContain('done:bash:ok')
  })

  it('ignores non-error turn ends and renders a notice-form context message', () => {
    const view = transcript()
    view.applyEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as never)
    view.applyEvent({
      type: 'user/message',
      data: createUserMessage({
        content: [{ type: 'text', text: 'injected' }],
        source: { kind: 'model-selection', form: 'notice', summary: 'compacted earlier context' },
      }),
    } as never)
    view.applyEvent({
      type: 'user/message',
      data: createUserMessage({ content: [], source: { kind: 'user-question-reply', callId: brandString<ToolCallId>('q'), outcome: 'answered' } }),
    } as never)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('compacted earlier context')
    expect(rendered).not.toContain('injected')
  })

  it('reports an error turn reason and keeps the standing plan', () => {
    const view = transcript()
    view.applyEvent({
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { code: 'SERVER', message: 'provider failed' } } },
    } as never)
    view.applyEvent({ type: 'todo/write', data: { todos: [{ content: 'do work', status: 'in_progress' }] } } as never)
    expect(lines(view.container).join('\n')).toContain('SERVER: provider failed')
    expect(lines(view.plan).join('\n')).toContain('do work')
  })

  it('rebuilds the same blocks from a session log', async () => {
    const source = await session()
    source.append('turn/start', { turn: 1 })
    source.append('step/start', { turn: 1, step: 1 })
    source.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const content: ContentBlock[] = [{ type: 'text', text: 'second' }]
    source.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({ content, source: { provider: 'test-provider', model: 'test-model' } }),
      stream: [],
    }, { surfaceOp: 'append' })
    const view = transcript()
    view.rebuild(source)
    const rendered = lines(view.container).join('\n')
    expect(rendered).toContain('first')
    expect(rendered).toContain('second')
  })
})
