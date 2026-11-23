/**
 * Human-interaction panels and the serialized answerer host: key handling,
 * custom and multi-select answers, aborts, focus restoration, and queueing.
 */

import { Container, TuiMainScreen, type Component } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { DecisionPanel, InteractionHost, TextAnswerPanel, asToolCallId, type InteractionHostOptions } from '../src/interactions.ts'
import { createPalette } from '../src/theme.ts'
import { FakeTerminal } from './fake-terminal.ts'

const palette = createPalette({ color: false })

/** Let the host's serialized queue mount the next panel. */
async function mounted(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** One captured interaction wiring. */
interface Harness {
  readonly host: InteractionHost
  readonly options: InteractionHostOptions
  readonly panel: Container
  top(): Component
  keys(data: string): void
  focused(): Component | null
  renders(): number
  restores(): number
}

function harness(): Harness {
  const panel = new Container()
  let focused: Component | null = null
  let renders = 0
  let restores = 0
  const base = new TuiMainScreen(new FakeTerminal())
  const tui = new Proxy(base, {
    get(target, property, receiver): unknown {
      if (property === 'setFocus') return (component: Component | null) => { focused = component }
      return Reflect.get(target, property, receiver)
    },
  })
  const options: InteractionHostOptions = {
    tui,
    panel,
    palette,
    requestRender: () => { renders += 1 },
    restoreFocus: () => { restores += 1; focused = null },
    onBusyChange: () => {},
  }
  const top = (): Component => {
    const child = panel.children[0]
    if (child === undefined) throw new Error('no panel is mounted')
    return child
  }
  return {
    host: new InteractionHost(options),
    options,
    panel,
    top,
    keys: (data: string) => { top().handleInput?.(data) },
    focused: () => focused,
    renders: () => renders,
    restores: () => restores,
  }
}

describe('decision panel', () => {
  it('renders numbered rows, selection, and hints', () => {
    const panel = new DecisionPanel(palette, 'Approve bash?', 'why', [{ label: 'Allow' }, { label: 'Reject', description: 'no' }])
    const lines = panel.render(60).join('\n')
    expect(lines).toContain('? Approve bash?')
    expect(lines).toContain('why')
    expect(lines).toContain('1. Allow')
    expect(lines).toContain('no')
    expect(lines).toContain('Enter confirm')
    panel.invalidate()
  })

  it('moves with arrows, j/k, and tab, then submits by number', () => {
    for (const key of ['\u001B[B', 'j', '\t']) {
      const results: unknown[] = []
      const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }, { label: 'b' }], false, false)
      panel.onSettle = (result) => { results.push(result) }
      panel.handleInput(key)
      panel.handleInput('2')
      expect(results).toEqual([{ kind: 'selected', labels: ['b'] }])
    }
    for (const key of ['\u001B[A', 'k', '\u001B[Z']) {
      const results: unknown[] = []
      const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }, { label: 'b' }], false, false)
      panel.onSettle = (result) => { results.push(result) }
      panel.handleInput(key)
      panel.handleInput('2')
      expect(results).toEqual([{ kind: 'selected', labels: ['b'] }])
    }
    const wraparound: unknown[] = []
    const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }, { label: 'b' }], false, false)
    panel.onSettle = (result) => { wraparound.push(result) }
    panel.handleInput('\u001B[A')
    panel.handleInput('\r')
    expect(wraparound).toEqual([{ kind: 'selected', labels: ['b'] }])
  })

  it('toggles a multi-select row by number and renders markers and the hint', () => {
    const results: unknown[] = []
    const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }, { label: 'b' }], true, true)
    panel.onSettle = (result) => { results.push(result) }
    panel.handleInput('1')
    const checked = panel.render(60).join('\n')
    expect(checked).toContain('x a')
    expect(checked).toContain('Space toggle')
    panel.handleInput('1')
    expect(panel.render(60).join('\n')).toContain('  a')
    panel.handleInput('\u001B[B')
    panel.handleInput('\u001B[B')
    panel.handleInput('\r')
    expect(results).toEqual([{ kind: 'custom', text: '' }])
  })

  it('invokes the default no-op settle handler when none is assigned', () => {
    const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }])
    expect(() => { panel.handleInput('\r') }).not.toThrow()
    const text = new TextAnswerPanel(palette, 't', '')
    expect(() => { text.handleInput('\r') }).not.toThrow()
  })

  it('toggles multi-select rows and ignores the custom row in the toggle', () => {
    const results: unknown[] = []
    const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }, { label: 'b' }], true, true)
    panel.onSettle = (result) => { results.push(result) }
    panel.handleInput(' ')
    panel.handleInput('\u001B[B')
    panel.handleInput(' ')
    panel.handleInput('\r')
    expect(results).toEqual([{ kind: 'selected', labels: ['a', 'b'] }])
  })

  it('aborts on escape and ctrl+c', () => {
    for (const key of ['\u001B', '\u0003']) {
      const results: unknown[] = []
      const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }])
      panel.onSettle = (result) => { results.push(result) }
      panel.handleInput(key)
      expect(results).toEqual([{ kind: 'aborted' }])
    }
  })

  it('reports the custom row as an empty custom request', () => {
    const results: unknown[] = []
    const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }], false, true)
    panel.onSettle = (result) => { results.push(result) }
    panel.handleInput('\u001B[B')
    panel.handleInput('\r')
    expect(results).toEqual([{ kind: 'custom', text: '' }])
  })

  it('ignores unknown keys and out-of-range digits', () => {
    const results: unknown[] = []
    const panel = new DecisionPanel(palette, 't', '', [{ label: 'a' }], false, false)
    panel.onSettle = (result) => { results.push(result) }
    panel.handleInput('9')
    panel.handleInput('x')
    expect(results).toEqual([])
  })
})

describe('text answer panel', () => {
  it('cancels typed text with ctrl+c', () => {
    const cancelled: (string | undefined)[] = []
    const panel = new TextAnswerPanel(palette, 'Which?', '')
    panel.onSettle = (value) => { cancelled.push(value) }
    panel.handleInput('\u0003')
    expect(cancelled).toEqual([undefined])
  })

  it('submits typed text and cancels with escape', () => {
    const submitted: (string | undefined)[] = []
    const panel = new TextAnswerPanel(palette, 'Which?', 'detail', 'placeholder')
    panel.onSettle = (value) => { submitted.push(value) }
    panel.handleInput('yes')
    panel.handleInput('\r')
    expect(submitted).toEqual(['yes'])
    const cancelled: (string | undefined)[] = []
    const other = new TextAnswerPanel(palette, 'Which?', '')
    other.onSettle = (value) => { cancelled.push(value) }
    other.handleInput('\u001B')
    expect(cancelled).toEqual([undefined])
    expect(other.render(40).join('\n')).not.toContain('detail')
    other.invalidate()
    const detailed = new TextAnswerPanel(palette, 'Which?', 'detail', 'placeholder')
    expect(detailed.render(40).join('\n')).toContain('detail')
  })
})

describe('interaction host', () => {
  it('accepts an approval from the default row and restores focus', async () => {
    const test = harness()
    const outcome = test.host.approve('bash', 'run the tests', undefined, undefined)
    await mounted()
    expect(test.focused()).toBe(test.top())
    test.keys('\r')
    await expect(outcome).resolves.toBe('allowed-once')
    expect(test.panel.children).toEqual([])
    expect(test.restores()).toBe(1)
    expect(test.renders()).toBeGreaterThan(1)
  })

  it('rejects from the second row and localizes the reason', async () => {
    const test = harness()
    const outcome = test.host.approve('bash', 'raw reason', { en: 'Localized reason' }, undefined)
    await mounted()
    expect(test.top().render(60).join('\n')).toContain('Localized reason')
    test.keys('\u001B[B')
    test.keys('\r')
    await expect(outcome).resolves.toBe('rejected')
  })

  it('reports cancellation for escape and for an already-aborted signal', async () => {
    const escaped = harness()
    const outcome = escaped.host.approve('bash', undefined, undefined, undefined)
    await mounted()
    escaped.keys('\u001B')
    await expect(outcome).resolves.toBe('cancelled')

    const controller = new AbortController()
    controller.abort()
    const pre = harness()
    await expect(pre.host.approve('bash', undefined, undefined, controller.signal)).resolves.toBe('cancelled')
    expect(pre.panel.children).toEqual([])

    const mid = harness()
    const pending = mid.host.approve('bash', undefined, undefined, controller.signal)
    await mounted()
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(mid.panel.children).toEqual([])
  })

  it('keeps option descriptions in the presented question', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Pick', options: [{ label: 'a', description: 'first' }] }], undefined)
    await mounted()
    expect(test.top().render(60).join('\n')).toContain('first')
    test.keys('\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['a'] }] })
  })

  it('cancels a mounted decision when its signal aborts', async () => {
    const controller = new AbortController()
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Pick', options: [{ label: 'a' }] }], controller.signal)
    await mounted()
    controller.abort()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [] }] })
    expect(test.panel.children).toEqual([])
  })

  it('cancels a mounted text answer when its signal aborts', async () => {
    const controller = new AbortController()
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Free?' }], controller.signal)
    await mounted()
    await mounted()
    controller.abort()
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [] }] })
  })

  it('skips a text question whose signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const test = harness()
    await expect(test.host.ask([{ id: 'q', question: 'Free?' }], controller.signal))
      .resolves.toEqual({ answers: [] })
    expect(test.panel.children).toEqual([])
  })

  it('settles only once even when a handler is invoked twice', async () => {
    const test = harness()
    const outcome = test.host.approve('bash', undefined, undefined, undefined)
    await mounted()
    const panel = test.top() as DecisionPanel
    panel.onSettle({ kind: 'selected', labels: ['Reject'] })
    panel.onSettle({ kind: 'selected', labels: ['Allow once'] })
    await expect(outcome).resolves.toBe('rejected')
    expect(test.restores()).toBe(1)

    // The text panel has the same single-settlement guard.
    const typed = harness()
    const answer = typed.host.ask([{ id: 'q', question: 'Free?' }], undefined)
    await mounted()
    await mounted()
    const text = typed.top() as TextAnswerPanel
    text.onSettle('first')
    text.onSettle('second')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'first' }] })
    expect(typed.restores()).toBe(1)
  })

  it('survives a mount failure and keeps later requests queueable', async () => {
    const base = new TuiMainScreen(new FakeTerminal())
    const failingTui = new Proxy(base, {
      get(target, property, receiver): unknown {
        if (property === 'setFocus') return () => { throw new Error('focus failed') }
        return Reflect.get(target, property, receiver)
      },
    })
    const failing = new InteractionHost({ ...harness().options, tui: failingTui })
    await expect(failing.approve('bash', undefined, undefined, undefined)).rejects.toThrow('focus failed')
    // The rejection was contained; the queue still accepts another request.
    await expect(failing.approve('bash', undefined, undefined, undefined)).rejects.toThrow('focus failed')
  })

  it('answers a single choice question', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Pick', options: [{ label: 'a' }, { label: 'b' }] }], undefined)
    await mounted()
    test.keys('\u001B[B')
    test.keys('\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['b'] }] })
  })

  it('answers a multi-select question', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Pick', multiSelect: true, options: [{ label: 'a' }, { label: 'b' }] }], undefined)
    await mounted()
    test.keys(' ')
    test.keys('\u001B[B')
    test.keys(' ')
    test.keys('\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: ['a', 'b'] }] })
  })

  it('collects a custom answer for a chosen option', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Pick', options: [{ label: 'a' }] }], undefined)
    await mounted()
    await mounted()
    test.keys('\u001B[B')
    test.keys('\r')
    await mounted()
    expect(test.top()).toBeInstanceOf(TextAnswerPanel)
    test.keys('custom')
    test.keys('\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'custom' }] })
  })

  it('asks free text when no options exist and reports an aborted question as skipped', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Free?', detail: 'more' }], undefined)
    await mounted()
    await mounted()
    expect(test.top()).toBeInstanceOf(TextAnswerPanel)
    test.keys('typed')
    test.keys('\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [], custom: 'typed' }] })

    const aborted = harness()
    const cancelled = aborted.host.ask([{ id: 'q', question: 'Free?' }], undefined)
    await mounted()
    aborted.keys('\u001B')
    await expect(cancelled).resolves.toEqual({ answers: [{ id: 'q', selected: [] }] })
  })

  it('cancels a free-text question with ctrl+c', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Free?' }], undefined)
    await mounted()
    await mounted()
    test.keys('\u0003')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [] }] })
  })

  it('treats a cancelled custom edit as a skipped question', async () => {
    const test = harness()
    const answer = test.host.ask([{ id: 'q', question: 'Pick', options: [{ label: 'a' }] }], undefined)
    await mounted()
    await mounted()
    test.keys('\u001B[B')
    test.keys('\r')
    await mounted()
    test.keys('\u001B')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q', selected: [] }] })
  })

  it('stops asking remaining questions after an abort', async () => {
    const controller = new AbortController()
    const test = harness()
    const answer = test.host.ask([
      { id: 'q1', question: 'First', options: [{ label: 'a' }] },
      { id: 'q2', question: 'Second', options: [{ label: 'b' }] },
    ], controller.signal)
    controller.abort()
    await expect(answer).resolves.toEqual({ answers: [] })
  })

  it('serializes two requests so the second mounts after the first settles', async () => {
    const test = harness()
    const first = test.host.approve('bash', undefined, undefined, undefined)
    await mounted()
    const second = test.host.ask([{ id: 'q', question: 'Later', options: [{ label: 'a' }] }], undefined)
    expect(test.top()).toBeInstanceOf(DecisionPanel)
    test.keys('\r')
    await expect(first).resolves.toBe('allowed-once')
    await Promise.resolve()
    expect(test.top()).toBeInstanceOf(DecisionPanel)
    test.keys('\r')
    await expect(second).resolves.toEqual({ answers: [{ id: 'q', selected: ['a'] }] })
  })

  it('brands a tool-call id unchanged', () => {
    expect(asToolCallId('call-1')).toBe('call-1')
  })
})
