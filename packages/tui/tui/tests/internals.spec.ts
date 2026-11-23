/** Process facts the terminal surface reads, with no PTY and no terminal start. */

import { describe, expect, it } from 'vitest'
import { internals } from '../src/internals.ts'

describe('process facts', () => {
  it('reports TTY state, terminal bounds, and the stderr sink', () => {
    expect(typeof internals.stdinIsTty()).toBe('boolean')
    expect(typeof internals.stdoutIsTty()).toBe('boolean')
    const terminal = internals.createTerminal()
    expect(terminal.columns).toBeGreaterThan(0)
    expect(terminal.rows).toBeGreaterThan(0)
    expect(internals.stderr).toBe(process.stderr)
  })
})
