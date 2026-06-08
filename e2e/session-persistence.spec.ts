// Session-persistence E2E spec
//
// Verifies that canvas nodes and workspace groups survive both a normal quit
// (SIGTERM / app.exit → will-quit flush) and an abnormal quit (SIGKILL, no
// flush — relies on the periodic autosave that ran before the kill).
//
// Each test that needs two launches uses a pinned userData dir
// (CATE_E2E_USERDATA) so both launches share the same state files.

import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchApp, closeApp } from './fixtures/electron-app'
import type { ElectronApplication, Page } from 'playwright'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait until the active canvas has at least one node matching `predicate`. */
async function waitForNode(
  page: Page,
  predicate: (n: { id: string; panelId: string; origin: { x: number; y: number } }) => boolean,
  timeout = 10_000,
) {
  return page.waitForFunction(
    (pred) => {
      const ns = window.__cateE2E!.nodes()
      return ns.find(new Function('n', `return (${pred})(n)`) as (n: unknown) => boolean) ?? null
    },
    predicate.toString(),
    { timeout },
  )
}

// ---------------------------------------------------------------------------
// Canvas node persists after normal quit
// ---------------------------------------------------------------------------

test('canvas node survives normal quit + relaunch', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-persist-'))

  // --- First launch: create a terminal node then save + quit ---
  let result = await launchApp({ userDataDir })
  let app: ElectronApplication = result.electronApp
  let page: Page = result.mainWindow

  // Workspace needs a rootPath so session.ts writes workspace.json to disk.
  // Use setWorkspaceRoot on the already-mounted workspace to avoid canvas
  // re-mount timing issues that come with switching to a new workspace.
  await page.evaluate((root) => window.__cateE2E!.setWorkspaceRoot(root), userDataDir)

  const nodeOrigin = { x: 300, y: 200 }
  const hint = await page.evaluate((p) => window.__cateE2E!.createTerminal(p), nodeOrigin)

  // Resolve the real node id (createTerminal may return panelId if store
  // hasn't ticked yet — same pattern as seedTerminal helper).
  const nodeId: string = await page
    .waitForFunction(
      (h) => {
        const n = window.__cateE2E!.nodes().find((x) => x.id === h || x.panelId === h)
        return n ? n.id : null
      },
      hint,
      { timeout: 10_000 },
    )
    .then((h) => h.jsonValue() as Promise<string>)

  // Force-save before closing so the node is definitely on disk.
  await page.evaluate(() => window.__cateE2E!.flushSave())
  // Small wait for IPC round-trip + atomic write to land.
  await page.waitForTimeout(500)

  await closeApp(app)

  // --- Second launch: verify the node is still there ---
  result = await launchApp({ userDataDir })
  app = result.electronApp
  page = result.mainWindow

  const nodes = await page.evaluate(() => window.__cateE2E!.nodes())
  const restored = nodes.find((n) => n.id === nodeId)

  await closeApp(app)

  expect(restored).toBeDefined()
  expect(restored!.origin).toMatchObject(nodeOrigin)
})

// ---------------------------------------------------------------------------
// Workspace groups survive normal quit
// ---------------------------------------------------------------------------

test('workspace group assignments survive normal quit + relaunch', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-persist-grp-'))

  // --- First launch: create two workspaces, group them ---
  let result = await launchApp({ userDataDir })
  let app: ElectronApplication = result.electronApp
  let page: Page = result.mainWindow

  const wsAId: string = await page.evaluate(() =>
    window.__cateE2E!.addWorkspace('Alpha', '/tmp/cate-e2e-alpha'),
  )
  const wsBId: string = await page.evaluate(() =>
    window.__cateE2E!.addWorkspace('Beta', '/tmp/cate-e2e-beta'),
  )

  const groupId: string = await page.evaluate(() =>
    window.__cateE2E!.addWorkspaceGroup('DevGroup', 'blue'),
  )

  await page.evaluate(
    ([wsA, wsB, gid]) => {
      window.__cateE2E!.moveWorkspaceToGroup(wsA, gid)
      window.__cateE2E!.moveWorkspaceToGroup(wsB, gid)
    },
    [wsAId, wsBId, groupId],
  )

  await page.evaluate(() => window.__cateE2E!.flushSave())
  await page.waitForTimeout(500)

  await closeApp(app)

  // --- Second launch: verify groups and assignments restored ---
  result = await launchApp({ userDataDir })
  app = result.electronApp
  page = result.mainWindow

  const restoredGroups = await page.evaluate(() => window.__cateE2E!.groups())
  const restoredWorkspaces = await page.evaluate(() => window.__cateE2E!.workspaces())

  await closeApp(app)

  const group = restoredGroups.find((g) => g.id === groupId)
  expect(group).toBeDefined()
  expect(group!.name).toBe('DevGroup')

  const wsA = restoredWorkspaces.find((w) => w.id === wsAId)
  const wsB = restoredWorkspaces.find((w) => w.id === wsBId)
  expect(wsA?.groupId).toBe(groupId)
  expect(wsB?.groupId).toBe(groupId)
})

// ---------------------------------------------------------------------------
// Canvas node survives SIGKILL (abnormal quit / crash recovery)
//
// Strategy: flushSave() explicitly before kill — this simulates a scenario
// where at least one save has completed (either 30s periodic or explicit).
// The kill prevents the will-quit flush, so we verify the explicit save is
// enough.
// ---------------------------------------------------------------------------

test('canvas node survives SIGKILL after explicit save', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-persist-kill-'))

  // --- First launch: create node, save, then hard-kill ---
  let result = await launchApp({ userDataDir })
  let app: ElectronApplication = result.electronApp
  let page: Page = result.mainWindow

  // Workspace needs a rootPath so session.ts writes workspace.json to disk.
  await page.evaluate((root) => window.__cateE2E!.setWorkspaceRoot(root), userDataDir)

  const nodeOrigin = { x: 150, y: 120 }
  const hint = await page.evaluate((p) => window.__cateE2E!.createTerminal(p), nodeOrigin)

  const nodeId: string = await page
    .waitForFunction(
      (h) => {
        const n = window.__cateE2E!.nodes().find((x) => x.id === h || x.panelId === h)
        return n ? n.id : null
      },
      hint,
      { timeout: 10_000 },
    )
    .then((h) => h.jsonValue() as Promise<string>)

  await page.evaluate(() => window.__cateE2E!.flushSave())
  await page.waitForTimeout(600)

  // Hard-kill: get the main process pid and SIGKILL it.
  const pid: number = await app.evaluate(({ app: electronApp }) => process.pid)
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already dead
  }
  // Give the OS a moment to reap the process before relaunching.
  await new Promise<void>((r) => setTimeout(r, 800))

  // --- Second launch: verify node survived ---
  result = await launchApp({ userDataDir })
  app = result.electronApp
  page = result.mainWindow

  const nodes = await page.evaluate(() => window.__cateE2E!.nodes())
  const restored = nodes.find((n) => n.id === nodeId)

  await closeApp(app)

  expect(restored).toBeDefined()
  expect(restored!.origin).toMatchObject(nodeOrigin)
})
