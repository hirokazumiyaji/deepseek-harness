/**
 * Terminal styling for the interactive surface: one palette role per visual
 * meaning, the markdown theme derived from it, and the escape that keeps
 * untrusted text from inventing terminal controls.
 * @module @deepseek-ai/dsh-tui/theme
 */

import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'

/** Styling roles the terminal surface uses. Every field is a pure text transform. */
export interface Palette {
  /** Recessed text: reasoning, metadata, secondary labels. */
  readonly dim: (text: string) => string
  /** Interaction emphasis: headers, prompts, menu selection. */
  readonly accent: (text: string) => string
  /** The DeepSeek mark's brand ink for the welcome banner. */
  readonly brand: (text: string) => string
  /** Successful completion. */
  readonly success: (text: string) => string
  /** Failure and removed diff lines. */
  readonly error: (text: string) => string
  /** Pending work and warnings. */
  readonly warning: (text: string) => string
  readonly bold: (text: string) => string
  readonly italic: (text: string) => string
  readonly underline: (text: string) => string
  /** Reverse video for the highlighted menu row. */
  readonly inverse: (text: string) => string
}

/** The identity transform used by every role when color is disabled. */
const plain = (text: string): string => text

/** Whether the composed palette emits ANSI. */
export interface PaletteOptions {
  /** Apply the built-in ANSI palette; false strips every style. */
  readonly color: boolean
}

/**
 * Build the palette. Only standard-16 ANSI foregrounds and SGR attributes are
 * used, so terminals remap the roles to their active light or dark scheme; the
 * brand ink is the one deliberate truecolor exception.
 * @param options - whether styling is enabled.
 * @returns the palette for this surface.
 */
export function createPalette(options: PaletteOptions): Palette {
  if (!options.color) {
    return {
      dim: plain,
      accent: plain,
      brand: plain,
      success: plain,
      error: plain,
      warning: plain,
      bold: plain,
      italic: plain,
      underline: plain,
      inverse: plain,
    }
  }
  const sgr = (code: string) => (text: string): string => `\u001B[${code}m${text}\u001B[0m`
  return {
    dim: sgr('2'),
    accent: sgr('36'),
    brand: sgr('38;2;77;107;254'),
    success: sgr('32'),
    error: sgr('31'),
    warning: sgr('33'),
    bold: sgr('1'),
    italic: sgr('3'),
    underline: sgr('4'),
    inverse: sgr('7'),
  }
}

/**
 * Derive the markdown theme a rendered assistant message uses.
 * @param palette - active palette.
 * @returns the theme handed to pi-tui's `Markdown`.
 */
export function markdownThemeFor(palette: Palette): MarkdownTheme {
  return {
    heading: text => palette.bold(palette.accent(text)),
    link: text => palette.accent(palette.underline(text)),
    linkUrl: text => palette.dim(text),
    code: text => palette.dim(text),
    codeBlock: text => palette.dim(text),
    codeBlockBorder: text => palette.dim(text),
    quote: text => palette.italic(palette.dim(text)),
    quoteBorder: text => palette.dim(text),
    hr: text => palette.dim(text),
    listBullet: text => palette.accent(text),
    bold: text => palette.bold(text),
    italic: text => palette.italic(text),
    strikethrough: text => text,
    underline: text => palette.underline(text),
  }
}

/**
 * C0 and C1 controls other than line feed, tab, and escape-introducer prefix,
 * rendered as visible `\xNN` text so model and tool output can never move the
 * cursor, clear the screen, or change colors. `\u001B` is handled with its
 * introducer so a two-character CSI/OSC prefix stays readable.
 */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu

/**
 * Escape terminal controls in untrusted text before it reaches a renderer.
 * Line feeds and tabs are preserved because the renderers wrap on them.
 * @param text - untrusted text from a model, tool, or session event.
 * @returns text safe to place in an ANSI-styled line.
 */
export function displayText(text: string): string {
  return text.replace(CONTROL, character =>
    `\\x${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

/**
 * Escape untrusted text for one line, folding line feeds into spaces so a
 * caller that owns the line layout cannot be broken out of it.
 * @param text - untrusted text.
 * @returns one displayable line.
 */
export function displayInlineText(text: string): string {
  return displayText(text.replace(/\r\n?/gu, '\n')).replace(/\n/gu, ' ')
}

/**
 * Editor and autocomplete styling derived from the palette.
 * @param palette - active palette.
 * @returns the theme pi-tui's Editor expects.
 */
export function editorThemeFor(palette: Palette): EditorTheme {
  const selectList: SelectListTheme = {
    selectedPrefix: palette.accent,
    selectedText: text => palette.bold(palette.accent(text)),
    description: palette.dim,
    scrollInfo: palette.dim,
    noMatch: palette.dim,
  }
  return { borderColor: palette.dim, selectList }
}
