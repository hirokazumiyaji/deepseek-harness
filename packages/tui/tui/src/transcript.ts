/**
 * The transcript model: turns durable session events and live assistant frames
 * into the component tree the terminal renders. Presentation stays derived from
 * the log, so a resumed session and a just-finished step render through the same
 * path.
 * @module @deepseek-ai/dsh-tui/transcript
 */

import { Container, Spacer } from '@earendil-works/pi-tui'
import type { MarkdownTheme } from '@earendil-works/pi-tui'
import { extractTextContent } from '@deepseek-ai/dsh-llm/message'
import type { AssistantMessage, ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { Palette } from './theme.ts'
import {
  AssistantBlock,
  Notice,
  PlanPanel,
  ToolCard,
  UserPrompt,
  type PlanItem,
} from './components.ts'

/** Presentation lookups the transcript asks its owner for. */
export interface ToolPresenter {
  /**
   * Pending presentation declared by one tool, or undefined when it declares none.
   * @param name - model-facing tool name.
   * @param rawArguments - the call's raw JSON arguments.
   */
  presentCall(name: string, rawArguments: string): ToolCallView | undefined

  /**
   * Completed presentation declared by one tool, or undefined when it declares none.
   * @param name - model-facing tool name.
   * @param rawArguments - the call's raw JSON arguments.
   * @param result - the durable result projection.
   */
  presentResult(name: string, rawArguments: string, result: ToolResult): ToolResultView | undefined
}

/** Options shared by every transcript instance. */
export interface TranscriptOptions {
  readonly palette: Palette
  readonly markdownTheme: MarkdownTheme
  readonly maxToolOutputLines: number
  readonly showReasoning: boolean
  readonly presenter: ToolPresenter
  /** The single plan panel the surface keeps mounted across transcript rebuilds. */
  readonly plan: PlanPanel
}

/** Extract visible text and reasoning from one assistant content array. */
function splitAssistantContent(content: readonly ContentBlock[]): { text: string; reasoning: string } {
  const reasoning = content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  return { text: extractTextContent(content), reasoning }
}

/** Turn and step identity of one assistant step. */
function stepKey(turn: number, step: number): string {
  return `${String(turn)}:${String(step)}`
}

/** Structural view of merge-extensible user-message sources this surface presents. */
interface PresentableSource {
  readonly kind?: unknown
  readonly form?: unknown
  readonly summary?: unknown
}

/** One live assistant step's accumulated stream text. */
interface LiveBlock {
  block: AssistantBlock
  text: string
  reasoning: string
}

/**
 * The rendered conversation. Callers append from live frames and durable events;
 * the class owns the component tree but no Cordis state, so it is unit-testable.
 */
export class TranscriptView {
  /** The component that holds every transcript block. */
  readonly container = new Container()
  /** The standing plan panel shown above the editor. */
  readonly plan: PlanPanel
  private readonly toolCards = new Map<string, { card: ToolCard; arguments: string }>()
  private readonly live = new Map<string, LiveBlock>()
  private readonly settled = new Set<string>()
  private empty = true

  /** @param options - palette, markdown theme, presentation lookups, and the shared plan panel. */
  constructor(private readonly options: TranscriptOptions) {
    this.plan = options.plan
  }

  /** Whether no block has been appended yet. */
  get isEmpty(): boolean {
    return this.empty
  }

  private append(component: { render(width: number): string[]; invalidate(): void }): void {
    if (!this.empty) this.container.addChild(new Spacer(1))
    this.container.addChild(component)
    this.empty = false
  }

  /**
   * Append one human prompt.
   * @param text - prompt text as the user submitted it.
   * @param label - role label override, such as `Steering`.
   */
  user(text: string, label?: string): void {
    this.append(new UserPrompt(this.options.palette, text, label))
  }

  /**
   * Append one informational, warning, or error notice.
   * @param text - notice text.
   * @param level - how the notice is styled.
   */
  notice(text: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    this.append(new Notice(this.options.palette, text, level))
  }

  /**
   * Append one completed assistant reply.
   * @param text - visible reply text.
   * @param reasoning - reasoning text to show above the reply.
   * @param trailing - right-aligned metadata for the role header.
   * @param interrupted - whether cancellation cut the reply short.
   * @returns the appended block.
   */
  assistant(text: string, reasoning = '', trailing = '', interrupted = false): AssistantBlock {
    const block = new AssistantBlock(this.options.palette, this.options.markdownTheme, trailing, {
      showReasoning: this.options.showReasoning,
    })
    block.setText(text)
    block.setReasoning(reasoning)
    if (interrupted) block.setInterrupted()
    this.append(block)
    return block
  }

  /**
   * Start or restart the live block for one assistant step.
   * @param turn - turn number.
   * @param step - step number.
   * @returns the live block for this step.
   */
  streamStart(turn: number, step: number): AssistantBlock {
    const key = stepKey(turn, step)
    this.settled.delete(key)
    const existing = this.live.get(key)
    if (existing !== undefined) {
      existing.text = ''
      existing.reasoning = ''
      existing.block.setText('')
      existing.block.setReasoning('')
      existing.block.setTrailing('streaming…')
      return existing.block
    }
    const block = new AssistantBlock(this.options.palette, this.options.markdownTheme, 'streaming…', {
      showReasoning: this.options.showReasoning,
    })
    this.append(block)
    this.live.set(key, { block, text: '', reasoning: '' })
    return block
  }

  /**
   * Append a live streamed delta to the block for one step.
   * @param turn - turn number.
   * @param step - step number.
   * @param kind - whether the delta is visible text or reasoning.
   * @param delta - the accumulated text chunk to append.
   */
  streamDelta(turn: number, step: number, kind: 'text' | 'reasoning', delta: string): void {
    const live = this.live.get(stepKey(turn, step)) ?? this.liveEntry(turn, step)
    if (kind === 'text') {
      live.text += delta
      live.block.setText(live.text)
      return
    }
    live.reasoning += delta
    live.block.setReasoning(live.reasoning)
  }

  private liveEntry(turn: number, step: number): LiveBlock {
    this.streamStart(turn, step)
    const entry = this.live.get(stepKey(turn, step))
    /* v8 ignore next -- streamStart always records the entry this method then reads. */
    if (entry === undefined) throw new Error('tui: assistant stream entry was not created')
    return entry
  }

  /**
   * Finalize one live step, keeping its text when the durable settlement follows.
   * @param turn - turn number.
   * @param step - step number.
   * @param abandoned - whether the attempt ended without a durable settlement.
   */
  streamEnd(turn: number, step: number, abandoned: boolean): void {
    const key = stepKey(turn, step)
    const live = this.live.get(key)
    if (live === undefined) return
    // A committed settlement already set its metadata before the end frame;
    // only an abandoned stream needs the streaming marker removed here.
    if (!this.settled.has(key)) live.block.setTrailing('')
    if (abandoned) live.block.setInterrupted()
  }

  /**
   * Settle one assistant step from its durable event, reusing the live block
   * when this surface streamed it.
   * @param turn - turn number.
   * @param step - step number.
   * @param message - the durable assistant message.
   * @param trailing - right-aligned metadata for the role header.
   * @param interrupted - whether cancellation cut the reply short.
   */
  settleAssistant(turn: number, step: number, message: AssistantMessage, trailing: string, interrupted: boolean): void {
    const key = stepKey(turn, step)
    const { text, reasoning } = splitAssistantContent(message.content)
    const live = this.live.get(key)
    if (live !== undefined) {
      this.settled.add(key)
      live.text = text
      // A provider that streams reasoning already showed it; a settlement
      // without reasoning blocks must not erase that live text.
      if (reasoning !== '' || live.reasoning === '') live.reasoning = reasoning
      live.block.setText(text)
      live.block.setReasoning(live.reasoning)
      live.block.setTrailing(trailing)
      if (interrupted) live.block.setInterrupted()
      return
    }
    this.assistant(text, reasoning, trailing, interrupted)
  }

  /**
   * Show or replace the pending card for one tool call.
   * @param callId - call identity the result will name.
   * @param name - model-facing tool name.
   * @param rawArguments - the call's raw JSON arguments.
   */
  toolCall(callId: string, name: string, rawArguments: string): void {
    const view = this.options.presenter.presentCall(name, rawArguments)
    const card = new ToolCard(this.options.palette, name, rawArguments, view, this.options.maxToolOutputLines)
    this.toolCards.set(callId, { card, arguments: rawArguments })
    this.append(card)
  }

  /**
   * Complete one tool card from its durable result.
   * @param callId - call identity being settled.
   * @param content - model-facing result content.
   * @param isError - whether the call failed.
   * @param error - failure identity and reason outside model content.
   * @param meta - tool-private presentation payload.
   */
  toolResult(
    callId: string,
    content: readonly ContentBlock[],
    isError: boolean,
    error: { reason?: string; code?: string } | undefined,
    meta: unknown,
  ): void {
    const entry = this.toolCards.get(callId)
    if (entry === undefined) return
    const result: ToolResult = meta === undefined
      ? { content: [...content], isError }
      : { content: [...content], isError, meta: meta as NonNullable<ToolResult['meta']> }
    const view = this.options.presenter.presentResult(entry.card.toolName, entry.arguments, result)
    entry.card.setResult(view, extractTextContent(content), error)
  }

  /**
   * Replace the standing plan.
   * @param items - the latest whole-list snapshot.
   */
  setPlan(items: readonly PlanItem[]): void {
    this.plan.setItems(items)
  }

  /**
   * Append every presentable fact already in a session log.
   * @param session - the live session to replay.
   */
  rebuild(session: Session): void {
    const length = session.seq
    for (let seq = 0; seq < length; seq += 1) {
      // oxlint-disable-next-line typescript/no-deprecated -- existing history read; migration deferred.
      const event = session.eventAt(SessionSeq(seq))
      /* v8 ignore next -- eventAt covers every seq below the captured length. */
      if (event !== undefined) this.applyEvent(event)
    }
  }

  /**
   * Append the presentable part of one durable event.
   * @param event - one committed session event.
   */
  applyEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'user/message': {
        this.applyUserMessage(event.data)
        return
      }
      case 'assistant/message': {
        const { usage } = event.data
        const trailing = usage === undefined ? '' : `${String(usage.inputTokens)} in / ${String(usage.outputTokens)} out`
        this.settleAssistant(event.data.turn, event.data.step, event.data.message, trailing, event.data.interrupted === true)
        return
      }
      case 'tool/call': {
        this.toolCall(event.data.callId, event.data.name, event.data.arguments)
        return
      }
      case 'tool/result': {
        const { message, error } = event.data
        this.toolResult(message.toolCallId, message.content, message.isError === true, error, event.data.meta)
        return
      }
      case 'turn/end': {
        if (event.data.reason.kind === 'error') {
          const failure = event.data.reason.error
          this.notice(`${failure.code}: ${failure.message}`, 'error')
        }
        return
      }
      case 'todo/write': {
        this.setPlan(event.data.todos.map(todo => ({ text: todo.content, status: todo.status })))
        return
      }
      default:
        return
    }
  }

  private applyUserMessage(message: UserMessage): void {
    const source: PresentableSource = message.source
    if (source.kind === 'user') {
      this.user(extractTextContent(message.content))
      return
    }
    if (source.kind === 'user-question-reply') return
    if (source.form === 'notice' && typeof source.summary === 'string' && source.summary !== '') {
      this.notice(source.summary, 'info')
    }
  }
}
