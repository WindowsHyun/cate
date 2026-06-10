// E2E: browser panel does NOT reload when the user clicks a terminal next to it
// and then clicks back on the browser.
//
// Root cause of the bug: DockTabStack unmounted the inactive browser panel on tab
// switch, destroying the webview and causing a full page reload on re-activation.
// Fix: browser panels stay mounted (visibility:hidden) so the webview is never
// destroyed. This test confirms no additional did-start-loading event fires after
// the initial page load.

import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchApp, closeApp } from './fixtures/electron-app'

test('browser panel does not reload when switching canvas focus to a terminal and back', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-browser-reload-'))

  const { electronApp: app, mainWindow: page } = await launchApp({ userDataDir })

  try {
    // Place panels far enough apart that neither is off-screen (no viewport culling).
    const browserOrigin = { x: 100, y: 100 }
    const terminalOrigin = { x: 900, y: 100 }

    // Create the browser panel with about:blank so the webview never redirects —
    // this isolates focus-triggered reloads from the page's own load sequence.
    const browserHint = await page.evaluate(
      (pt) => window.__cateE2E!.createBrowserPanel(pt, 'about:blank'),
      browserOrigin,
    )
    const browserNodeId: string = await page
      .waitForFunction(
        (h) => {
          const n = window.__cateE2E!.nodes().find((x) => x.id === h || x.panelId === h)
          return n ? n.id : null
        },
        browserHint,
        { timeout: 10_000 },
      )
      .then((h) => h.jsonValue() as Promise<string>)

    // Create a terminal panel next to the browser.
    const terminalHint = await page.evaluate(
      (pt) => window.__cateE2E!.createTerminal(pt),
      terminalOrigin,
    )
    const terminalNodeId: string = await page
      .waitForFunction(
        (h) => {
          const n = window.__cateE2E!.nodes().find((x) => x.id === h || x.panelId === h)
          return n ? n.id : null
        },
        terminalHint,
        { timeout: 10_000 },
      )
      .then((h) => h.jsonValue() as Promise<string>)

    // Wait for the browser panel to appear in the DOM.
    await page.waitForFunction(
      (nid) => {
        const el = document.querySelector(`[data-node-id="${nid}"] [data-browser-panel-id]`)
        return !!el
      },
      browserNodeId,
      { timeout: 15_000 },
    )

    // Wait for the initial load to SETTLE: poll until two reads 600ms apart agree.
    // Without this, the count could still be mid-load (e.g. did-start-loading has
    // fired but the second phase hasn't yet) and the +1 we'd attribute to the focus
    // switch might actually belong to the initial load sequence.
    const countAfterMount = await (async () => {
      for (let i = 0; i < 10; i++) {
        const a = await page.evaluate(
          (nid) => window.__cateE2E!.getBrowserPanelLoadCount(nid),
          browserNodeId,
        )
        await page.waitForTimeout(700)
        const b = await page.evaluate(
          (nid) => window.__cateE2E!.getBrowserPanelLoadCount(nid),
          browserNodeId,
        )
        if (a === b) return b
      }
      // Timed out stabilising — return whatever we have.
      return page.evaluate((nid) => window.__cateE2E!.getBrowserPanelLoadCount(nid), browserNodeId)
    })()

    // Switch canvas focus to the terminal.
    await page.evaluate((nid) => window.__cateE2E!.focusCanvasNode(nid), terminalNodeId)
    await page.waitForTimeout(300)

    // Switch focus back to the browser.
    await page.evaluate((nid) => window.__cateE2E!.focusCanvasNode(nid), browserNodeId)
    await page.waitForTimeout(300)

    // The load count must NOT have increased — the webview was never reloaded.
    const countAfterSwitch = await page.evaluate(
      (nid) => window.__cateE2E!.getBrowserPanelLoadCount(nid),
      browserNodeId,
    )
    expect(countAfterSwitch).toBe(countAfterMount)
  } finally {
    await closeApp(app)
  }
})
