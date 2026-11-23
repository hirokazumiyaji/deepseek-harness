/**
 * The interactive terminal application: one live agent, the rendered transcript,
 * the composer, the status line, human-interaction panels, and the process
 * lifecycle that restores the terminal before exit.
 * @module @deepseek-ai/dsh-tui/app
 */

import {
  Container,
  Editor,
  Spacer,
  TuiMainScreen,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Terminal,
  type TUI,
} from '@earendil-works/pi-tui'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamFrame, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-tool-todo'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { asSessionId, runCommandLine, type SlashCommandHost } from './commands.ts'
import { PlanPanel, StatusBar } from './components.ts'
import { InteractionHost } from './interactions.ts'
import { createPalette, displayInlineText, editorThemeFor, markdownThemeFor, type Palette } from './theme.ts'
import { TranscriptView, type ToolPresenter } from './transcript.ts'

/** Surface configuration resolved by the plugin. */
export interface TuiAppConfig {
  /** Render the model's reasoning blocks. */
  readonly showReasoning: boolean
  /** Collapsed tool-card output lines. */
  readonly maxToolOutputLines: number
  /** Apply the built-in ANSI palette. */
  readonly color: boolean
  /** Extra banner line shown until the first turn starts. */
  readonly welcome?: string
  /** Product suffix for the terminal window title. */
  readonly title: string
  /** Prompt typed on the invocation line, submitted once the surface is live. */
  readonly initialPrompt?: string
  /** Maximum wait for cancellation or session disposal before the process leaves. */
  readonly shutdownTimeoutMs: number
}

/** Services and lifecycle hooks the app consumes from its mounting plugin. */
export interface TuiAppOptions {
  readonly ctx: Context
  readonly terminal: Terminal
  readonly config: TuiAppConfig
  /** The agent this surface starts with. */
  readonly handle: AgentHandle
  /** Request bounded process exit after teardown. */
  readonly exit: (code: number) => void
  /** Persist the current session before the process leaves. */
  readonly flush: (session: Session) => Promise<void>
  /** Resume a persisted session for `/resume`. */
  readonly resume: (sessionId: SessionId) => Promise<AgentHandle>
}

/** The one-line product banner; the session title rides on its right. */
class Banner implements Component {
  private subtitle: string

  /**
   * @param palette - active palette.
   * @param title - product title.
   * @param subtitle - initial session title or welcome line.
   */
  constructor(
    private readonly palette: Palette,
    private readonly title: string,
    subtitle: string,
  ) {
    this.subtitle = subtitle
  }

  /** Replace the session title shown right of the product name. */
  setSubtitle(subtitle: string): void {
    this.subtitle = subtitle
  }

  /* v8 ignore next -- required no-op of the Component interface; a banner holds no cached render. */
  invalidate(): void {}

  render(width: number): string[] {
    const name = `${this.palette.brand('◆ ')}${this.palette.bold(this.title)}`
    const subtitle = this.subtitle === '' ? '' : this.palette.dim(displayInlineText(this.subtitle))
    if (subtitle === '') return [truncateToWidth(name, width)]
    const gap = width - visibleWidth(name) - visibleWidth(subtitle)
    return [gap >= 1 ? `${name}${' '.repeat(gap)}${subtitle}` : truncateToWidth(`${name} ${subtitle}`, width)]
  }
}

/**
 * Build the presentation lookups from the live tool registry. Presenters are
 * pure and session-agnostic, so a missing tool or a throwing presenter falls
 * back to the generic card instead of failing the turn.
 */
function presenterFor(ctx: Context): ToolPresenter {
  return {
    presentCall(name: string, rawArguments: string): ToolCallView | undefined {
      const definition = ctx.get('tools')?.get(name)
      if (definition?.presentCall === undefined) return undefined
      try {
        return definition.presentCall(JSON.parse(rawArguments))
      } catch {
        // Unparseable streaming arguments and presenter failures both fall back
        // to the generic card; neither may break the transcript.
        return undefined
      }
    },
    presentResult(name: string, rawArguments: string, result: ToolResult): ToolResultView | undefined {
      const definition = ctx.get('tools')?.get(name)
      if (definition?.presentResult === undefined) return undefined
      try {
        return definition.presentResult(JSON.parse(rawArguments), result)
      } catch {
        return undefined
      }
    },
  }
}

/** One live assistant step being streamed. */
interface StreamingStep {
  readonly turn: number
  readonly step: number
}

/** The interactive terminal surface. */
export class TuiApp {
  private readonly ctx: Context
  private readonly palette: Palette
  private readonly markdownTheme
  private readonly tui: TUI
  private readonly editor: Editor
  private readonly editorTheme: ReturnType<typeof editorThemeFor>
  private readonly banner: Banner
  private readonly chat = new Container()
  private readonly panel = new Container()
  private readonly statusBar: StatusBar
  private readonly planPanel: PlanPanel
  private readonly interactions: InteractionHost
  private transcript: TranscriptView
  private handle: AgentHandle
  private streaming: StreamingStep | undefined
  private title = ''
  private usage = { input: 0, output: 0 }
  private runningSince: number | undefined
  private readonly suppressedUserMessages = new Set<string>()
  private readonly abort = new AbortController()
  private readonly disposers: (() => void)[] = []
  private statusTimer: ReturnType<typeof setInterval> | undefined
  private started = false
  private exiting = false
  private lastInterruptAt = 0
  private switching = false
  private modeSwitching = false

  /** @param options - services, configuration, and the initial agent handle. */
  constructor(private readonly options: TuiAppOptions) {
    this.ctx = options.ctx
    this.palette = createPalette({ color: options.config.color })
    this.markdownTheme = markdownThemeFor(this.palette)
    this.tui = new TuiMainScreen(options.terminal)
    this.statusBar = new StatusBar(this.palette)
    this.planPanel = new PlanPanel(this.palette)
    this.editorTheme = editorThemeFor(this.palette)
    this.editor = new Editor(this.tui, this.editorTheme, { paddingX: 1 })
    this.banner = new Banner(this.palette, options.config.title, '')
    this.transcript = this.createTranscript()
    this.interactions = new InteractionHost({
      tui: this.tui,
      panel: this.panel,
      palette: this.palette,
      requestRender: () => { this.tui.requestRender() },
      restoreFocus: () => { this.tui.setFocus(this.editor) },
      onBusyChange: () => { this.updateStatus() },
    })
    this.handle = options.handle
    this.editor.onSubmit = (text: string): void => { void this.submit(text) }
    this.mountComponents()
    this.wireEvents()
  }

  private get agent(): Agent {
    return this.handle.agent
  }

  private createTranscript(): TranscriptView {
    return new TranscriptView({
      palette: this.palette,
      markdownTheme: this.markdownTheme,
      maxToolOutputLines: this.options.config.maxToolOutputLines,
      showReasoning: this.options.config.showReasoning,
      presenter: presenterFor(this.ctx),
      plan: this.planPanel,
    })
  }

  private mountComponents(): void {
    this.chat.addChild(this.transcript.container)
    this.tui.addChild(this.banner)
    this.tui.addChild(new Spacer(1))
    this.tui.addChild(this.chat)
    this.tui.addChild(this.planPanel)
    this.tui.addChild(this.panel)
    this.tui.addChild(new Spacer(1))
    this.tui.addChild(this.editor)
    this.tui.addChild(this.statusBar)
  }

  /** Start the terminal, subscribe to the agent, and replay existing history. */
  start(): void {
    if (this.started) return
    this.started = true
    this.title = this.ctx.get('sessionTitle')?.get(this.agent.session)?.title ?? ''
    this.banner.setSubtitle(this.title !== '' ? this.title : this.options.config.welcome ?? '')
    this.transcript.rebuild(this.agent.session)
    this.applyUsageFromHistory(this.agent.session)
    this.updateStatus()
    this.tui.setFocus(this.editor)
    this.tui.start()
    this.installGlobalKeys()
    this.statusTimer = setInterval(() => { this.refreshRunningStatus() }, 500)
    this.terminalTitle()
    if (this.options.config.initialPrompt !== undefined && this.options.config.initialPrompt.trim() !== '') {
      void this.submit(this.options.config.initialPrompt)
    }
  }

  /** Restore the terminal and release every subscription. Idempotent. */
  stop(): void {
    if (!this.started) return
    this.started = false
    /* v8 ignore next -- the timer exists whenever the surface started. */
    if (this.statusTimer !== undefined) {
      clearInterval(this.statusTimer)
      this.statusTimer = undefined
    }
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch (_error: unknown) {
        // A listener that fails while the surface is leaving must not keep the
        // terminal in raw mode; remaining cleanup still runs.
      }
    }
    this.abort.abort(new Error('terminal surface closed'))
    this.tui.stop()
  }

  /**
   * Leave the surface: cancel a running turn, flush the session, dispose the
   * agent, restore the terminal, then request bounded process exit.
   * @param code - process exit code.
   */
  async shutdown(code = 0): Promise<void> {
    if (this.exiting) return
    this.exiting = true
    this.stop()
    try {
      if (this.agent.status === 'running') {
        this.agent.cancel({ kind: 'user' }, { keepInbox: true })
        await bounded(this.agent.whenIdle(), this.options.config.shutdownTimeoutMs)
      }
    } catch (_error: unknown) {
      // Cancellation may race settlement; the flush below still runs.
    }
    try {
      await this.options.flush(this.agent.session)
    } catch (error: unknown) {
      process.stderr.write(`dsh: failed to flush the session: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    try {
      await this.handle.dispose()
    } catch (_error: unknown) {
      // The process is leaving; a failed disposal is reported by the launcher.
    }
    this.options.exit(code)
  }

  /** Wire the agent and session event feeds for this surface. */
  private wireEvents(): void {
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      if (session !== this.agent.session) return
      this.onSessionEvent(event)
    }))
    this.disposers.push(this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (agent !== this.agent) return
      this.onAssistantFrame(frame)
    }))
    this.disposers.push(this.ctx.on('agent/status', ({ agent, status }) => {
      if (agent !== this.agent) return
      this.runningSince = status === 'running' ? Date.now() : undefined
      this.updateStatus()
      this.tui.requestRender()
    }))
    this.disposers.push(this.ctx.on('agent/error', ({ agent, error }) => {
      if (agent !== this.agent) return
      this.transcript.notice(error instanceof Error ? error.message : String(error), 'error')
      this.tui.requestRender()
    }))
    this.disposers.push(this.ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      if (agent !== this.agent) return
      if (!this.suppressedUserMessages.delete(message.id)) return
      this.transcript.notice('queued message discarded', 'warning')
      this.tui.requestRender()
    }))
    this.disposers.push(this.ctx.on('approval/request', (request, next) => {
      if (request.agent !== this.agent) return next()
      return this.interactions.approve(request.toolName, request.reason, request.displayReason, request.signal)
    }))
    this.disposers.push(this.ctx.on('user-questions/request', (request, next) => {
      if (request.agent !== undefined && request.agent !== this.agent) return next()
      return this.interactions.ask(request.questions, request.signal)
    }))
    this.disposers.push(this.tui.addInputListener((data: string) => {
      if (this.panel.children.length > 0) return undefined
      if (matchesKey(data, 'shift+tab')) {
        // Cycling with an unlabeled key must never widen access silently, so a
        // full-access target asks through the same panel as a tool approval.
        void this.cyclePermissionMode()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+c')) {
        this.onInterrupt()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+d')) {
        void this.shutdown(0)
        return { consume: true }
      }
      return undefined
    }))
  }

  /** Ctrl+C: interrupt a running turn, or exit on a repeated press while idle. */
  private onInterrupt(): void {
    if (this.agent.status === 'running') {
      this.agent.cancel({ kind: 'user' }, { keepInbox: true })
      this.transcript.notice('interrupted', 'warning')
      this.tui.requestRender()
      return
    }
    const now = Date.now()
    if (now - this.lastInterruptAt < 1500) {
      void this.shutdown(0)
      return
    }
    this.lastInterruptAt = now
    this.transcript.notice('press Ctrl+C again to exit, or Ctrl+D', 'info')
    this.tui.requestRender()
  }

  private onSessionEvent(event: SessionEvent): void {
    if (event.type === 'user/message' && this.suppressedUserMessages.delete(event.data.id)) {
      // The composer already rendered this exact message when it was submitted.
      return
    }
    if (event.type === 'session/title') {
      this.title = event.data.title
      this.banner.setSubtitle(this.title)
      this.terminalTitle()
    }
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      this.usage.input += event.data.usage.inputTokens
      this.usage.output += event.data.usage.outputTokens
    }
    if (event.type === 'turn/end' && this.title === '') {
      this.title = this.ctx.get('sessionTitle')?.get(this.agent.session)?.title ?? ''
      if (this.title !== '') this.banner.setSubtitle(this.title)
    }
    this.applySessionEvent(event)
    this.updateStatus()
  }

  private applySessionEvent(event: SessionEvent): void {
    this.transcript.applyEvent(event)
    if (event.type === 'todo/write') this.reflowPlan()
    this.tui.requestRender()
  }

  private reflowPlan(): void {
    // The plan panel is a sibling of the transcript; its own invalidation is
    // enough because the component reads the latest whole-list snapshot.
    this.planPanel.invalidate()
    this.tui.requestRender()
  }

  private onAssistantFrame(frame: AssistantStreamFrame): void {
    switch (frame.type) {
      case 'start': {
        this.streaming = { turn: frame.turn, step: frame.step }
        this.transcript.streamStart(frame.turn, frame.step)
        this.updateStatus()
        this.tui.requestRender()
        return
      }
      case 'chunk': {
        const current = this.streaming
        if (current === undefined) return
        const chunk = frame.chunk
        switch (chunk.type) {
          case 'text-delta':
            this.transcript.streamDelta(current.turn, current.step, 'text', chunk.text)
            break
          case 'reasoning-delta':
            this.transcript.streamDelta(current.turn, current.step, 'reasoning', chunk.text)
            break
          case 'usage':
            break
          case 'block-start':
          case 'block-end':
          case 'tool-call-delta':
          case 'finish':
            break
          /* v8 ignore next -- closed union exhaustiveness guard */
          default:
            assertNever(chunk, 'tui assistant stream')
        }
        this.tui.requestRender()
        return
      }
      case 'end': {
        const current = this.streaming
        this.streaming = undefined
        if (current === undefined) return
        this.transcript.streamEnd(current.turn, current.step, frame.outcome.kind === 'abandoned')
        this.updateStatus()
        this.tui.requestRender()
        return
      }
      /* v8 ignore next -- closed union exhaustiveness guard */
      default:
        assertNever(frame, 'tui assistant frame')
    }
  }

  /**
   * Submit one composer line: a command, or a prompt that steers a running turn.
   * @param text - the submitted text.
   */
  private async submit(text: string): Promise<void> {
    const line = text.trim()
    if (line === '' || this.exiting) return
    if (this.switching) {
      this.transcript.notice('a session switch is in progress; wait for it to finish', 'warning')
      this.tui.requestRender()
      return
    }
    if (line.startsWith('/')) {
      const handled = await runCommandLine(this.ctx, this.agent, line, this.commandHost())
      if (handled) {
        this.tui.requestRender()
        return
      }
    }
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    const running = this.agent.status === 'running'
    this.transcript.user(text, running ? 'Steering' : undefined)
    this.suppressedUserMessages.add(message.id)
    if (running) this.agent.steer(message)
    else this.agent.followup(message)
    this.tui.requestRender()
  }

  /** The callbacks the local and registered command surfaces use. */
  private commandHost(): SlashCommandHost {
    return {
      notice: (message, level) => {
        this.transcript.notice(message, level)
        this.tui.requestRender()
      },
      exit: () => { void this.shutdown(0) },
      selectModel: (selection) => { this.selectModel(selection) },
      currentModel: () => this.agent.model.current(),
      resumeSession: async (id) => { await this.resumeSession(id) },
      clearTranscript: () => { this.clearTranscript() },
      redraw: () => { this.tui.requestRender(true) },
      signal: this.abort.signal,
    }
  }

  /**
   * Shift+Tab: switch to the next available permission preset. A preset whose
   * bundle is Full access asks first, so the unlabeled key never widens access
   * silently.
   */
  private async cyclePermissionMode(): Promise<void> {
    if (this.modeSwitching || this.panel.children.length > 0) return
    const presets = this.ctx.get('permissionPresets')
    if (presets === undefined) {
      this.transcript.notice('this composition mounts no permission presets', 'warning')
      this.tui.requestRender()
      return
    }
    const names = presets.names
    if (names.length < 2) return
    const current = presets.current(this.agent.session)
    const next = names[(names.indexOf(current) + 1) % names.length]
    /* v8 ignore next -- a non-empty list makes every modulo index valid. */
    if (next === undefined) return
    this.modeSwitching = true
    try {
      const auto = next === 'auto'
      if (presets.resolve(next).sandbox === 'danger-full-access'
        && !await this.interactions.confirm(
          auto ? 'Enable Auto mode?' : 'Enable Full access?',
          auto
            ? 'Auto mode runs tool calls without a sandbox after the same model reviews each call. Calls the review denies ask you. A review can wrongly allow or deny an action and uses extra tokens.'
            : 'Tools run without the workspace sandbox or approval prompts.',
          { allow: auto ? 'Enable Auto' : 'Enable Full access', cancel: 'Cancel' },
        )) return
      await this.applyPermissionMode(next)
      if (auto) {
        this.transcript.notice('auto mode: each tool call is reviewed before it runs', 'info')
        this.tui.requestRender()
      }
    } finally {
      this.modeSwitching = false
    }
  }

  /** Switch the live session through the `/permission` writer, or the service without a command registry. */
  private async applyPermissionMode(name: string): Promise<void> {
    if (this.ctx.get('commands')?.find(this.agent, 'permission') !== undefined) {
      await runCommandLine(this.ctx, this.agent, `/permission ${name}`, this.commandHost())
      return
    }
    const presets = this.ctx.get('permissionPresets')
    /* v8 ignore next -- cyclePermissionMode checked the same service. */
    if (presets === undefined) return
    presets.set(this.agent.session, name)
    this.transcript.notice(`permission mode: ${name}`, 'info')
    this.tui.requestRender()
  }

  private selectModel(selection: ModelSelection): void {
    this.agent.model.select(selection)
    this.updateStatus()
  }

  private clearTranscript(): void {
    this.transcript = this.createTranscript()
    this.chat.clear()
    this.chat.addChild(this.transcript.container)
    this.refreshRunningStatus()
    this.tui.requestRender(true)
  }

  private async resumeSession(idText: string): Promise<void> {
    if (this.agent.status === 'running') {
      this.transcript.notice('cannot resume another session while a turn is running', 'warning')
      this.tui.requestRender()
      return
    }
    const id = asSessionId(idText)
    if (id === this.agent.id) {
      this.transcript.notice('this session is already open', 'info')
      this.tui.requestRender()
      return
    }
    this.switching = true
    let next: AgentHandle | undefined
    let previous: AgentHandle | undefined
    let swapped = false
    try {
      next = await this.options.resume(id)
      previous = this.handle
      if (previous.agent.status === 'running') {
        previous.agent.cancel({ kind: 'user' }, { keepInbox: false })
        await bounded(previous.agent.whenIdle(), this.options.config.shutdownTimeoutMs)
      }
      this.handle = next
      swapped = true
      this.streaming = undefined
      this.usage = { input: 0, output: 0 }
      this.suppressedUserMessages.clear()
      this.planPanel.setItems([])
      this.transcript = this.createTranscript()
      this.chat.clear()
      this.chat.addChild(this.transcript.container)
      this.transcript.rebuild(next.agent.session)
      this.applyUsageFromHistory(next.agent.session)
      this.title = this.ctx.get('sessionTitle')?.get(next.agent.session)?.title ?? ''
      this.banner.setSubtitle(this.title !== '' ? this.title : this.options.config.welcome ?? '')
      this.terminalTitle()
      this.updateStatus()
      this.tui.setFocus(this.editor)
      this.tui.requestRender(true)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (swapped) {
        this.transcript.notice(`session switched, but the surface failed to refresh: ${message}`, 'warning')
      } else {
        this.transcript.notice(`resume failed: ${message}`, 'error')
        if (next !== undefined) {
          try {
            await next.dispose()
          } catch (error: unknown) {
            this.transcript.notice(`the opened session did not close cleanly: ${error instanceof Error ? error.message : String(error)}`, 'warning')
          }
        }
      }
      this.tui.requestRender()
    } finally {
      this.switching = false
    }
    if (swapped) {
      try {
        await previous?.dispose()
        this.tui.requestRender(true)
      } catch (error: unknown) {
        this.transcript.notice(`previous session did not close cleanly: ${error instanceof Error ? error.message : String(error)}`, 'warning')
        this.tui.requestRender()
      }
    }
  }

  private applyUsageFromHistory(session: Session): void {
    let input = 0
    let output = 0
    const length = session.seq
    for (let seq = 0; seq < length; seq += 1) {
      // oxlint-disable-next-line typescript/no-deprecated -- existing history read; migration deferred.
      const event = session.eventAt(SessionSeq(seq))
      /* v8 ignore next -- eventAt covers every seq below the captured length. */
      if (event?.type === 'assistant/message' && event.data.usage !== undefined) {
        input += event.data.usage.inputTokens
        output += event.data.usage.outputTokens
      }
    }
    this.usage = { input, output }
  }

  private updateStatus(): void {
    const selection = this.agent.model.current()
    this.statusBar.setState({
      title: this.title,
      cwd: this.workingDirectory(),
      /* v8 ignore next -- this surface always opens the agent with a provider/model selection. */
      model: selection === undefined ? 'model unset' : `${selection.provider}/${selection.model}`,
      tokens: this.usage.input + this.usage.output === 0 ? '' : `↑${formatTokens(this.usage.input)} ↓${formatTokens(this.usage.output)}`,
      permission: this.ctx.get('permissionPresets')?.current(this.agent.session) ?? 'permission?',
      phase: this.phase(),
      sessionId: this.agent.id,
    })
  }

  private refreshRunningStatus(): void {
    /* v8 ignore next -- the interval is cleared in stop(), so no tick observes an unstarted surface. */
    if (!this.started) return
    this.updateStatus()
    // Only a running or streaming surface changes between ticks.
    if (this.agent.status === 'running') this.tui.requestRender()
  }

  private phase(): string {
    if (this.panel.children.length > 0) return 'waiting for you'
    if (this.streaming !== undefined) return `working ${elapsed(this.runningSince)}`
    if (this.agent.status === 'running') return `working ${elapsed(this.runningSince)}`
    return 'idle'
  }

  private workingDirectory(): string {
    return this.agent.session.header.cwd ?? process.cwd()
  }

  private terminalTitle(): void {
    const sessionTitle = this.title === '' ? 'new session' : displayInlineText(this.title)
    this.options.terminal.setTitle(displayInlineText(`${sessionTitle} — ${this.options.config.title}`))
  }

  private installGlobalKeys(): void {
    // Ctrl+L redraws after external output corrupted the screen; the terminal
    // owns nothing else here.
    this.disposers.push(this.tui.addInputListener((data: string) => {
      if (matchesKey(data, 'ctrl+l')) {
        this.tui.requestRender(true)
        return { consume: true }
      }
      return undefined
    }))
  }
}

/**
 * Wait for one teardown step, giving up after a bounded interval so a stuck
 * tool cannot keep the process in a terminal-less state.
 * @param work - the settlement promise to await.
 * @param timeoutMs - maximum wait before the caller proceeds.
 */
async function bounded(work: Promise<void>, timeoutMs: number): Promise<void> {
  const { promise: timeout, reject } = Promise.withResolvers<never>()
  const timer = setTimeout(() => { reject(new Error('bounded wait elapsed')) }, timeoutMs)
  try {
    await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Format one token count for the status line. */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

/** Elapsed seconds since a turn started, as `12s`. */
function elapsed(since: number | undefined): string {
  if (since === undefined) return ''
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
  return `${String(seconds)}s`
}
