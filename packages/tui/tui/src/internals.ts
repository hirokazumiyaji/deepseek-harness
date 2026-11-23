/**
 * Process facts the terminal surface reads, kept out of the package entry so
 * substituting them in tests adds no public package API.
 * @module @deepseek-ai/dsh-tui/internals
 */

import { ProcessTerminal, type Terminal } from '@earendil-works/pi-tui'

/** The process facts the terminal surface reads; tests substitute them. */
export const internals: {
  stdinIsTty: () => boolean
  stdoutIsTty: () => boolean
  createTerminal: () => Terminal
  stderr: { write(chunk: string): unknown }
} = {
  // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- isTTY is absent on a non-TTY stream
  stdinIsTty: () => Boolean(process.stdin.isTTY),
  // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- isTTY is absent on a non-TTY stream
  stdoutIsTty: () => Boolean(process.stdout.isTTY),
  createTerminal: () => new ProcessTerminal(),
  stderr: process.stderr,
}
