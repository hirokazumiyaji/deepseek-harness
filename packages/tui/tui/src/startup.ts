/**
 * Terminal app command line: it parses `--resume`, the permission and approval
 * options, extra write roots, and an optional first prompt, then publishes
 * {@link TUI_STARTUP_SERVICE}. The surface is an ordinary consumer whose lazily
 * resolved config waits for that service, so `--help` (which exits during this
 * parse) never starts the terminal.
 * @module @deepseek-ai/dsh-tui/startup
 */

import { Command, Option } from 'commander'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { APPROVAL_POLICIES, type ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the invocation can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the terminal surface. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the surface row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Persisted Session identity to resume; absent starts a fresh session. */
  resume?: string
  /** Prompt submitted as the first turn once the surface is live. */
  prompt?: string
  /** Permission preset applied before the first prompt. */
  permissionMode?: string
  /** Approval behavior applied before the first prompt. */
  approvalPolicy?: ApprovalPolicy
  /** Explicit absolute write grants for this invocation. */
  additionalWritableRoots?: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Parsed arguments of this terminal invocation. */
    tuiStartup?: TuiStartupValues
  }
}

/**
 * This app's command: session choice, run options, first prompt, and help.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Open the interactive terminal surface: streamed replies, tool cards, approvals, and slash commands.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <id>', 'resume the persisted Session with this id; an unknown id is an error')
    .option('--permission-mode <preset>', 'select a configured permission preset for this session')
    .addOption(new Option('--approval-policy <policy>', 'set approval behavior for this session')
      .choices([...APPROVAL_POLICIES]))
    .option('--add-dir <path>', 'allow an additional physical absolute directory under workspace-write (repeatable)',
      (value: string, previous?: string[]) => [...previous ?? [], value])
    .argument('[prompt...]', 'an initial prompt; omitted opens an empty composer')
    .addHelpText('after', `
Keys:
  Enter          send a prompt; while the agent runs the text steers the next step
  Shift+Tab      cycle the permission mode (auto mode reviews each tool call)
  Ctrl+C         interrupt the running turn; twice while idle exits
  Ctrl+D         exit
  Ctrl+L         redraw the terminal

Commands:
  /help          list commands       /status    session facts
  /model         choose a model      /resume    list or resume a session
  /permission    switch sandbox + approval      /clear  clear the view
  /exit          leave

Examples:
  dsh tui                                start a new session in this directory
  dsh tui "explain this repository"      start with a first prompt
  dsh tui --resume session-…             continue a persisted session
  dsh tui --permission-mode read-only    restrict writes for this session
  dsh tui --permission-mode auto         let the same model review each tool call
`)
}

/**
 * Parse and provide the terminal invocation as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    if (program.args.length > 0 && program.args.join(' ').trim() === '') {
      program.error('error: a prompt must not be blank')
    }
    const options = program.opts<{
      resume?: string
      permissionMode?: string
      approvalPolicy?: ApprovalPolicy
      addDir?: string[]
    }>()
    if (options.resume !== undefined && options.resume.trim() === '') {
      program.error('error: --resume requires a non-empty session id')
    }
    if (options.permissionMode !== undefined && options.permissionMode.trim() === '') {
      program.error('error: --permission-mode requires a non-empty preset name')
    }
    if (options.addDir?.some(path => !isAbsolute(path) || path.includes('\0')) === true) {
      program.error('error: --add-dir requires an absolute directory path in the execution environment')
    }
    const prompt = program.args.length === 0 ? undefined : program.args.join(' ')
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...options.resume === undefined ? {} : { resume: options.resume },
      ...prompt === undefined ? {} : { prompt },
      ...options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode.trim() },
      ...options.approvalPolicy === undefined ? {} : { approvalPolicy: options.approvalPolicy },
      ...options.addDir === undefined ? {} : { additionalWritableRoots: [...new Set(options.addDir)] },
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
