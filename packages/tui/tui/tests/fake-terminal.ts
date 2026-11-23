/**
 * Deterministic terminal double for the interactive surface: it emulates the
 * cursor and erase operations the renderer emits, so a spec can assert the
 * visible screen (not just the byte stream), and it forwards test keystrokes
 * into the renderer's input callback.
 * @module @deepseek-ai/dsh-tui/tests/fake-terminal
 */

import type { ProgramStatus, Terminal } from '@earendil-works/pi-tui'

/** East Asian wide/fullwidth ranges that occupy two terminal cells. */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u

/** Display width of one grapheme cluster; combining marks add none. */
function displayWidth(text: string): number {
  if (/\p{Mark}/u.test(text)) return 0
  return WIDE.test(text) ? 2 : 1
}

/** Minimal terminal screen model: rows of cells, a cursor, erase, and scroll. */
class Screen {
  private rows: string[][]
  private row = 0
  private col = 0

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '))
  }

  reset(): void {
    this.rows = Array.from({ length: this.height }, () => Array.from({ length: this.width }, () => ' '))
    this.row = 0
    this.col = 0
  }

  lines(): string[] {
    return this.rows.map(row => row.join('').replace(/\s+$/u, ''))
  }

  private blank(): string[] {
    return Array.from({ length: this.width }, () => ' ')
  }

  private scroll(): void {
    this.rows.shift()
    this.rows.push(this.blank())
  }

  private lineFeed(): void {
    this.row += 1
    if (this.row >= this.height) {
      this.row = this.height - 1
      this.scroll()
    }
  }

  private put(text: string): void {
    const width = displayWidth(text)
    if (width === 0) {
      const previous = this.col > 0 ? this.col - 1 : 0
      this.rows[this.row]![previous] = (this.rows[this.row]![previous] ?? '') + text
      return
    }
    if (this.col + width > this.width) {
      this.col = 0
      this.lineFeed()
    }
    this.rows[this.row]![this.col] = text
    if (width === 2) this.rows[this.row]![this.col + 1] = ''
    this.col += width
  }

  private csi(params: string, final: string): void {
    const values = params.replace(/^[?>!]/u, '').split(';').filter(value => value !== '').map(Number)
    const first = Number.isFinite(values[0]) ? (values[0] as number) : undefined
    const count = first === undefined || first === 0 ? 1 : first
    switch (final) {
      case 'A': this.row = Math.max(0, this.row - count); return
      case 'B': this.row = Math.min(this.height - 1, this.row + count); return
      case 'C': this.col = Math.min(this.width - 1, this.col + count); return
      case 'D': this.col = Math.max(0, this.col - count); return
      case 'E': this.row = Math.min(this.height - 1, this.row + count); this.col = 0; return
      case 'F': this.row = Math.max(0, this.row - count); this.col = 0; return
      case 'G': this.col = Math.max(0, Math.min(this.width - 1, count - 1)); return
      case 'H':
      case 'f': {
        const row = first === undefined ? 1 : first
        const col = Number.isFinite(values[1]) ? (values[1] as number) : 1
        this.row = Math.max(0, Math.min(this.height - 1, row - 1))
        this.col = Math.max(0, Math.min(this.width - 1, col - 1))
        return
      }
      case 'K': {
        const mode = first ?? 0
        if (mode === 2) this.rows[this.row] = this.blank()
        else if (mode === 1) for (let index = 0; index <= this.col; index += 1) this.rows[this.row]![index] = ' '
        else for (let index = this.col; index < this.width; index += 1) this.rows[this.row]![index] = ' '
        return
      }
      case 'J': {
        const mode = first ?? 0
        if (mode === 2) {
          this.rows = Array.from({ length: this.height }, () => this.blank())
          return
        }
        if (mode === 0) {
          for (let index = this.col; index < this.width; index += 1) this.rows[this.row]![index] = ' '
          for (let line = this.row + 1; line < this.height; line += 1) this.rows[line] = this.blank()
          return
        }
        for (let line = 0; line < this.row; line += 1) this.rows[line] = this.blank()
        for (let index = 0; index <= this.col; index += 1) this.rows[this.row]![index] = ' '
        return
      }
      default:
        // SGR, mode set/reset, synchronized output, and other controls do not
        // move text in this emulation.
        return
    }
  }

  write(data: string): void {
    let index = 0
    while (index < data.length) {
      const character = data[index] as string
      if (character === '\u001B') {
        const rest = data.slice(index)
        const csi = /^\u001B\[([0-9;?<=>!]*)([ -/]*)([@-~])/u.exec(rest)
        if (csi !== null) {
          this.csi(csi[1] as string, csi[3] as string)
          index += csi[0].length
          continue
        }
        const osc = /^\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/u.exec(rest)
        if (osc !== null) {
          index += osc[0].length
          continue
        }
        index += 2
        continue
      }
      if (character === '\r') {
        this.col = 0
        index += 1
        continue
      }
      if (character === '\n') {
        this.lineFeed()
        index += 1
        continue
      }
      if (character === '\b') {
        this.col = Math.max(0, this.col - 1)
        index += 1
        continue
      }
      const codePoint = data.codePointAt(index)
      if (codePoint === undefined) break
      const text = String.fromCodePoint(codePoint)
      this.put(text)
      index += text.length
    }
  }
}

/** A terminal whose size, screen, and input are controlled by the test. */
export class FakeTerminal implements Terminal {
  columns = 100
  rows = 30
  output = ''
  title = ''
  started = false
  drained = false
  progress = false
  status: ProgramStatus | undefined
  private readonly screen = new Screen(100, 30)
  private input: ((data: string) => void) | undefined

  get kittyProtocolActive(): boolean {
    return false
  }

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.input = onInput
    this.started = true
  }

  stop(): void {
    this.started = false
    this.input = undefined
  }

  async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {
    this.drained = true
  }

  write(data: string): void {
    this.output += data
    this.screen.write(data)
  }

  moveBy(_lines: number): void {}

  hideCursor(): void {}

  showCursor(): void {}

  clearLine(): void {}

  clearFromCursor(): void {}

  clearScreen(): void {}

  setTitle(title: string): void {
    this.title = title
  }

  setProgress(active: boolean): void {
    this.progress = active
  }

  setProgramStatus(status: ProgramStatus): void {
    this.status = status
  }

  /** Deliver one input chunk as if the terminal had produced it. */
  send(data: string): void {
    this.input?.(data)
  }

  /** Visible screen rows, trailing blank cells removed. */
  screenLines(): string[] {
    return this.screen.lines()
  }

  /** Visible screen joined with line feeds. */
  visible(): string {
    return this.screenLines().join('\n')
  }

  /** Clear the emulated screen and the recorded byte stream. */
  reset(): void {
    this.output = ''
    this.screen.reset()
  }
}
