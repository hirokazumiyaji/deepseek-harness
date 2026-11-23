/** Optional visual evidence for Auto scenarios. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

/** Save a fixed-state screenshot when the calling validation requests evidence. */
export async function captureAutoReviewState(page: Page, name: string): Promise<void> {
  const directory = process.env.DSH_AUTO_REVIEW_SCREENSHOT_DIR
  if (directory === undefined) return
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true })
}
