/**
 * Terminal components for one conversation: role headers, wrapped user text,
 * streamed markdown replies, tool cards, notices, the standing plan, and the
 * status line. Each component caches nothing that the owning app does not
 * invalidate after a state change.
 * @module @deepseek-ai/dsh-tui/components
 */

import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { MarkdownTheme } from '@earendil-works/pi-tui'
import type { Palette } from './theme.ts'
import { displayInlineText, displayText } from './theme.ts'

/**
 * Wrap one styled paragraph to the viewport, keeping every line within the
 * width the TUI enforces. Blank input yields no lines.
 * @param text - styled text that may contain line feeds.
 * @param width - available columns.
 * @returns at most `width`-wide lines.
 */
function wrap(text: string, width: number): string[] {
  if (width <= 0) return []
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    lines.push(...wrapTextWithAnsi(paragraph, width))
  }
  return lines
}

/** A grouped-region role header. */
export class RoleHeader implements Component {
  private text: string

  /**
   * @param palette - active palette.
   * @param label - role label such as `You` or `Assistant`.
   * @param trailing - optional right-aligned dim metadata.
   */
  constructor(
    private readonly palette: Palette,
    label: string,
    private trailing = '',
  ) {
    this.text = label
  }

  /**
   * Replace the role label.
   * @param label - new role label.
   */
  setLabel(label: string): void {
    this.text = label
  }

  /**
   * Replace the right-aligned metadata.
   * @param trailing - new metadata text.
   */
  setTrailing(trailing: string): void {
    this.trailing = trailing
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return []
    const label = this.palette.bold(this.palette.accent(this.text))
    if (this.trailing === '') return [truncateToWidth(label, width)]
    const tail = this.palette.dim(this.trailing)
    const gap = width - visibleWidth(label) - visibleWidth(tail)
    if (gap < 1) return [truncateToWidth(`${label} ${tail}`, width)]
    return [`${label}${' '.repeat(gap)}${tail}`]
  }
}

/** A user prompt or steering message, header followed by its text. */
export class UserPrompt implements Component {
  private text: string

  /**
   * @param palette - active palette.
   * @param text - untrusted prompt text.
   * @param label - role label; `You` for prompts and `Steering` while running.
   */
  constructor(
    private readonly palette: Palette,
    text: string,
    private readonly label = 'You',
  ) {
    this.text = displayText(text)
  }

  /**
   * Replace the prompt body.
   * @param text - new prompt text.
   */
  setText(text: string): void {
    this.text = displayText(text)
  }

  invalidate(): void {}

  render(width: number): string[] {
    const header = this.palette.bold(this.palette.accent(this.label))
    const body = wrap(this.text, width)
    return [truncateToWidth(header, width), ...body]
  }
}

/** Options for {@link AssistantBlock}. */
export interface AssistantBlockOptions {
  /** Show the model's reasoning text above the reply. */
  readonly showReasoning: boolean
  /** Mark a reply cut off by cancellation. */
  readonly interrupted?: boolean
}

/** One assistant reply: optional reasoning, then rendered markdown. */
export class AssistantBlock implements Component {
  private text: string
  private reasoning: string
  private interrupted: boolean
  private readonly header: RoleHeader
  private readonly reasoningHeader: RoleHeader
  private markdown: Markdown
  private cachedWidth = -1
  private cachedLines: string[] = []

  /**
   * @param palette - active palette.
   * @param markdownTheme - theme for assistant markdown.
   * @param trailing - dim metadata shown right of the role label.
   * @param options - reasoning visibility and interruption state.
   */
  constructor(
    private readonly palette: Palette,
    private readonly markdownTheme: MarkdownTheme,
    trailing: string,
    private readonly options: AssistantBlockOptions,
  ) {
    this.text = ''
    this.reasoning = ''
    this.interrupted = options.interrupted === true
    this.header = new RoleHeader(palette, 'Assistant', trailing)
    this.reasoningHeader = new RoleHeader(palette, 'Reasoning')
    this.markdown = new Markdown('', 0, 0, markdownTheme)
  }

  /**
   * Replace the right-aligned metadata.
   * @param trailing - new metadata text.
   */
  setTrailing(trailing: string): void {
    this.header.setTrailing(trailing)
    this.invalidate()
  }

  /**
   * Replace the reply body with the complete accumulated text.
   * @param text - the complete text accumulated so far.
   */
  setText(text: string): void {
    this.text = text
    this.markdown = new Markdown(displayText(text), 0, 0, this.markdownTheme)
    this.invalidate()
  }

  /**
   * Replace the reasoning text.
   * @param text - the complete reasoning accumulated so far.
   */
  setReasoning(text: string): void {
    this.reasoning = text
    this.invalidate()
  }

  /** Mark the reply cut off by cancellation. */
  setInterrupted(): void {
    this.interrupted = true
    this.header.setLabel('Assistant (interrupted)')
    this.invalidate()
  }

  invalidate(): void {
    this.cachedWidth = 0
    this.cachedLines = []
    this.markdown.invalidate()
  }

  render(width: number): string[] {
    if (width !== this.cachedWidth) {
      const lines: string[] = [this.header.render(width)[0] ?? '']
      if (this.options.showReasoning && this.reasoning.trim() !== '') {
        lines.push(this.reasoningHeader.render(width)[0] ?? '')
        for (const line of wrap(displayText(this.reasoning.trimEnd()), width)) {
          lines.push(this.palette.dim(line))
        }
        lines.push('')
      }
      lines.push(...this.markdown.render(width))
      if (this.text.trimEnd() === '') {
        lines.push(this.palette.dim(this.interrupted ? '(no output)' : '…'))
      }
      if (this.interrupted) lines.push(this.palette.dim('Interrupted'))
      this.cachedWidth = width
      this.cachedLines = lines
    }
    return this.cachedLines
  }
}

/** One tool call and its completed result, rendered as a card. */
export class ToolCard implements Component {
  private callView: ToolCallView | undefined
  private resultView: ToolResultView | undefined
  private error: { reason?: string; code?: string } | undefined
  private resultText = ''
  private cachedWidth = -1
  private cachedLines: string[] = []

  /**
   * @param palette - active palette.
   * @param toolName - model-facing tool name used when no presentation exists.
   * @param rawArguments - the call's raw JSON arguments.
   * @param callView - the tool's own pending presentation, when it declares one.
   * @param maxOutputLines - retained output lines in a collapsed card body.
   */
  constructor(
    private readonly palette: Palette,
    readonly toolName: string,
    private rawArguments: string,
    callView: ToolCallView | undefined,
    private readonly maxOutputLines: number,
  ) {
    this.callView = callView
  }

  /**
   * Record the completed result and its optional failure identity.
   * @param result - the tool's presented result, when it declares one.
   * @param text - model-facing result text shown when no view exists.
   * @param error - failure identity and user-facing reason, when the call failed.
   */
  setResult(result: ToolResultView | undefined, text: string, error?: { reason?: string; code?: string }): void {
    this.resultView = result
    this.resultText = displayText(text)
    this.error = error
    this.invalidate()
  }

  /**
   * Attach a presentation that only became available after the call was shown.
   * @param view - the tool's pending presentation, or undefined for none.
   */
  setCallView(view: ToolCallView | undefined): void {
    this.callView = view
    this.invalidate()
  }

  private title(): string {
    if (this.resultView !== undefined && 'title' in this.resultView && typeof this.resultView.title === 'string' && this.resultView.title !== '') {
      return displayInlineText(this.resultView.title)
    }
    if (this.callView !== undefined) return displayInlineText(this.callView.title)
    const firstArgument = this.rawArguments.trim()
    return firstArgument === '' ? this.toolName : `${this.toolName} ${firstArgument}`
  }

  private statusGlyph(): string {
    if (this.error !== undefined) return this.palette.error('✗')
    if (this.resultView !== undefined) return this.palette.success('✓')
    return this.palette.warning('●')
  }

  private bodyLines(width: number): string[] {
    const lines: string[] = []
    const view = this.resultView
    if (view !== undefined && view.card === 'terminal') {
      if (this.callView?.card === 'terminal' && this.callView.cwd !== undefined) {
        lines.push(this.palette.dim(displayInlineText(this.callView.cwd)))
      }
      if (view.output !== undefined && view.output !== '') {
        lines.push(...this.outputLines(view.output, width))
      }
      const status = view.exitCode !== undefined ? `exit ${String(view.exitCode)}` : view.signal
      if (status !== undefined) lines.push(this.palette.dim(status))
      return lines
    }
    if (view !== undefined && view.card === 'diff') {
      return this.diffLines(view, width)
    }
    if (this.callView?.card === 'diff') {
      return this.diffLines(this.callView, width)
    }
    if (this.error !== undefined) {
      const reason = this.error.reason ?? this.error.code ?? 'failed'
      lines.push(this.palette.error(displayInlineText(reason)))
      return lines
    }
    if (this.resultText !== '') {
      lines.push(...this.outputLines(this.resultText, width))
    } else if (this.callView?.card === 'generic' && this.callView.rawInput !== undefined) {
      const raw = typeof this.callView.rawInput === 'string' ? this.callView.rawInput : JSON.stringify(this.callView.rawInput)
      lines.push(this.palette.dim(displayInlineText(raw)))
    }
    return lines
  }

  private outputLines(output: string, width: number): string[] {
    const source = output.replace(/\r\n?/gu, '\n').trimEnd().split('\n')
    const kept = source.slice(0, this.maxOutputLines)
    const lines = kept.map(line => this.palette.dim(truncateToWidth(line, width, '…', false)))
    const hidden = source.length - kept.length
    if (hidden > 0) lines.push(this.palette.dim(`… ${String(hidden)} more line${hidden === 1 ? '' : 's'}`))
    return lines
  }

  private diffLines(view: { diffs: readonly { path: string; oldText: string | null; newText: string }[] }, width: number): string[] {
    const lines: string[] = []
    for (const diff of view.diffs) {
      lines.push(this.palette.dim(displayInlineText(diff.path)))
      const removed = diff.oldText === null ? [] : diff.oldText.split('\n')
      const added = diff.newText.split('\n')
      for (const line of removed) {
        if (line !== '') lines.push(this.palette.error(truncateToWidth(`- ${line}`, width, '…', false)))
      }
      for (const line of added) {
        if (line !== '') lines.push(this.palette.success(truncateToWidth(`+ ${line}`, width, '…', false)))
      }
    }
    return lines
  }

  invalidate(): void {
    this.cachedWidth = 0
    this.cachedLines = []
  }

  render(width: number): string[] {
    if (width !== this.cachedWidth) {
      const header = `${this.statusGlyph()} ${this.palette.bold(this.title())}`
      const body = this.bodyLines(width)
      this.cachedLines = [truncateToWidth(header, width), ...body]
      this.cachedWidth = width
    }
    return this.cachedLines
  }
}

/** A dim informational or error notice interleaved with the transcript. */
export class Notice implements Component {
  private text: string

  /**
   * @param palette - active palette.
   * @param text - untrusted notice text.
   * @param level - how the notice is styled.
   */
  constructor(
    private readonly palette: Palette,
    text: string,
    private readonly level: 'info' | 'warning' | 'error' = 'info',
  ) {
    this.text = displayText(text)
  }

  /**
   * Replace the notice text.
   * @param text - new notice text.
   */
  setText(text: string): void {
    this.text = displayText(text)
  }

  invalidate(): void {}

  render(width: number): string[] {
    const style = this.level === 'error'
      ? this.palette.error
      : this.level === 'warning' ? this.palette.warning : this.palette.dim
    return wrap(this.text, width).map(line => style(line))
  }
}

/** One entry of the agent's standing plan. */
export interface PlanItem {
  readonly text: string
  readonly status: string
}

/** The standing plan above the editor, hidden while empty. */
export class PlanPanel implements Component {
  private items: readonly PlanItem[] = []
  private cachedWidth = -1
  private cachedLines: string[] = []

  /**
   * @param palette - active palette.
   * @param maxLines - maximum plan rows to show.
   */
  constructor(
    private readonly palette: Palette,
    private readonly maxLines = 6,
  ) {}

  /**
   * Replace the whole list.
   * @param items - the latest whole-list snapshot.
   */
  setItems(items: readonly PlanItem[]): void {
    this.items = items
    this.cachedWidth = 0
  }

  /** Whether the panel currently renders anything. */
  get visible(): boolean {
    return this.items.length > 0
  }

  invalidate(): void {
    this.cachedWidth = 0
  }

  render(width: number): string[] {
    if (this.items.length === 0) return []
    if (width !== this.cachedWidth) {
      const lines: string[] = [this.palette.bold('Plan')]
      for (const item of this.items.slice(0, this.maxLines)) {
        const glyph = item.status === 'completed'
          ? this.palette.success('☑')
          : item.status === 'in_progress' ? this.palette.accent('◐') : this.palette.dim('☐')
        const text = item.status === 'completed'
          ? this.palette.dim(displayInlineText(item.text))
          : displayInlineText(item.text)
        lines.push(truncateToWidth(`${glyph} ${text}`, width))
      }
      const hidden = this.items.length - this.maxLines
      if (hidden > 0) lines.push(this.palette.dim(`… ${String(hidden)} more`))
      this.cachedLines = lines
      this.cachedWidth = width
    }
    return this.cachedLines
  }
}

/** Everything the status line reports. */
export interface StatusState {
  /** Session title, or `welcome` before a title exists. */
  readonly title: string
  /** Logical working directory. */
  readonly cwd: string
  /** Current provider/model route, or `model unset`. */
  readonly model: string
  /** Reported token totals, or empty while no step has reported usage. */
  readonly tokens: string
  /** Effective permission preset. */
  readonly permission: string
  /** Agent lifecycle: idle, running, or a finer live phase. */
  readonly phase: string
  /** Session identity. */
  readonly sessionId: string
}

/** A single-line status bar; the right side clips before the left. */
export class StatusBar implements Component {
  private state: StatusState = {
    title: '',
    cwd: '',
    model: '',
    tokens: '',
    permission: '',
    phase: 'idle',
    sessionId: '',
  }

  /** @param palette - active palette. */
  constructor(private readonly palette: Palette) {}

  /**
   * Replace the reported state.
   * @param state - complete status values for the next frame.
   */
  setState(state: StatusState): void {
    this.state = state
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { palette, state } = this
    const phase = displayInlineText(state.phase)
    const parts = [
      phase.startsWith('working') ? palette.accent(phase) : palette.dim(phase),
      palette.bold(displayInlineText(state.model)),
      state.tokens === '' ? '' : palette.dim(displayInlineText(state.tokens)),
      // Auto mode is the one preset whose reviewer replaces human approval
      // prompts; it stays visible instead of blending into the dim facts.
      state.permission === 'auto'
        ? palette.bold(palette.accent(displayInlineText('auto (reviewed)')))
        : palette.dim(displayInlineText(state.permission)),
    ].filter(part => part !== '')
    const right = palette.dim(displayInlineText(`${state.cwd} · ${state.sessionId}`))
    const left = parts.join(palette.dim(' · '))
    const gap = width - visibleWidth(left) - visibleWidth(right)
    if (gap >= 2) return [`${left}${' '.repeat(gap)}${right}`]
    if (gap >= 1) return [truncateToWidth(`${left} ${right}`, width)]
    return [truncateToWidth(left, width)]
  }
}
