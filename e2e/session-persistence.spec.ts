// Session-persistence E2E spec
//
// Verifies that canvas nodes and workspace groups survive both a normal quit
// (SIGTERM / app.exit → will-quit flush) and an abnormal quit (SIGKILL, no
// flush — relies on the periodic autosave that ran before the kill).
//
// Each test that needs two launches uses a pinned userData dir
// (CATE_E2E_USERDATA) so both launches share the same state files.

import { test, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync } from 'node:fs'
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
// >10 workspaces with group assignments ALL survive restart
//
// Directly targets the user's hypothesis: "does going over 10 hit a count
// limit?" recent-projects.json is capped at 10 (MAX_RECENT_PROJECTS), but
// sidebar.json carries the full list + groups, and loadFromProjectFiles unions
// the two. This proves 12 workspaces + 3 groups all restore with assignments.
// ---------------------------------------------------------------------------

test('12 workspaces + group assignments all survive restart (over the 10 recent-projects cap)', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-persist-many-'))
  const rootBase = mkdtempSync(join(tmpdir(), 'cate-ws-roots-'))
  const N = 12
  // realpathSync: macOS mkdtemp returns /var/folders/... but the app canonicalizes
  // rootPaths to /private/var/folders/..., so the test must compare canonical form.
  const roots = Array.from({ length: N }, (_, i) => {
    const p = join(rootBase, `ws-${i}`)
    mkdirSync(p, { recursive: true })
    return realpathSync(p)
  })

  let result = await launchApp({ userDataDir })
  let app: ElectronApplication = result.electronApp
  let page: Page = result.mainWindow

  // Create the groups + workspaces first. Real usage adds a folder, then groups
  // it as a separate gesture — so let the async workspace-create sync settle
  // before assigning groups (assigning in the same tick as create races the
  // create's response reconciliation).
  const { gids, wsIds } = await page.evaluate(
    ({ roots, names, colors }) => {
      const E = window.__cateE2E!
      const gids = names.map((n, i) => E.addWorkspaceGroup(n, colors[i]))
      const wsIds = roots.map((root, i) => E.addWorkspace(`WS${i}`, root))
      return { gids, wsIds }
    },
    { roots, names: ['GroupA', 'GroupB', 'GroupC'], colors: ['blue', 'green', 'red'] },
  )
  await page.evaluate(() => window.__cateE2E!.awaitWorkspaceSync()) // settle creates (no race)

  // Assign round-robin, building the rootPath→gid expectation.
  const wsRootToGroup: Record<string, string> = await page.evaluate(
    ({ wsIds, gids, roots }) => {
      const E = window.__cateE2E!
      const map: Record<string, string> = {}
      wsIds.forEach((wsId, i) => {
        const gid = gids[i % gids.length]
        E.moveWorkspaceToGroup(wsId, gid)
        map[roots[i]] = gid
      })
      return map
    },
    { wsIds, gids, roots },
  )

  await page.waitForTimeout(400)
  await page.evaluate(() => window.__cateE2E!.flushSave())
  await page.waitForTimeout(900)

  await closeApp(app)

  // --- Relaunch: every workspace must come back WITH its group assignment ---
  result = await launchApp({ userDataDir })
  app = result.electronApp
  page = result.mainWindow

  const restored = await page.evaluate(() => ({
    workspaces: window.__cateE2E!.workspaces(),
    groups: window.__cateE2E!.groups(),
  }))

  await closeApp(app)
  rmSync(rootBase, { recursive: true, force: true })

  // All 12 roots present with the exact group they were assigned.
  for (const root of roots) {
    const ws = restored.workspaces.find((w) => w.rootPath === root)
    expect(ws, `workspace for ${root} missing after restart`).toBeDefined()
    expect(ws!.groupId, `groupId for ${root} not restored`).toBe(wsRootToGroup[root])
  }
  // All 3 groups present.
  expect(restored.groups.length).toBeGreaterThanOrEqual(3)
})

// ---------------------------------------------------------------------------
// A workspace whose .cate/workspace.json is missing/corrupt is NOT dropped —
// its folder + group assignment survive (hardened loadFromProjectFiles). Before
// the fix, a missing workspace.json silently removed the row and unset its group.
// ---------------------------------------------------------------------------

test('workspace with missing workspace.json keeps its folder + group on restart', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-persist-missing-'))
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cate-ws-missing-')))

  let result = await launchApp({ userDataDir })
  let app: ElectronApplication = result.electronApp
  let page: Page = result.mainWindow

  const { gid, wsId } = await page.evaluate((r) => {
    const E = window.__cateE2E!
    const g = E.addWorkspaceGroup('Keepers', 'orange')
    const id = E.addWorkspace('Survivor', r)
    return { gid: g, wsId: id }
  }, root)
  await page.evaluate(() => window.__cateE2E!.awaitWorkspaceSync()) // settle creates before grouping
  await page.evaluate(([id, g]) => window.__cateE2E!.moveWorkspaceToGroup(id, g), [wsId, gid])

  await page.waitForTimeout(300)
  await page.evaluate(() => window.__cateE2E!.flushSave())
  await page.waitForTimeout(800)
  await closeApp(app)

  // Simulate a missing/corrupt workspace.json (e.g. user deleted .cate, or a
  // partial write). The path is still in sidebar.json's order + groupMap.
  const wsFile = join(root, '.cate', 'workspace.json')
  expect(existsSync(wsFile), 'precondition: workspace.json was written').toBe(true)
  rmSync(wsFile, { force: true })

  result = await launchApp({ userDataDir })
  app = result.electronApp
  page = result.mainWindow

  const restored = await page.evaluate(() => window.__cateE2E!.workspaces())
  await closeApp(app)
  rmSync(root, { recursive: true, force: true })

  const ws = restored.find((w) => w.rootPath === root)
  expect(ws, 'workspace with missing workspace.json was dropped').toBeDefined()
  expect(ws!.groupId, 'group assignment lost when workspace.json missing').toBe(gid)
})

// ---------------------------------------------------------------------------
// Workspace groups survive normal quit
// ---------------------------------------------------------------------------

test('workspace group assignments survive normal quit + relaunch', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cate-persist-grp-'))
  // Unique real dirs (realpath'd to canonical form) — avoids /var vs /private/var
  // mismatch and cross-run contamination from shared fixed paths.
  const rootA = realpathSync(mkdtempSync(join(tmpdir(), 'cate-grp-a-')))
  const rootB = realpathSync(mkdtempSync(join(tmpdir(), 'cate-grp-b-')))

  // --- First launch: create two workspaces, group them ---
  let result = await launchApp({ userDataDir })
  let app: ElectronApplication = result.electronApp
  let page: Page = result.mainWindow

  const { groupId, a, b } = await page.evaluate(
    ([rA, rB]) => {
      const E = window.__cateE2E!
      const gid = E.addWorkspaceGroup('DevGroup', 'blue')
      return { groupId: gid, a: E.addWorkspace('Alpha', rA), b: E.addWorkspace('Beta', rB) }
    },
    [rootA, rootB],
  )
  await page.evaluate(() => window.__cateE2E!.awaitWorkspaceSync()) // settle creates before grouping
  await page.evaluate(
    ([ai, bi, gid]) => {
      const E = window.__cateE2E!
      E.moveWorkspaceToGroup(ai, gid)
      E.moveWorkspaceToGroup(bi, gid)
    },
    [a, b, groupId],
  )

  await page.waitForTimeout(400)
  await page.evaluate(() => window.__cateE2E!.flushSave())
  await page.waitForTimeout(800)

  await closeApp(app)

  // --- Second launch: verify groups and assignments restored ---
  result = await launchApp({ userDataDir })
  app = result.electronApp
  page = result.mainWindow

  const restoredGroups = await page.evaluate(() => window.__cateE2E!.groups())
  const restoredWorkspaces = await page.evaluate(() => window.__cateE2E!.workspaces())

  await closeApp(app)
  rmSync(rootA, { recursive: true, force: true })
  rmSync(rootB, { recursive: true, force: true })

  const group = restoredGroups.find((g) => g.id === groupId)
  expect(group).toBeDefined()
  expect(group!.name).toBe('DevGroup')

  const wsA = restoredWorkspaces.find((w) => w.rootPath === rootA)
  const wsB = restoredWorkspaces.find((w) => w.rootPath === rootB)
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
