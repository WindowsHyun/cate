// =============================================================================
// Arrange slice — bulk arrangement: auto-layout the whole canvas, and
// stack/tidy/align the current selection.
// =============================================================================

import type { CanvasGet, CanvasSet, CanvasStoreActions } from './storeTypes'
import { ZOOM_MIN } from '../../../shared/types'
import { useSettingsStore } from '../settingsStore'

type ArrangeActions = Pick<
  CanvasStoreActions,
  'autoLayout' | 'layoutColumns' | 'layoutRows' | 'stackSelected' | 'tidyGridSelected' | 'alignSelected'
>

function getCanvasViewportInsets(): { left: number; right: number } {
  if (typeof document === 'undefined') return { left: 0, right: 0 }
  const style = document.documentElement.style
  return {
    left: parseInt(style.getPropertyValue('--cate-left-sidebar-width')) || 0,
    right: parseInt(style.getPropertyValue('--cate-right-sidebar-width')) || 0,
  }
}

export function createArrangeSlice(set: CanvasSet, get: CanvasGet): ArrangeActions {
  return {
    autoLayout() {
      const mode = useSettingsStore.getState().defaultLayoutMode ?? 'grid'
      if (mode === 'columns') { get().layoutColumns(); return }
      if (mode === 'rows') { get().layoutRows(); return }

      const state = get()
      const nodeList = Object.values(state.nodes).sort(
        (a, b) => a.creationIndex - b.creationIndex,
      )
      if (nodeList.length === 0) return

      const containerWidth = state.containerSize.width > 0
        ? state.containerSize.width / state.zoomLevel
        : 1600
      const containerHeight = state.containerSize.height > 0
        ? state.containerSize.height / state.zoomLevel
        : 1000

      const gap = 20
      const MIN_W = 560
      const MIN_H = 400
      const n = nodeList.length
      const aspect = containerWidth / Math.max(containerHeight, 1)
      const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)))
      const numRows = Math.ceil(n / cols)

      get().pushHistory()

      const sized = nodeList.map(node => ({
        id: node.id,
        width: Math.max(MIN_W, node.size.width),
        height: Math.max(MIN_H, node.size.height),
      }))

      const colWidths: number[] = Array.from({ length: cols }, (_, c) =>
        Math.max(...sized.filter((_, i) => i % cols === c).map(s => s.width))
      )
      const rowHeights: number[] = Array.from({ length: numRows }, (_, r) =>
        Math.max(...sized.filter((_, i) => Math.floor(i / cols) === r).map(s => s.height))
      )

      const xOffsets: number[] = [gap]
      for (let c = 0; c < cols - 1; c++) xOffsets[c + 1] = xOffsets[c] + colWidths[c] + gap
      const yOffsets: number[] = [gap]
      for (let r = 0; r < numRows - 1; r++) yOffsets[r + 1] = yOffsets[r] + rowHeights[r] + gap

      const updatedNodes = { ...state.nodes }
      sized.forEach((s, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        updatedNodes[s.id] = {
          ...updatedNodes[s.id],
          origin: { x: xOffsets[col], y: yOffsets[row] },
          size: { width: s.width, height: s.height },
        }
      })
      set({ nodes: updatedNodes })

      const totalW = xOffsets[cols - 1] + colWidths[cols - 1] + gap
      const totalH = yOffsets[numRows - 1] + rowHeights[numRows - 1] + gap
      const viewportInsets = getCanvasViewportInsets()
      const cs = state.containerSize
      const avW = (cs.width > 0 ? cs.width : 1440) - viewportInsets.left - viewportInsets.right
      const avH = cs.height > 0 ? cs.height : 900
      const fitZoom = Math.min(avW / totalW, avH / totalH)
      const zoom = Math.min(1.0, Math.max(ZOOM_MIN, fitZoom))
      set({
        zoomLevel: zoom,
        viewportOffset: {
          x: viewportInsets.left + (avW - totalW * zoom) / 2,
          y: (avH - totalH * zoom) / 2,
        },
      })
    },

    layoutColumns() {
      const state = get()
      const nodeList = Object.values(state.nodes).sort(
        (a, b) => a.creationIndex - b.creationIndex,
      )
      if (nodeList.length === 0) return
      const cols = 2
      const rows = Math.ceil(nodeList.length / cols)
      const gap = 20
      const MIN_W = 560
      const MIN_H = 400
      const sized = nodeList.map(node => ({
        id: node.id,
        width: Math.max(MIN_W, node.size.width),
        height: Math.max(MIN_H, node.size.height),
      }))
      const colWidths: number[] = Array.from({ length: cols }, (_, c) =>
        Math.max(...sized.filter((_, i) => i % cols === c).map(s => s.width))
      )
      const rowHeights: number[] = Array.from({ length: rows }, (_, r) =>
        Math.max(...sized.filter((_, i) => Math.floor(i / cols) === r).map(s => s.height))
      )
      const xOffsets: number[] = [gap]
      for (let c = 0; c < cols - 1; c++) xOffsets[c + 1] = xOffsets[c] + colWidths[c] + gap
      const yOffsets: number[] = [gap]
      for (let r = 0; r < rows - 1; r++) yOffsets[r + 1] = yOffsets[r] + rowHeights[r] + gap
      get().pushHistory()
      const updatedNodes = { ...state.nodes }
      sized.forEach((s, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        updatedNodes[s.id] = {
          ...updatedNodes[s.id],
          origin: { x: xOffsets[col], y: yOffsets[row] },
          size: { width: s.width, height: s.height },
        }
      })
      set({ nodes: updatedNodes })
      const totalW = xOffsets[cols - 1] + colWidths[cols - 1] + gap
      const totalH = yOffsets[rows - 1] + rowHeights[rows - 1] + gap
      const viewportInsets = getCanvasViewportInsets()
      const cs = state.containerSize
      const avW = (cs.width > 0 ? cs.width : 1440) - viewportInsets.left - viewportInsets.right
      const avH = cs.height > 0 ? cs.height : 900
      const zoom = Math.min(1.0, Math.max(ZOOM_MIN, Math.min(avW / totalW, avH / totalH)))
      set({ zoomLevel: zoom, viewportOffset: { x: viewportInsets.left + (avW - totalW * zoom) / 2, y: (avH - totalH * zoom) / 2 } })
    },

    layoutRows() {
      const state = get()
      const nodeList = Object.values(state.nodes).sort(
        (a, b) => a.creationIndex - b.creationIndex,
      )
      if (nodeList.length === 0) return
      const rows = 2
      const cols = Math.ceil(nodeList.length / rows)
      const gap = 20
      const MIN_W = 560
      const MIN_H = 400
      const sized = nodeList.map(node => ({
        id: node.id,
        width: Math.max(MIN_W, node.size.width),
        height: Math.max(MIN_H, node.size.height),
      }))
      const colWidths: number[] = Array.from({ length: cols }, (_, c) =>
        Math.max(...sized.filter((_, i) => i % cols === c).map(s => s.width))
      )
      const rowHeights: number[] = Array.from({ length: rows }, (_, r) =>
        Math.max(...sized.filter((_, i) => Math.floor(i / cols) === r).map(s => s.height))
      )
      const xOffsets: number[] = [gap]
      for (let c = 0; c < cols - 1; c++) xOffsets[c + 1] = xOffsets[c] + colWidths[c] + gap
      const yOffsets: number[] = [gap]
      for (let r = 0; r < rows - 1; r++) yOffsets[r + 1] = yOffsets[r] + rowHeights[r] + gap
      get().pushHistory()
      const updatedNodes = { ...state.nodes }
      sized.forEach((s, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        updatedNodes[s.id] = {
          ...updatedNodes[s.id],
          origin: { x: xOffsets[col], y: yOffsets[row] },
          size: { width: s.width, height: s.height },
        }
      })
      set({ nodes: updatedNodes })
      const totalW = xOffsets[cols - 1] + colWidths[cols - 1] + gap
      const totalH = yOffsets[rows - 1] + rowHeights[rows - 1] + gap
      const viewportInsets = getCanvasViewportInsets()
      const cs = state.containerSize
      const avW = (cs.width > 0 ? cs.width : 1440) - viewportInsets.left - viewportInsets.right
      const avH = cs.height > 0 ? cs.height : 900
      const zoom = Math.min(1.0, Math.max(ZOOM_MIN, Math.min(avW / totalW, avH / totalH)))
      set({ zoomLevel: zoom, viewportOffset: { x: viewportInsets.left + (avW - totalW * zoom) / 2, y: (avH - totalH * zoom) / 2 } })
    },

    stackSelected(axis, gap = 16) {
      get().pushHistory()
      set((state) => {
        const selected = Object.values(state.nodes).filter((n) => state.selectedNodeIds.has(n.id))
        if (selected.length < 2) return state

        const row = axis === 'row'
        const sorted = [...selected].sort((a, b) =>
          row ? a.origin.x - b.origin.x : a.origin.y - b.origin.y,
        )
        const startX = Math.min(...selected.map((n) => n.origin.x))
        const startY = Math.min(...selected.map((n) => n.origin.y))

        const next = { ...state.nodes }
        let cursor = row ? startX : startY
        for (const n of sorted) {
          const x = row ? cursor : startX
          const y = row ? startY : cursor
          next[n.id] = { ...n, origin: { x, y } }
          cursor += (row ? n.size.width : n.size.height) + gap
        }
        return { nodes: next }
      })
    },

    tidyGridSelected(gap = 16) {
      get().pushHistory()
      set((state) => {
        const selected = Object.values(state.nodes).filter((n) => state.selectedNodeIds.has(n.id))
        if (selected.length < 2) return state

        const n = selected.length
        const cols = Math.ceil(Math.sqrt(n))

        const cellW = Math.max(...selected.map((nd) => nd.size.width))
        const cellH = Math.max(...selected.map((nd) => nd.size.height))

        const startX = Math.min(...selected.map((nd) => nd.origin.x))
        const startY = Math.min(...selected.map((nd) => nd.origin.y))

        const sorted = [...selected].sort(
          (a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x,
        )

        const next = { ...state.nodes }
        sorted.forEach((nd, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          next[nd.id] = {
            ...nd,
            origin: { x: startX + col * (cellW + gap), y: startY + row * (cellH + gap) },
          }
        })
        return { nodes: next }
      })
    },

    alignSelected(axis) {
      get().pushHistory()
      set((state) => {
        const selected = Object.values(state.nodes).filter((n) => state.selectedNodeIds.has(n.id))
        if (selected.length < 2) return state
        const minX = Math.min(...selected.map((n) => n.origin.x))
        const minY = Math.min(...selected.map((n) => n.origin.y))
        const maxX = Math.max(...selected.map((n) => n.origin.x + n.size.width))
        const maxY = Math.max(...selected.map((n) => n.origin.y + n.size.height))
        const centerX = (minX + maxX) / 2
        const centerY = (minY + maxY) / 2
        const next = { ...state.nodes }
        for (const n of selected) {
          let x = n.origin.x
          let y = n.origin.y
          if (axis === 'left') x = minX
          else if (axis === 'right') x = maxX - n.size.width
          else if (axis === 'top') y = minY
          else if (axis === 'bottom') y = maxY - n.size.height
          else if (axis === 'center-x') x = centerX - n.size.width / 2
          else if (axis === 'center-y') y = centerY - n.size.height / 2
          next[n.id] = { ...n, origin: { x, y } }
        }
        return { nodes: next }
      })
    },
  }
}
