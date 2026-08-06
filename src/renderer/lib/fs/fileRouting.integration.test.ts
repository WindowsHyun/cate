// @vitest-environment jsdom
// Real-world dedup check: fileRouting.test.ts mocks revealOnce to always
// succeed, so it only proves the DECISION logic (find existing -> reveal ->
// return its id) without ever exercising the real resolvePanelLocation /
// DockTabStack wiring a live app uses. This file uses the REAL panelReveal +
// canvas/dock stores (same fixtures as panelReveal.test.ts) so a reveal
// failure that the mocked test can't see will show up here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAppStore } from '../../stores/appStore'
import {
  getOrCreateCanvasStoreForPanel,
  releaseCanvasStoreForPanel,
} from '../../stores/canvasStore'
import { releaseWorkspaceDockStore } from '../workspace/dockRegistry'
import { setActivePanel } from '../activePanel'

const WS = 'ws-integration'
const CANVAS = 'canvas-integration'

function setWorkspace() {
  useAppStore.setState({
    selectedWorkspaceId: WS,
    workspaces: [
      {
        id: WS,
        name: 'WS',
        color: '',
        rootPath: '/repo',
        panels: { [CANVAS]: { id: CANVAS, type: 'canvas', title: 'Canvas', isDirty: false } },
      },
    ],
  } as never)
}

beforeEach(() => {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {}
  setWorkspace()
})

afterEach(() => {
  releaseCanvasStoreForPanel(CANVAS)
  releaseWorkspaceDockStore(WS)
  setActivePanel(null)
  useAppStore.setState({ workspaces: [], selectedWorkspaceId: '' } as never)
})

describe('openFileGrouped dedup against the REAL canvas/dock stores', () => {
  it('reopening the same file returns the same panel id (first file in a fresh node)', async () => {
    getOrCreateCanvasStoreForPanel(CANVAS)
    const { openFileGrouped } = await import('./fileRouting')

    const first = openFileGrouped(WS, '/repo/a.ts')
    const second = openFileGrouped(WS, '/repo/a.ts')
    expect(second).toBe(first)

    const panels = useAppStore.getState().workspaces[0].panels
    expect(Object.values(panels).filter((p) => p.filePath === '/repo/a.ts')).toHaveLength(1)
  })

  it('reopening the same file returns the same panel id when it is grouped as a SECOND tab in a node', async () => {
    getOrCreateCanvasStoreForPanel(CANVAS)
    const { openFileGrouped } = await import('./fileRouting')

    const other = openFileGrouped(WS, '/repo/other.ts')
    expect(other).toBeTruthy()
    const first = openFileGrouped(WS, '/repo/a.ts')
    expect(first).toBeTruthy()

    // a.ts should now be grouped as a tab alongside other.ts in the same node.
    const second = openFileGrouped(WS, '/repo/a.ts')
    expect(second).toBe(first)

    const panels = useAppStore.getState().workspaces[0].panels
    expect(Object.values(panels).filter((p) => p.filePath === '/repo/a.ts')).toHaveLength(1)
  })
})
