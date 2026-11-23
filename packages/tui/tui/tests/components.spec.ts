/**
 * Presentation components: every visual role, card shape, badge, and narrow
 * layout renders without exceeding the viewport.
 */

import { describe, expect, it } from 'vitest'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  AssistantBlock,
  Notice,
  PlanPanel,
  RoleHeader,
  StatusBar,
  ToolCard,
  UserPrompt,
  type StatusState,
} from '../src/components.ts'
import { createPalette, displayInlineText, displayText, editorThemeFor, markdownThemeFor } from '../src/theme.ts'

const plain = createPalette({ color: false })
const colored = createPalette({ color: true })
const theme = markdownThemeFor(colored)

/** Render one component at a width and assert nothing exceeds it. */
function render(component: { render(width: number): string[] }, width = 60): string[] {
  const lines = component.render(width)
  for (const line of lines) {
    // Strip ANSI for a display-width approximation used by these components.
    expect(line.replace(/\u001B\[[0-9;]*m/gu, '').length).toBeLessThanOrEqual(width)
  }
  return lines
}

describe('theme', () => {
  it('renders identity functions when color is disabled', () => {
    for (const role of ['dim', 'accent', 'brand', 'success', 'error', 'warning', 'bold', 'italic', 'underline', 'inverse'] as const) {
      expect(plain[role]('x')).toBe('x')
    }
  })

  it('wraps every role in SGR when color is enabled', () => {
    for (const role of ['dim', 'accent', 'brand', 'success', 'error', 'warning', 'bold', 'italic', 'underline', 'inverse'] as const) {
      expect(colored[role]('x')).toMatch(/^\u001B\[[0-9;]+mx\u001B\[0m$/u)
    }
  })

  it('derives a theme whose functions all style text', () => {
    const keys = Object.keys(theme) as (keyof typeof theme)[]
    for (const key of keys) {
      const value = theme[key]
      if (typeof value === 'function') expect(value('x', undefined as never)).toContain('x')
    }
  })

  it('derives an editor theme whose select-list roles all style text', () => {
    const theme = editorThemeFor(colored)
    expect(theme.borderColor('x')).toContain('x')
    for (const key of ['selectedPrefix', 'selectedText', 'description', 'scrollInfo', 'noMatch'] as const) {
      expect(theme.selectList[key]('x')).toContain('x')
    }
  })

  it('escapes control characters and folds line feeds per helper', () => {
    expect(displayText('a\u0000b\u001B[31mc')).toBe('a\\x00b\\x1B[31mc')
    expect(displayInlineText('a\nb\r\nc\td')).toBe('a b c\td')
  })
})

describe('layout edges', () => {
  it('renders zero-width viewports and blank paragraphs', () => {
    expect(new RoleHeader(plain, 'You').render(0)).toEqual([])
    expect(new UserPrompt(plain, 'a\n\nb').render(10)).toEqual(['You', 'a', '', 'b'])
    expect(new UserPrompt(plain, 'x').render(0)).toEqual([''])
    // A fresh block renders at zero width through the empty-title fallbacks.
    expect(new AssistantBlock(colored, theme, '', { showReasoning: true }).render(0).length).toBeGreaterThan(0)
    const reasoned = new AssistantBlock(colored, theme, '', { showReasoning: true })
    reasoned.setText('x')
    reasoned.setReasoning('why')
    reasoned.render(1)
    expect(reasoned.render(0).length).toBeGreaterThan(0)
  })
})

describe('role header', () => {
  it('renders with and without trailing metadata', () => {
    expect(render(new RoleHeader(plain, 'You'))).toEqual(['You'])
    const withTrailing = render(new RoleHeader(plain, 'Assistant', '1.2s'))
    expect(withTrailing[0]).toContain('Assistant')
    expect(withTrailing[0]?.endsWith('1.2s')).toBe(true)
    const header = new RoleHeader(plain, 'You')
    header.setLabel('Steering')
    header.setTrailing('queued')
    expect(header.render(40)[0]).toContain('Steering')
    header.invalidate()
  })

  it('collapses to one line when the metadata does not fit', () => {
    const lines = render(new RoleHeader(plain, 'Assistant', 'a very long trailing note'), 12)
    expect(lines).toHaveLength(1)
  })
})

describe('user message', () => {
  it('renders a role header and wrapped body, and can be replaced', () => {
    const message = new UserPrompt(plain, 'hello world')
    expect(render(message, 40).join('\n')).toContain('hello world')
    message.setText('replaced')
    expect(render(message, 40).join('\n')).toContain('replaced')
    message.invalidate()
    expect(render(new UserPrompt(plain, 'steer', 'Steering'), 40)[0]).toBe('Steering')
  })
})

describe('assistant block', () => {
  it('renders reasoning, text, and settlement metadata', () => {
    const block = new AssistantBlock(colored, theme, 'streaming…', { showReasoning: true })
    block.setText('answer')
    block.setReasoning('thinking')
    block.setTrailing('done')
    const lines = render(block, 50).join('\n')
    expect(lines).toContain('Assistant')
    expect(lines).toContain('Reasoning')
    expect(lines).toContain('thinking')
    expect(lines).toContain('answer')
    expect(lines).toContain('done')
    block.invalidate()
    // A second frame at the same width uses the cached lines.
    expect(block.render(50)).toEqual(block.render(50))
  })

  it('omits reasoning when disabled and marks interruption and empty output', () => {
    const block = new AssistantBlock(plain, markdownThemeFor(plain), '', { showReasoning: false })
    block.setReasoning('hidden')
    block.setInterrupted()
    const lines = render(block, 40).join('\n')
    expect(lines).not.toContain('Reasoning')
    expect(lines).not.toContain('hidden')
    expect(lines).toContain('Interrupted')
    expect(lines).toContain('(no output)')
  })

  it('shows an ellipsis while empty and not interrupted', () => {
    const block = new AssistantBlock(plain, markdownThemeFor(plain), '', { showReasoning: true })
    expect(render(block, 40)).toContain('…')
  })
})

describe('tool card', () => {
  const genericCall: ToolCallView = { card: 'generic', title: 'Read a file', kind: 'read', rawInput: { path: 'a.txt' } }

  it('renders a pending generic card with object input', () => {
    const card = new ToolCard(colored, 'read', '{"path":"a.txt"}', genericCall, 4)
    const lines = render(card, 50)
    expect(lines[0]).toContain('Read a file')
    expect(lines.join('\n')).toContain('path')
  })

  it('renders a pending generic card with string input and fallback title', () => {
    const stringInput = new ToolCard(plain, 'custom', '', { card: 'generic', title: 'Custom', rawInput: 'raw text' }, 4)
    expect(render(stringInput, 40).join('\n')).toContain('raw text')
    const fallback = new ToolCard(plain, 'custom', '{"a":1}', undefined, 4)
    expect(render(fallback, 40)[0]).toContain('custom {"a":1}')
    const empty = new ToolCard(plain, 'custom', '  ', undefined, 4)
    expect(render(empty, 40)[0]).toContain('custom')
  })

  it('renders a terminal card with cwd, output, truncation, and exit status', () => {
    const card = new ToolCard(colored, 'bash', '{}', { card: 'terminal', title: 'ls', cwd: '/tmp' }, 2)
    const result: ToolResultView = { card: 'terminal', output: 'one\ntwo\nthree', exitCode: 0 }
    card.setResult(result, 'one\ntwo\nthree')
    const lines = render(card, 50).join('\n')
    expect(lines).toContain('/tmp')
    expect(lines).toContain('one')
    expect(lines).toContain('… 1 more line')
    expect(lines).toContain('exit 0')
  })

  it('renders a terminal signal and replacement title', () => {
    const card = new ToolCard(plain, 'bash', '{}', { card: 'terminal', title: 'ls' }, 4)
    card.setResult({ card: 'terminal', title: 'ls (killed)', signal: 'SIGTERM', output: '' }, '')
    const lines = render(card, 40).join('\n')
    expect(lines).toContain('ls (killed)')
    expect(lines).toContain('SIGTERM')
  })

  it('renders diff results and diff calls', () => {
    const resultCard = new ToolCard(colored, 'edit', '{}', { card: 'generic', title: 'Edit' }, 4)
    resultCard.setResult({
      card: 'diff',
      diffs: [{ path: 'a.txt', oldText: 'old\n', newText: 'new\n' }],
    }, 'ok')
    const resultLines = render(resultCard, 50).join('\n')
    expect(resultLines).toContain('a.txt')
    expect(resultLines).toContain('- old')
    expect(resultLines).toContain('+ new')

    const callCard = new ToolCard(colored, 'write', '{}', {
      card: 'diff',
      title: 'Write a.txt',
      diffs: [{ path: 'a.txt', oldText: null, newText: 'created\n' }],
    }, 4)
    const callLines = render(callCard, 50).join('\n')
    expect(callLines).toContain('+ created')
  })

  it('renders an error reason and a failure code fallback', () => {
    const reason = new ToolCard(plain, 'bash', '{}', undefined, 4)
    reason.setResult(undefined, '', { reason: 'denied', code: 'X' })
    expect(render(reason, 40).join('\n')).toContain('denied')
    const code = new ToolCard(plain, 'bash', '{}', undefined, 4)
    code.setResult(undefined, '', { code: 'APPROVAL_REJECTED' })
    expect(render(code, 40).join('\n')).toContain('APPROVAL_REJECTED')
    const generic = new ToolCard(plain, 'bash', '{}', undefined, 4)
    generic.setResult(undefined, '', {})
    expect(render(generic, 40).join('\n')).toContain('failed')
  })

  it('renders result content when no view exists and keeps a late call view', () => {
    const card = new ToolCard(plain, 'read', '{}', undefined, 4)
    card.setResult(undefined, 'body text')
    expect(render(card, 40).join('\n')).toContain('body text')
    card.setCallView({ card: 'generic', title: 'Late' })
    expect(render(card, 40)[0]).toContain('Late')
    // The second frame at one width is served from the cache.
    expect(card.render(40)).toEqual(card.render(40))
  })

  it('renders a terminal result without any exit status and the plural overflow', () => {
    const card = new ToolCard(plain, 'bash', '{}', { card: 'terminal', title: 'ls' }, 1)
    card.setResult({ card: 'terminal', output: 'a\nb\nc' }, 'a\nb\nc')
    const lines = render(card, 40).join('\n')
    expect(lines).toContain('… 2 more lines')
    expect(lines).not.toContain('exit')
  })
})

describe('notice, plan, and status', () => {
  it('styles each notice level and can be replaced', () => {
    for (const level of ['info', 'warning', 'error'] as const) {
      const notice = new Notice(colored, `a ${level} notice`, level)
      const lines = render(notice, 40)
      expect(lines.join('\n')).toContain(`${level} notice`)
      notice.setText('changed')
      expect(render(notice, 40).join('\n')).toContain('changed')
      notice.invalidate()
    }
  })

  it('renders the plan only when populated and bounds visible rows', () => {
    const plan = new PlanPanel(plain, 2)
    expect(plan.visible).toBe(false)
    expect(render(plan, 40)).toEqual([])
    plan.setItems([
      { text: 'one', status: 'completed' },
      { text: 'two', status: 'in_progress' },
      { text: 'three', status: 'pending' },
    ])
    plan.invalidate()
    expect(plan.visible).toBe(true)
    const lines = render(plan, 40)
    expect(lines.join('\n')).toContain('☑ one')
    expect(lines.join('\n')).toContain('◐ two')
    expect(lines.join('\n')).toContain('… 1 more')
    expect(plan.render(40)).toEqual(plan.render(40))
    plan.setItems([{ text: 'later', status: 'pending' }])
    expect(render(plan, 40).join('\n')).toContain('☐ later')
  })

  it('renders the status bar for wide and narrow viewports and optional usage', () => {
    const bar = new StatusBar(colored)
    bar.setState({
      title: 't', cwd: '/work', model: 'provider/model', tokens: '↑1 ↓2', permission: 'read-only', phase: 'idle', sessionId: 's',
    })
    const wide = render(bar, 120)[0] ?? ''
    expect(wide).toContain('provider/model')
    expect(wide).toContain('/work')
    const narrow = render(bar, 20)[0] ?? ''
    expect(narrow).toContain('idle')
    bar.setState({ title: '', cwd: '', model: 'm', tokens: '', permission: 'p', phase: 'working 3s', sessionId: '' })
    expect(render(bar, 40)[0]).toContain('working 3s')
    bar.setState({ title: '', cwd: 'c', model: 'm', tokens: '', permission: 'p', phase: 'running', sessionId: 's' })
    expect(render(bar, 40)[0]).toContain('running')
    bar.invalidate()
  })

  it('escapes status fields and accents the working phase', () => {
    const bar = new StatusBar(colored)
    bar.setState({
      title: '',
      cwd: '/tmp/\u001B[2Jdir',
      model: 'm',
      tokens: '',
      permission: 'p\u0007',
      phase: 'working 3s',
      sessionId: 's\u001B]0;evil\u0007',
    })
    const line = render(bar, 120)[0] ?? ''
    expect(line).toContain('\\x1B[2J')
    expect(line).not.toContain('\u0007')
    expect(line).toContain('working 3s')
    // The working phase uses the accent role rather than the dim one.
    expect(line.startsWith('\u001B[36m')).toBe(true)
  })

  it('drops the right side first when the gap is too small', () => {
    const bar = new StatusBar(plain)
    const state: StatusState = { title: '', cwd: 'c', model: 'm', tokens: '', permission: 'p', phase: 'idle', sessionId: 's' }
    bar.setState(state)
    // Exactly one column of separation keeps both sides; less clips the right.
    const exact = render(bar, 'idle · m · p'.length + 'c · s'.length + 1)
    expect(exact[0]).toContain('idle')
    expect(exact[0]).toContain('c · s')
    const clipped = render(bar, 'idle · m · p'.length + 1)
    expect(clipped[0]).not.toContain(' · s')
  })
})
