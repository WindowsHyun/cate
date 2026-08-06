import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/electron-app'
import type { ElectronApplication, Page } from 'playwright'
import { mkdtempSync, writeFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.afterEach(async () => {
  if (app) await closeApp(app)
})

// Feature #13 (extension-grouped canvas opens): reopening an already-grouped
// file must switch the hosting node's active tab to it, not just bring the
// node into view showing whatever tab was already up (focusPanelNode used to
// only call focusAndCenter and never touched the node's active tab).
test('canvas mode: re-opening a grouped file switches its node to that file\'s tab', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-canvasmode-'))
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ fileOpenMode: 'canvas' }))

  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'cate-project-')))
  const fileA = join(projectDir, 'values-a.yaml')
  const fileB = join(projectDir, 'values-b.yaml')
  writeFileSync(fileA, 'name: a\n')
  writeFileSync(fileB, 'name: b\n')

  ;({ electronApp: app, mainWindow: page } = await launchApp({ userDataDir }))
  await page.evaluate((root) => window.__cateE2E!.setWorkspaceRoot(root), projectDir)
  await page.evaluate(() => window.__cateE2E!.openSidebarView('explorer'))

  const rowA = page.locator(`[data-filepath="${fileA}"]`)
  const rowB = page.locator(`[data-filepath="${fileB}"]`)
  await rowA.waitFor({ timeout: 5000 })
  await rowA.dblclick()
  await page.waitForTimeout(400)
  await rowB.dblclick()
  await page.waitForTimeout(400)

  // Both files land in the SAME canvas node (grouped by extension).
  const nodes = await page.evaluate(() => window.__cateE2E!.nodes())
  expect(nodes).toHaveLength(1)

  // Re-open A (already open, currently a background tab behind B) — the
  // node's visible content must switch to A.
  await rowA.dblclick()
  await page.waitForTimeout(400)

  const visibleText = await page.evaluate(() => document.querySelector('.view-lines')?.textContent ?? null)
  expect(visibleText?.startsWith('name:')).toBe(true)
  expect(visibleText?.trim().endsWith('a')).toBe(true)
})
