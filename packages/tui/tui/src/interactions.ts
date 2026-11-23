/**
 * Terminal answerers for the two human-interaction waterfalls: one-shot tool
 * approval and the model's structured questions. The panel takes keyboard focus
 * away from the editor while a request is pending and gives it back when the
 * answer settles, so a reply can never be typed into the wrong control.
 * @module @deepseek-ai/dsh-tui/interactions
 */

import { Container, Input, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from '@earendil-works/pi-tui'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  AskUserQuestionOption,
} from '@deepseek-ai/dsh-user-questions/types'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import { displayInlineText, displayText, type Palette } from './theme.ts'

/** One selectable row of a pending decision. */
export interface DecisionOption {
  readonly label: string
  readonly description?: string
}

/** Outcome the user chose for one panel. */
export type DecisionResult =
  | { readonly kind: 'selected'; readonly labels: readonly string[] }
  | { readonly kind: 'custom'; readonly text: string }
  | { readonly kind: 'aborted' }

/** Input keys the panel consumes; the editor is unfocused while it is mounted. */
function moveKey(data: string): 'up' | 'down' | undefined {
  if (matchesKey(data, 'up') || matchesKey(data, 'k') || matchesKey(data, 'shift+tab')) return 'up'
  if (matchesKey(data, 'down') || matchesKey(data, 'j') || matchesKey(data, 'tab')) return 'down'
  return undefined
}

/** One keyboard-selectable decision panel with an optional free-text row. */
export class DecisionPanel implements Component {
  private index = 0
  private readonly options: readonly DecisionOption[]
  private readonly custom: boolean

  /** Called with the chosen labels, the typed text, or an abort. */
  onSettle: (result: DecisionResult) => void = () => {}

  /**
   * @param palette - active palette.
   * @param title - one-line decision title.
   * @param detail - optional supporting text.
   * @param options - selectable rows.
   * @param options.multiSelect - whether several rows may be checked.
   * @param options.custom - whether a free-text answer is offered.
   */
  constructor(
    private readonly palette: Palette,
    private readonly title: string,
    private readonly detail: string,
    options: readonly DecisionOption[],
    private readonly multiSelect = false,
    custom = true,
  ) {
    this.options = options
    this.custom = custom
  }

  private get rows(): readonly DecisionOption[] {
    return this.custom
      ? [...this.options, { label: 'Type another answer…' }]
      : this.options
  }

  private readonly checked = new Set<string>()

  private static highlighted(palette: Palette, text: string): string {
    return palette.inverse(text)
  }

  handleInput(data: string): void {
    const move = moveKey(data)
    if (move !== undefined) {
      const count = this.rows.length
      this.index = (this.index + (move === 'down' ? 1 : count - 1)) % count
      return
    }
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.onSettle({ kind: 'aborted' })
      return
    }
    const digit = data.length === 1 && data >= '1' && data <= '9' ? Number(data) - 1 : undefined
    if (digit !== undefined && digit < this.rows.length) {
      this.index = digit
      if (this.multiSelect) {
        this.toggle()
        return
      }
      this.submit()
      return
    }
    if (this.multiSelect && data === ' ') {
      this.toggle()
      return
    }
    if (matchesKey(data, 'enter') || matchesKey(data, 'return')) this.submit()
  }

  private toggle(): void {
    const row = this.rows[this.index]
    /* v8 ignore next -- the index always addresses an existing row; a panel with no rows is never mounted. */
    if (row === undefined || (this.custom && this.index === this.rows.length - 1)) return
    if (this.checked.has(row.label)) this.checked.delete(row.label)
    else this.checked.add(row.label)
  }

  private submit(): void {
    const row = this.rows[this.index]
    /* v8 ignore next -- the index always addresses an existing row; a panel with no rows is never mounted. */
    if (row === undefined) return
    if (this.custom && this.index === this.rows.length - 1) {
      this.onSettle({ kind: 'custom', text: '' })
      return
    }
    if (this.multiSelect) {
      // The custom row is excluded above, so every checked label is an option.
      this.onSettle({ kind: 'selected', labels: [...this.checked] })
      return
    }
    this.onSettle({ kind: 'selected', labels: [row.label] })
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { palette } = this
    const lines: string[] = [truncateToWidth(palette.bold(palette.accent(`? ${displayInlineText(this.title)}`)), width)]
    for (const line of wrapTextWithAnsi(displayText(this.detail).trim(), Math.max(1, width - 2))) {
      lines.push(truncateToWidth(`  ${palette.dim(line)}`, width))
    }
    this.rows.forEach((row, index) => {
      const active = index === this.index
      const marker = this.multiSelect && !(this.custom && index === this.rows.length - 1)
        ? `${this.checked.has(row.label) ? palette.success('x') : ' '} `
        : `${String(index + 1)}. `
      const label = displayInlineText(row.label)
      const rowText = truncateToWidth(`${marker}${label}`, width)
      lines.push(active ? DecisionPanel.highlighted(palette, rowText) : `   ${rowText}`)
      if (row.description !== undefined && row.description !== '') {
        lines.push(truncateToWidth(`     ${palette.dim(displayInlineText(row.description))}`, width))
      }
    })
    const hint = this.multiSelect
      ? '↑/↓ select · Space toggle · Enter confirm · Esc cancel'
      : '↑/↓ select · Enter confirm · Esc cancel'
    lines.push(truncateToWidth(palette.dim(hint), width))
    return lines
  }
}

/** One free-text answer panel backed by the terminal's line editor. */
export class TextAnswerPanel implements Component {
  private readonly input: Input

  /** Called with the submitted text, or undefined on cancellation. */
  onSettle: (text: string | undefined) => void = () => {}

  /**
   * @param palette - active palette.
   * @param title - one-line question or action title.
   * @param detail - optional supporting text.
   * @param placeholder - example input shown while empty.
   */
  constructor(
    private readonly palette: Palette,
    private readonly title: string,
    private readonly detail: string,
    placeholder?: string,
  ) {
    this.input = new Input(placeholder === undefined ? { prompt: '> ' } : { prompt: '> ', placeholder })
    this.input.focused = true
    this.input.onSubmit = (value: string) => { this.onSettle(value) }
    this.input.onEscape = () => { this.onSettle(undefined) }
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c')) {
      this.onSettle(undefined)
      return
    }
    this.input.handleInput(data)
  }

  invalidate(): void {
    this.input.invalidate()
  }

  render(width: number): string[] {
    const lines: string[] = [truncateToWidth(this.palette.bold(this.palette.accent(`? ${displayInlineText(this.title)}`)), width)]
    if (this.detail !== '') {
      for (const line of wrapTextWithAnsi(displayText(this.detail).trim(), Math.max(1, width - 2))) {
        lines.push(truncateToWidth(`  ${this.palette.dim(line)}`, width))
      }
    }
    lines.push(...this.input.render(width))
    lines.push(truncateToWidth(this.palette.dim('Enter submit · Esc cancel'), width))
    return lines
  }
}

/** One question the model asked, with an answer provider. */
export interface QuestionRequest {
  readonly questions: readonly AskUserQuestionItem[]
  readonly signal?: AbortSignal
}

/** Wiring the interaction host needs from the app. */
export interface InteractionHostOptions {
  readonly tui: TUI
  readonly panel: Container
  readonly palette: Palette
  readonly requestRender: () => void
  /** Give keyboard focus back to the composer. */
  readonly restoreFocus: () => void
  /** Notify the app that a request started or settled, so its status line refreshes. */
  readonly onBusyChange: () => void
}

/**
 * Serialized terminal answerers. One request is visible at a time; a second
 * request waits for the first to settle so two prompts cannot overwrite each
 * other's keyboard focus.
 */
export class InteractionHost {
  private tail: Promise<unknown> = Promise.resolve()

  /** @param options - focus, panel container, and render wiring. */
  constructor(private readonly options: InteractionHostOptions) {}

  /**
   * Ask for one approval decision.
   * @param toolName - tool the asker wants to run.
   * @param reason - optional human-readable justification.
   * @param displayReason - localized presentation text, when the asker supplied one.
   * @param signal - cancellation lifetime of the request.
   * @returns the approval outcome.
   */
  approve(
    toolName: string,
    reason: string | undefined,
    displayReason: { readonly en: string; readonly [locale: string]: string } | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ApprovalOutcome> {
    return this.enqueue(async () => {
      const detail = displayReason?.en ?? reason ?? ''
      const result = await this.present(new DecisionPanel(this.options.palette, `Approve ${toolName}?`, detail, [
        { label: 'Allow once', description: 'run this one call' },
        { label: 'Reject', description: 'refuse and return the refusal to the model' },
      ], false, false), signal)
      if (result.kind === 'aborted') return 'cancelled'
      return result.kind === 'selected' && result.labels[0] === 'Allow once' ? 'allowed-once' : 'rejected'
    })
  }

  /**
   * Ask one binary confirmation.
   * @param title - one-line confirmation title.
   * @param detail - supporting text explaining what the affirmative answer changes.
   * @param labels - affirmative and dismissing row labels.
   * @param signal - cancellation lifetime of the request.
   * @returns whether the affirmative row was chosen.
   */
  confirm(
    title: string,
    detail: string,
    labels: { readonly allow: string; readonly cancel: string },
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const result = await this.present(new DecisionPanel(this.options.palette, title, detail, [
        { label: labels.cancel },
        { label: labels.allow },
      ], false, false), signal)
      return result.kind === 'selected' && result.labels[0] === labels.allow
    })
  }

  /**
   * Ask the user every question of one request in order.
   * @param questions - questions to present in order.
   * @param signal - cancellation lifetime of the request.
   * @returns one answer item per question.
   */
  ask(questions: readonly AskUserQuestionItem[], signal: AbortSignal | undefined): Promise<AskUserQuestionAnswer> {
    return this.enqueue(async () => {
      const answers: AskUserQuestionAnswer['answers'] = []
      for (const question of questions) {
        if (signal?.aborted === true) break
        answers.push(await this.askOne(question, signal))
      }
      return { answers }
    })
  }

  private async askOne(question: AskUserQuestionItem, signal: AbortSignal | undefined): Promise<AskUserQuestionAnswer['answers'][number]> {
    const { palette } = this.options
    const title = question.header ?? 'Question'
    const detail = question.detail === undefined ? question.question : `${question.question}\n\n${question.detail}`
    const options: readonly AskUserQuestionOption[] = question.options ?? []
    if (options.length === 0) {
      const typed = await this.presentText(
        new TextAnswerPanel(palette, title, detail, 'Type your answer'),
        signal,
      )
      if (typed === undefined) return { id: question.id, selected: [] }
      return { id: question.id, selected: [], custom: typed }
    }
    const result = await this.present(new DecisionPanel(
      palette,
      title,
      detail,
      options.map(option => ({ label: option.label, ...option.description === undefined ? {} : { description: option.description } })),
      question.multiSelect === true,
      true,
    ), signal)
    if (result.kind === 'aborted') {
      return { id: question.id, selected: [] }
    }
    if (result.kind === 'custom') {
      const typed = await this.presentText(new TextAnswerPanel(palette, title, detail, 'Type your answer'), signal)
      return typed === undefined
        ? { id: question.id, selected: [] }
        : { id: question.id, selected: [], custom: typed }
    }
    return { id: question.id, selected: [...result.labels] }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }

  private present(panel: DecisionPanel, signal: AbortSignal | undefined): Promise<DecisionResult> {
    if (signal?.aborted === true) return Promise.resolve({ kind: 'aborted' })
    return new Promise<DecisionResult>((resolve) => {
      let settled = false
      const finish = (result: DecisionResult): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        this.options.panel.clear()
        this.options.restoreFocus()
        this.options.onBusyChange()
        this.options.requestRender()
        resolve(result)
      }
      const onAbort = (): void => { finish({ kind: 'aborted' }) }
      signal?.addEventListener('abort', onAbort, { once: true })
      panel.onSettle = finish
      this.mount(panel)
    })
  }

  private presentText(panel: TextAnswerPanel, signal: AbortSignal | undefined): Promise<string | undefined> {
    /* v8 ignore next 2 -- askOne checks the signal before each question. */
    if (signal?.aborted === true) return Promise.resolve(undefined)
    return new Promise<string | undefined>((resolve) => {
      let settled = false
      const finish = (text: string | undefined): void => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        this.options.panel.clear()
        this.options.restoreFocus()
        this.options.onBusyChange()
        this.options.requestRender()
        resolve(text)
      }
      const onAbort = (): void => { finish(undefined) }
      signal?.addEventListener('abort', onAbort, { once: true })
      panel.onSettle = finish
      this.mount(panel)
    })
  }

  private mount(panel: Component): void {
    this.options.panel.clear()
    this.options.panel.addChild(panel)
    this.options.tui.setFocus(panel)
    this.options.onBusyChange()
    this.options.requestRender()
  }
}

/**
 * Brand a tool-call id read from a durable event.
 * @param value - the raw call identity.
 * @returns the same string carrying the tool-call identity brand.
 */
export function asToolCallId(value: string): ToolCallId {
  return brandString<ToolCallId>(value)
}
