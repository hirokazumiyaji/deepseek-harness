// Web e2e scenario: the shipped Web composition starts a new session in Auto
// and advertises Auto as the future-session default in General settings. Zero
// model calls: the scenario boots the shipped bundles, composes the real
// permission service with the live Auto review integration, and reads the
// rendered controls.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, openSettings, saveFailureShot } from './support.ts'

describe('web e2e: shipped Auto default', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ autoPermissionDefault: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('starts a new session in Auto and offers Auto as the future-session default', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-auto-default'))
    const access = page.locator('button[aria-label^="Access mode"]').first()
    await access.waitFor({ timeout: 10_000 })
    expect(await access.getAttribute('aria-label')).toBe('Access mode, current: Auto')
    expect(await access.textContent()).toContain('Auto')

    await openSettings(page, 'en')
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    const selector = dialog.getByRole('button', { name: 'Auto', exact: true })
    await expect.poll(() => selector.isEnabled(), { timeout: 5_000 }).toBe(true)
    expect(await selector.textContent()).toContain('Auto')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
