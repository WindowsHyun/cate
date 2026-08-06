import { describe, expect, it } from 'vitest'
import { createCanvasStore } from '../../stores/canvasStore'
import { createCanvasOps } from './canvasBridge'
import { createDockStore } from '../../stores/dockStore'
import { registerNodeDockStore, unregisterNodeDockStore } from '../../panels/nodeDockRegistry'

describe('createCanvasOps background placement', () => {
  it('adds a node without changing selection, focus epoch, or camera', () => {
    const store = createCanvasStore()
    store.getState().addNode('selected-panel', 'editor', { x: 10, y: 20 })
    store.setState({ viewportOffset: { x: 123, y: 456 }, zoomLevel: 0.75, focusEpoch: 9 })
    const before = store.getState()

    createCanvasOps(store).addNodeAndFocus('background-browser', 'browser', undefined, undefined, false)

    const after = store.getState()
    expect(after.nodeForPanel('background-browser')).toBeTruthy()
    expect(after.selection).toEqual(before.selection)
    expect(after.selectionActive).toBe(before.selectionActive)
    expect(after.focusEpoch).toBe(before.focusEpoch)
    expect(after.viewportOffset).toEqual(before.viewportOffset)
    expect(after.zoomLevel).toBe(before.zoomLevel)
  })
})

// Regression: clicking a background tab of a grouped canvas node brought the
// NODE into view (focusAndCenter) but left whatever tab was already active on
// screen — the clicked file never actually showed.
describe('createCanvasOps focusPanelNode switches the node active tab', () => {
  const CANVAS_ID = 'canvas-focus-test'

  it('activates the clicked tab in a live node dock', () => {
    const store = createCanvasStore()
    const nodeId = store.getState().addNode('a.ts', 'editor')
    const nodeDock = createDockStore()
    nodeDock.getState().dockPanel('a.ts', 'center')
    nodeDock.getState().dockPanel('b.ts', 'center')
    expect((nodeDock.getState().zones.center.layout as any).panelIds[
      (nodeDock.getState().zones.center.layout as any).activeIndex
    ]).toBe('b.ts')
    registerNodeDockStore(CANVAS_ID, nodeId, nodeDock)

    createCanvasOps(store).focusPanelNode('a.ts')

    const layout = nodeDock.getState().zones.center.layout as any
    expect(layout.panelIds[layout.activeIndex]).toBe('a.ts')
    unregisterNodeDockStore(CANVAS_ID, nodeId)
  })

  it('writes the active tab into the persisted layout when the node has no live dock', () => {
    const store = createCanvasStore()
    const nodeId = store.getState().addNode('a.ts', 'editor')
    store.getState().setNodeDockLayout(nodeId, {
      type: 'tabs',
      id: 'tabs-1',
      panelIds: ['a.ts', 'b.ts'],
      activeIndex: 1,
    })

    createCanvasOps(store).focusPanelNode('a.ts')

    const layout = store.getState().nodes[nodeId].dockLayout as any
    expect(layout.activeIndex).toBe(0)
  })
})
