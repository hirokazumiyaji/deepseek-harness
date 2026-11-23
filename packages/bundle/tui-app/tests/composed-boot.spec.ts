/**
 * Composed boot of the shipped `tui-app` layer. The first check composes the
 * real base and tui-app patch documents and asserts the rows they contribute.
 * The second runs the composed rows through a real Loader, AgentLoop, and
 * scripted model adapter in a subprocess, so no global shims or fixed sleeps
 * decide startup.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'

const basePatch = new URL('../../base/cordis.patch.yml', import.meta.url)
const tuiPatch = new URL('../cordis.patch.yml', import.meta.url)
const fixture = fileURLToPath(new URL('./fixtures/boot-source.ts', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Compose the shipped base and tui-app layers. */
function composedEntries() {
  const layers = [
    loadOverlayPatches('dsh', fileURLToPath(basePatch)),
    loadOverlayPatches('dsh', fileURLToPath(tuiPatch)),
  ]
  return composeEntries(layers)
}

/** Run one subprocess boot and collect its result. */
async function runBoot(out: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', fixture, '--out', out], {
      cwd: repoRoot,
      env: { ...process.env, DSH_HOME: out, DSH_TELEMETRY_DISABLED: '1', NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`boot fixture timed out\n${stderr}`))
    }, 60_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

describe('composed tui-app layer', () => {
  it('declares the surface, startup provider, ask-user tool, and persona', () => {
    const entries = composedEntries()
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    expect(byId.get('tui')?.name).toBe('@deepseek-ai/dsh-tui')
    expect(byId.get('tui')?.inject).toEqual(['tuiStartup'])
    expect(byId.get('tui-startup')?.name).toBe('@deepseek-ai/dsh-tui/startup')
    expect(byId.get('tool-ask-user')?.name).toBe('@deepseek-ai/dsh-tool-ask-user')
    expect(byId.get('system-prompt')?.config).toMatchObject({
      personaPrefix: 'You are a coding agent powered by the {{model}} model.',
    })
    expect(byId.get('hmr')?.disabled).toBe(true)
  })

  it('boots the composed rows through a real Loader with the real AgentLoop', async () => {
    const out = mkdtempSync(join(tmpdir(), 'dsh-tui-composed-'))
    tempDirs.push(out)
    const result = await runBoot(out)
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const summary = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
    expect(summary).toEqual({
      started: true,
      answered: true,
      toolRegistered: true,
      exited: true,
      exit: 0,
    })
  }, 90_000)
})
