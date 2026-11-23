/**
 * Subprocess boot of the shipped `tui-app` layer: composes the real base and
 * tui-app patches, boots their rows through the Loader with the real AgentLoop
 * and a scripted model adapter, drives the surface through a recording
 * terminal, and prints one JSON summary. Run with `node --import tsx/esm`.
 *
 * Inputs: `--out <dir>` sets the Harness home (session persistence root). The
 * startup prompt is the positional `hello`.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stringifyEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { internals } from '@deepseek-ai/dsh-tui/src/internals.ts'

const root = new URL('../../../../..', import.meta.url)
const repoRoot = fileURLToPath(root)

/** Keyless adapter with one fixed answer. */
class ScriptedAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = 'The real loop answered this prompt.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 7 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Recording terminal that stores the last frame text and keeps the input callback. */
class RecordingTerminal {
  columns = 100
  rows = 30
  output = ''
  started = false
  title = ''
  input: ((data: string) => void) | undefined
  get kittyProtocolActive(): boolean { return false }
  start(onInput: (data: string) => void): void {
    this.input = onInput
    this.started = true
  }
  stop(): void { this.started = false }
  async drainInput(): Promise<void> {}
  write(data: string): void { this.output += data }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(title: string): void { this.title = title }
  setProgress(): void {}
  setProgramStatus(): void {}
  visible(): string {
    return this.output.replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu, '').replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/gu, '')
  }
}

/** Poll a predicate to a deadline and return whether it held. */
async function until(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return predicate()
}

/** Parse `--out <dir>` from argv. */
function outDir(argv: readonly string[]): string {
  const index = argv.indexOf('--out')
  const value = index >= 0 ? argv[index + 1] : undefined
  if (value === undefined) throw new Error('boot-source: --out <dir> is required')
  return value
}

/** Compose and boot the shipped tui rows, drive one turn, and report. */
async function main(): Promise<void> {
  const out = outDir(process.argv.slice(2))
  process.env.DSH_HOME = out
  const dir = mkdtempSync(join(out, 'boot-'))
  const configPath = join(dir, 'cordis.yml')
  const patch = (path: string) => loadOverlayPatches('dsh', path)
  const composed = composeEntries([
    patch(join(repoRoot, 'packages/bundle/base/cordis.patch.yml')),
    patch(join(repoRoot, 'packages/bundle/tui-app/cordis.patch.yml')),
  ])
  const persona = (composed.find(entry => entry.id === 'system-prompt')?.config as { personaPrefix?: string } | undefined)?.personaPrefix
  const entries = composed.filter(entry => ['tui-startup', 'tui', 'tool-ask-user'].includes(entry.id))
  writeFileSync(configPath, stringifyEntryYaml(entries))

  const terminal = new RecordingTerminal()
  internals.stdinIsTty = () => true
  internals.stdoutIsTty = () => true
  internals.createTerminal = () => terminal
  const exits: number[] = []
  let ready: (() => void) | undefined

  const ctx = new Context()
  await ctx.plugin(SessionPersistenceJsonl, { root: join(out, 'sessions'), compression: 'none' })
  await mountAgentLoopTestDependencies(ctx, persona === undefined ? {} : { systemPrompt: { personaPrefix: persona } })
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(UserQuestionService)
  ctx.llm.registerAdapter(['scripted'], new ScriptedAdapter())
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, {
    args: ['hello'],
    exit: (code: number) => { exits.push(code) },
    ready: { onReady: (listener: () => void) => { ready = listener; return () => { ready = undefined } } },
  })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'scripted', model: 'scripted' }) })
  ctx.provide('fs', {
    resolve: async () => ({ targetKey: process.cwd(), displayPath: process.cwd() }),
    processPath: () => process.cwd(),
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  ready?.()
  const started = await until(() => terminal.started && terminal.visible().includes('Harness'), 10_000)
  const answered = await until(() => terminal.visible().includes('The real loop answered this prompt.'), 10_000)
  const toolRegistered = ctx.get('tools')?.get('ask_user_question') !== undefined
  terminal.input?.('\u0004')
  const exited = await until(() => exits.length > 0, 10_000)
  process.stdout.write(`${JSON.stringify({ started, answered, toolRegistered, exited, exit: exits[0] ?? null })}\n`)
  if (!started || !answered || !toolRegistered || !exited || exits[0] !== 0) process.exitCode = 1
}

await main()
