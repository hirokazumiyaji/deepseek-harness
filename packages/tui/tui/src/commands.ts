/**
 * The slash-command surface of the terminal front door: TUI-local controls
 * (`/exit`, `/help`, `/status`, `/model`, `/resume`) plus dispatch to every
 * command another plugin registered on `ctx.commands`. A line that no surface
 * resolves is reported instead of becoming a model prompt.
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent/types'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Callbacks the app supplies to the command surface. */
export interface SlashCommandHost {
  /** Show one notice in the transcript. */
  notice(text: string, level: 'info' | 'warning' | 'error'): void
  /** Leave the interactive surface and exit the process. */
  exit(): void
  /** Replace the model selection for later steps. */
  selectModel(selection: ModelSelection): void
  /** Read the selection later steps would use. */
  currentModel(): ModelSelection | undefined
  /** Resume one persisted session in this process. */
  resumeSession(sessionId: string): Promise<void>
  /** Drop the rendered transcript without changing the session log. */
  clearTranscript(): void
  /** Ask the terminal renderer for a redraw. */
  redraw(): void
  /** Abort signal lifetime of this surface. */
  readonly signal: AbortSignal
}

/** One discovered command the help screen can list. */
interface ListedCommand {
  readonly name: string
  readonly description: string
}

/** One routable model row for the selector. */
interface ModelRow {
  readonly provider: string
  readonly id: string
  readonly name: string
}

/** TUI-local commands, in help order. */
const LOCAL_COMMANDS: readonly ListedCommand[] = [
  { name: 'help', description: 'List available commands' },
  { name: 'exit', description: 'Leave the terminal surface (also Ctrl+D)' },
  { name: 'status', description: 'Show session, model, and usage facts' },
  { name: 'model', description: 'Select a model: /model [provider/]model' },
  { name: 'resume', description: 'List recent sessions or resume one: /resume <id>' },
  { name: 'clear', description: 'Clear the rendered transcript (the session log is kept)' },
  { name: 'redraw', description: 'Redraw the terminal' },
]

/**
 * Parse and run one submitted line.
 * @param ctx - plugin context carrying the command registry.
 * @param agent - the exact agent the command targets.
 * @param line - the submitted text.
 * @param host - app callbacks for local commands.
 * @returns whether the line was a command that this surface handled.
 */
export async function runCommandLine(
  ctx: Context,
  agent: Agent,
  line: string,
  host: SlashCommandHost,
): Promise<boolean> {
  const parsed = parseCommand(line)
  if (parsed === undefined) return false
  const name = parsed.name
  const registered = ctx.get('commands')
  if (registered?.find(agent, name) !== undefined) {
    const execution = await registered.execute(agent, line, [], host.signal)
    if (execution === undefined) {
      host.notice(`unknown command: /${name}`, 'warning')
      return true
    }
    const result = execution.result
    if (result.kind === 'success') {
      if (result.text !== undefined && result.text !== '') host.notice(result.text, 'info')
    } else {
      host.notice(result.text, 'error')
    }
    return true
  }
  const handled = await runLocalCommand(ctx, agent, name, parsed.rawInput.trim(), host)
  if (!handled) host.notice(`unknown command: /${name} — try /help`, 'warning')
  return true
}

async function runLocalCommand(
  ctx: Context,
  agent: Agent,
  name: string,
  input: string,
  host: SlashCommandHost,
): Promise<boolean> {
  switch (name) {
    case 'help': {
      listCommands(ctx, agent, host)
      return true
    }
    case 'exit':
    case 'quit': {
      host.exit()
      return true
    }
    case 'status': {
      reportStatus(ctx, agent, host)
      return true
    }
    case 'model': {
      await selectModel(ctx, input, host)
      return true
    }
    case 'resume': {
      await resume(ctx, input, host)
      return true
    }
    case 'clear': {
      host.clearTranscript()
      return true
    }
    case 'redraw': {
      host.redraw()
      return true
    }
    default:
      return false
  }
}

function listCommands(ctx: Context, agent: Agent, host: SlashCommandHost): void {
  const registered = ctx.get('commands')?.list(agent) ?? []
  const seen = new Set(LOCAL_COMMANDS.map(command => command.name))
  const rows: string[] = ['Commands:']
  for (const command of LOCAL_COMMANDS) {
    rows.push(`  /${command.name.padEnd(12)} ${command.description}`)
  }
  for (const command of registered) {
    if (seen.has(command.name)) continue
    seen.add(command.name)
    const hint = command.input === undefined ? '' : ` ${command.input.hint}`
    rows.push(`  /${`${command.name}${hint}`.padEnd(12)} ${command.description}`)
  }
  host.notice(rows.join('\n'), 'info')
}

function reportStatus(ctx: Context, agent: Agent, host: SlashCommandHost): void {
  const selection = host.currentModel()
  const preset = ctx.get('permissionPresets')?.current(agent.session) ?? 'unknown'
  const approval = ctx.get('approval')?.overrideOf(agent.session) ?? 'ask'
  const cwd = agent.session.header.cwd ?? process.cwd()
  const title = ctx.get('sessionTitle')?.get(agent.session)?.title
  host.notice([
    'Session status:',
    `  id          ${agent.session.id}`,
    `  title       ${title ?? '(untitled)'}`,
    `  cwd         ${cwd}`,
    `  model       ${selection === undefined ? 'unset' : `${selection.provider}/${selection.model}`}`,
    `  effort      ${selection?.reasoningEffort ?? 'default'}`,
    `  state       ${agent.status}`,
    `  permission  ${preset}`,
    `  approval    ${approval}`,
    `  events      ${String(agent.session.seq)}`,
  ].join('\n'), 'info')
}

async function collectModels(ctx: Context): Promise<ModelRow[]> {
  const llm = ctx.get('llm')
  if (llm === undefined) return []
  const rows: ModelRow[] = []
  for (const provider of llm.listProviders()) {
    try {
      const models = await llm.listModels(provider.id)
      for (const model of models) rows.push({ provider: provider.id, id: model.id, name: model.name })
    } catch {
      // A provider whose catalog cannot be read simply offers no rows.
      continue
    }
  }
  return rows
}

async function selectModel(ctx: Context, input: string, host: SlashCommandHost): Promise<void> {
  const current = host.currentModel()
  const rows = await collectModels(ctx)
  if (input === '') {
    if (rows.length === 0) {
      host.notice('this deployment advertises no routable models; select with /model <provider>/<model>', 'warning')
      return
    }
    const lines = ['Model routes:']
    for (const row of rows) lines.push(`  ${row.provider}/${row.id}  ${row.name === row.id ? '' : row.name}`.trimEnd())
    if (current !== undefined) lines.push('', `current: ${current.provider}/${current.model}`)
    lines.push('', 'Select with /model <provider>/<model>.')
    host.notice(lines.join('\n'), 'info')
    return
  }
  const selection = resolveModelInput(input, current, rows)
  if (selection === undefined) {
    host.notice(`no model matches "${input}"`, 'warning')
    return
  }
  host.selectModel(selection)
  host.notice(`model: ${selection.provider}/${selection.model}`, 'info')
}

/** Resolve `/model` text against the current route and the advertised rows. */
function resolveModelInput(
  input: string,
  current: ModelSelection | undefined,
  rows: readonly ModelRow[],
): ModelSelection | undefined {
  const slash = input.indexOf('/')
  if (slash > 0) {
    const provider = input.slice(0, slash)
    const model = input.slice(slash + 1)
    return { provider, model }
  }
  if (current !== undefined && rows.some(row => row.provider === current.provider && row.id === input)) {
    return {
      provider: current.provider,
      model: input,
      ...current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort },
    }
  }
  const byProvider = new Map<string, string>()
  for (const row of rows) {
    if (row.id === input) byProvider.set(row.provider, row.id)
  }
  if (byProvider.size === 1) {
    for (const [provider, model] of byProvider) return { provider, model }
  }
  // A deployment with exactly one registered route treats an unlisted id as
  // that route's model: adapters may accept ids their advisory catalog omits.
  const providerNames = new Set(rows.map(row => row.provider))
  if (providerNames.size === 1) {
    for (const provider of providerNames) return { provider, model: input }
  }
  return undefined
}

async function resume(ctx: Context, input: string, host: SlashCommandHost): Promise<void> {
  if (input !== '') {
    await host.resumeSession(input)
    return
  }
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    host.notice('session listing requires the sessionQuery service', 'error')
    return
  }
  const records = (await query.listSessions(host.signal)).slice(0, 10)
  if (records.length === 0) {
    host.notice('no persisted sessions', 'info')
    return
  }
  const ids = records.map(record => record.header.id)
  let titles: (string | undefined)[] = []
  try {
    const results = await query.readTitleSnapshots(ids, host.signal)
    titles = results.map(result => result.status === 'fulfilled' ? result.value.title?.title : undefined)
  } catch {
    // A cancelled title scan leaves the ids usable; the picker stays useful.
    titles = []
  }
  const rows = ['Recent sessions:']
  records.forEach((record, index) => {
    const title = titles[index] ?? '(untitled)'
    const cwd = record.header.cwd ?? '(no recorded cwd)'
    rows.push(`  ${record.header.id}  ${title}  ${cwd}`)
  })
  rows.push('', 'Resume one with /resume <id>.')
  host.notice(rows.join('\n'), 'info')
}

/**
 * Brand a user-supplied session id.
 * @param value - the exact id the user typed.
 * @returns the same string carrying the browser-safe Session identity brand.
 */
export function asSessionId(value: string): SessionId {
  return brandString<SessionId>(value)
}
