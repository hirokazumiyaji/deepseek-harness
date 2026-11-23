/** New-session permission defaults across the shipped bundle compositions. */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PRESETS = ['read-only', 'workspace-write', 'danger-full-access']

/** Load one shipped bundle patch through the same parser as profile boot. */
function bundle(name: 'acp-app' | 'base' | 'headless' | 'sdk-app' | 'tui-app' | 'web-app'): PatchOptions[] {
  return loadOverlayPatches('permission default test', join(REPOSITORY_ROOT, 'packages', 'bundle', name, 'cordis.patch.yml'))
}

/** Effective permission row config after the supplied bundle layers. */
function permission(layers: PatchOptions[][]): { defaultPreset?: string; presets: Record<string, unknown> } {
  const row = composeEntries(layers).find(entry => entry.id === 'permission')
  if (row === undefined) throw new Error('the base bundle must insert the permission row')
  return row.config as { defaultPreset?: string; presets: Record<string, unknown> }
}

describe('shipped permission defaults', () => {
  it('starts new Web sessions in Auto while restating the base preset table', () => {
    const config = permission([bundle('base'), bundle('web-app')])
    expect(config.defaultPreset).toBe('auto')
    expect(Object.keys(config.presets)).toEqual(PRESETS)
  })

  it('starts new TUI sessions in Auto while restating the base preset table', () => {
    const config = permission([bundle('base'), bundle('tui-app')])
    expect(config.defaultPreset).toBe('auto')
    expect(Object.keys(config.presets)).toEqual(PRESETS)
  })

  it.each(['headless', 'sdk-app', 'acp-app'] as const)('%s keeps the base inferred workspace-write default', (mode) => {
    const config = permission([bundle('base'), bundle(mode)])
    expect(config.defaultPreset).toBeUndefined()
    expect(Object.keys(config.presets)).toEqual(PRESETS)
  })
})
