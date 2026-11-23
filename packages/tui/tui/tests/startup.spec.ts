/**
 * The terminal command-line provider over a real Loader tree: parsed options
 * become the injected `tuiStartup` service, while help and usage errors leave
 * the consumer pending and request a bounded exit.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals as cmdlineInternals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  err: string
  consumerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []
const tempDirs: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  cmdlineInternals.stdout = process.stdout
  cmdlineInternals.stderr = process.stderr
})

/**
 * Mount the real provider over a consumer stand-in.
 * @param args - the invocation's inner arguments.
 */
async function bootStartup(args: string[]): Promise<{ startup: TuiStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '', err: '' }
  writeFileSync(join(dir, 'consumer.mjs'), 'export function apply(_ctx, config) { globalThis.__tuiStartupObserved.consumerConfig = config }\n')
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: tui',
    `  name: ${pathToFileURL(join(dir, 'consumer.mjs')).href}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    '    resume: !!js ctx.tuiStartup.resume',
    '    prompt: !!js ctx.tuiStartup.prompt',
    '    permissionMode: !!js ctx.tuiStartup.permissionMode',
    '    approvalPolicy: !!js ctx.tuiStartup.approvalPolicy',
    '    additionalWritableRoots: !!js ctx.tuiStartup.additionalWritableRoots',
    '- id: tui-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  const observingErr = { write: (chunk: string) => { observed.out += chunk; observed.err += chunk; return true } }
  cmdlineInternals.stdout = observing
  cmdlineInternals.stderr = observingErr
  Reflect.set(globalThis, '__tuiStartupApply', apply)
  Reflect.set(globalThis, '__tuiStartupObserved', observed)

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { startup: ctx.get(TUI_STARTUP_SERVICE), observed }
}

describe('terminal command-line provider', () => {
  it('joins the prompt positional and publishes it', async () => {
    const { startup, observed } = await bootStartup(['explain', 'the', 'repo'])
    expect(startup).toEqual({ prompt: 'explain the repo' })
    expect(observed.consumerConfig).toMatchObject({ prompt: 'explain the repo' })
    expect(observed.exits).toEqual([])
  })

  it('publishes resume, permission, approval, and write grants', async () => {
    const { startup } = await bootStartup([
      '--resume', 'session-7', '--permission-mode', 'read-only',
      '--approval-policy', 'never', '--add-dir', '/tmp/a', '--add-dir', '/tmp/a', '--add-dir', '/tmp/b',
    ])
    expect(startup).toEqual({
      resume: 'session-7',
      permissionMode: 'read-only',
      approvalPolicy: 'never',
      additionalWritableRoots: ['/tmp/a', '/tmp/b'],
    })
  })

  it('prints help and exits without publishing the service', async () => {
    const { startup, observed } = await bootStartup(['--help'])
    expect(observed.exits).toEqual([0])
    expect(observed.out).toContain('dsh --profile tui')
    expect(observed.out).toContain('--resume <id>')
    expect(startup).toBeUndefined()
    expect(observed.consumerConfig).toBeUndefined()
  })

  it('rejects a blank resume id and exits nonzero', async () => {
    const { startup, observed } = await bootStartup(['--resume', ' '])
    expect(observed.exits).toEqual([1])
    expect(observed.err).toContain('--resume requires a non-empty session id')
    expect(startup).toBeUndefined()
  })

  it('rejects a blank prompt and a blank permission preset', async () => {
    const blank = await bootStartup([' '])
    expect(blank.observed.exits).toEqual([1])
    expect(blank.observed.err).toContain('a prompt must not be blank')
    expect(blank.startup).toBeUndefined()

    const preset = await bootStartup(['--permission-mode', ' '])
    expect(preset.observed.exits).toEqual([1])
    expect(preset.observed.err).toContain('--permission-mode requires a non-empty preset name')
  })

  it('rejects a relative extra write root', async () => {
    const { startup, observed } = await bootStartup(['--add-dir', 'relative/path'])
    expect(observed.exits).toEqual([1])
    expect(observed.err).toContain('--add-dir requires an absolute directory path')
    expect(startup).toBeUndefined()
  })
})
