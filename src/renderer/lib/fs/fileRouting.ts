import type { Point } from '../../../shared/types'
import type { PanelPlacement } from '../../stores/appStore'
import { useAppStore } from '../../stores/appStore'
import { getAllCanvasStoreEntries, getOrCreateCanvasStoreForPanel } from '../../stores/canvasStore'
import { findNodeDockStore } from '../../panels/nodeDockRegistry'
import { getNodeDockLayout } from '../workspace/canvasAccess'
import { collectPanelIds } from '../../../shared/collectPanelIds'
import { revealOnce } from '../workspace/panelReveal'
import type { PanelType } from '../../../shared/types'

export type DocumentType = 'pdf' | 'docx' | 'image'

const DOCUMENT_EXTENSIONS: Record<string, DocumentType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.ico': 'image',
  '.tiff': 'image',
  '.tif': 'image',
}

export function getDocumentType(filePath: string): DocumentType | null {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return null
  const ext = filePath.slice(dotIndex).toLowerCase()
  return DOCUMENT_EXTENSIONS[ext] ?? null
}

const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])
const SQLITE_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3', '.db3'])

/** An already-open panel for this exact file + type, or null. Opening the same
 *  file again should focus its existing tab, not spawn a duplicate. */
function findExistingPanelForFile(workspaceId: string, filePath: string, type: PanelType): string | null {
  const ws = useAppStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (!ws) return null
  for (const panel of Object.values(ws.panels)) {
    if (panel.type === type && panel.filePath === filePath) return panel.id
  }
  return null
}

/** If `filePath` is already open as `type`, reveal it and return its id — else null. */
function revealExistingPanelForFile(workspaceId: string, filePath: string, type: PanelType): string | null {
  const existing = findExistingPanelForFile(workspaceId, filePath, type)
  if (existing && revealOnce(workspaceId, existing)) return existing
  return null
}

/** A browser panel already showing this exact URL as one of its tabs, or null.
 *  Opening the same local HTML file again should focus that tab, not spawn a
 *  new browser panel. */
function findExistingBrowserPanelForUrl(workspaceId: string, url: string): string | null {
  const ws = useAppStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (!ws) return null
  for (const panel of Object.values(ws.panels)) {
    if (panel.type === 'browser' && panel.tabs?.some((tab) => tab.url === url)) return panel.id
  }
  return null
}

function revealExistingBrowserPanelForUrl(workspaceId: string, url: string): string | null {
  const existing = findExistingBrowserPanelForUrl(workspaceId, url)
  if (existing && revealOnce(workspaceId, existing)) return existing
  return null
}

/** Add `panelId` as a new tab to a group node's mini-dock, whether or not the
 *  node currently has a live per-node DockStore. A canvas node is viewport-
 *  culled (unmounted) when off-screen, which tears down its DockStore
 *  registration — without this fallback, grouping into an off-screen node
 *  silently no-ops and the caller falls through to spawning a duplicate node.
 *  Mutates the node's persisted `dockLayout` projection directly; the live
 *  store picks that up as its initial layout whenever the node next mounts. */
function addPanelToGroupNode(
  target: { nodeId: string; canvasPanelId: string },
  panelId: string,
): boolean {
  const nodeDock = findNodeDockStore(target.nodeId)
  if (nodeDock) {
    nodeDock.getState().dockPanel(panelId, 'center')
    return true
  }
  const layout = getNodeDockLayout(target.canvasPanelId, target.nodeId)
  if (!layout || layout.type !== 'tabs') return false
  getOrCreateCanvasStoreForPanel(target.canvasPanelId).getState().setNodeDockLayout(target.nodeId, {
    ...layout,
    panelIds: [...layout.panelIds, panelId],
    activeIndex: layout.panelIds.length,
  })
  return true
}

export function openFileAsText(
  workspaceId: string,
  filePath: string,
  position?: Point,
  placement?: PanelPlacement,
): string {
  return revealExistingPanelForFile(workspaceId, filePath, 'editor')
    ?? useAppStore.getState().createEditor(workspaceId, filePath, position, placement)
}

export function openFileAsPanel(
  workspaceId: string,
  filePath: string,
  position?: Point,
  placement?: PanelPlacement,
): string {
  const store = useAppStore.getState()
  const dotIndex = filePath.lastIndexOf('.')
  const ext = dotIndex !== -1 ? filePath.slice(dotIndex).toLowerCase() : ''
  const docType = getDocumentType(filePath)
  if (docType) {
    return revealExistingPanelForFile(workspaceId, filePath, 'document')
      ?? store.createDocument(workspaceId, filePath, docType, position, placement)
  }
  if (SQLITE_EXTENSIONS.has(ext)) {
    return revealExistingPanelForFile(workspaceId, filePath, 'database')
      ?? store.createDatabase(workspaceId, filePath, position, placement)
  }
  if (HTML_EXTENSIONS.has(ext)) {
    const url = `file://${filePath}`
    return revealExistingBrowserPanelForUrl(workspaceId, url)
      ?? store.createBrowser(workspaceId, url, position, placement)
  }
  const existingEditor = revealExistingPanelForFile(workspaceId, filePath, 'editor')
  if (existingEditor) return existingEditor
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return store.createEditor(workspaceId, filePath, position, placement, { markdownPreview: true })
  }
  return store.createEditor(workspaceId, filePath, position, placement)
}

// -----------------------------------------------------------------------------
// Extension-grouped canvas open
// Finds a mounted canvas node that already has an editor panel with the same
// file extension, and adds the new file as a tab there instead of spawning a
// new canvas node. Non-editor types (images, SQLite, HTML) are always opened
// normally. Falls back to a new canvas node when no matching node is found.
// -----------------------------------------------------------------------------

function getFileExt(filePath: string): string {
  const i = filePath.lastIndexOf('.')
  return i !== -1 ? filePath.slice(i).toLowerCase() : ''
}

function findGroupNodeForExt(
  workspaceId: string,
  ext: string,
): { nodeId: string; canvasPanelId: string } | null {
  const ws = useAppStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (!ws) return null

  // Build set of editor panel IDs whose filePath matches the extension.
  const matchingPanelIds = new Set<string>()
  for (const panel of Object.values(ws.panels)) {
    if (panel.type === 'editor' && panel.filePath && getFileExt(panel.filePath) === ext) {
      matchingPanelIds.add(panel.id)
    }
  }
  if (matchingPanelIds.size === 0) return null

  // Scan every canvas node for a match — live per-node DockStore when the node
  // is mounted, falling back to its persisted dockLayout projection when it's
  // off-screen (viewport-culled nodes have no live store, but still exist).
  for (const [canvasPanelId, store] of getAllCanvasStoreEntries()) {
    for (const nodeId of Object.keys(store.getState().nodes)) {
      for (const id of collectPanelIds(getNodeDockLayout(canvasPanelId, nodeId))) {
        if (matchingPanelIds.has(id)) return { nodeId, canvasPanelId }
      }
    }
  }
  return null
}

/** Open a file on the canvas, grouping same-extension files as tabs in an
 *  existing canvas node. Non-editor types open as new nodes always. */
export function openFileGrouped(workspaceId: string, filePath: string, position?: Point): string {
  const store = useAppStore.getState()
  const ext = getFileExt(filePath)

  // Non-editor types: open normally (always new node), unless already open.
  const docType = getDocumentType(filePath)
  if (docType) {
    return revealExistingPanelForFile(workspaceId, filePath, 'document')
      ?? store.createDocument(workspaceId, filePath, docType, position)
  }
  if (SQLITE_EXTENSIONS.has(ext)) {
    return revealExistingPanelForFile(workspaceId, filePath, 'database')
      ?? store.createDatabase(workspaceId, filePath, position)
  }
  if (HTML_EXTENSIONS.has(ext)) {
    const url = `file://${filePath}`
    return revealExistingBrowserPanelForUrl(workspaceId, url)
      ?? store.createBrowser(workspaceId, url, position)
  }

  // Already open as an editor tab somewhere — focus it instead of duplicating.
  const existingEditor = revealExistingPanelForFile(workspaceId, filePath, 'editor')
  if (existingEditor) return existingEditor

  // Editor/text: try to find an existing node with the same extension.
  // ext === '' groups all extension-less files (Jenkinsfile, Makefile, etc.).
  const target = findGroupNodeForExt(workspaceId, ext)
  if (target) {
    const opts = MARKDOWN_EXTENSIONS.has(ext) ? { markdownPreview: true } : undefined
    const panelId = store.createEditor(workspaceId, filePath, position, { target: 'none' }, opts)
    if (panelId) {
      if (addPanelToGroupNode(target, panelId)) {
        getOrCreateCanvasStoreForPanel(target.canvasPanelId).getState().focusNode(target.nodeId)
        return panelId
      }
      // Grouping failed (e.g. an unmounted node with a non-simple layout) —
      // this panel record was never placed anywhere; discard it rather than
      // leaving it orphaned, then fall through to the new-node path below.
      store.removePanelRecord(workspaceId, panelId)
    }
  }

  // No existing group node: create a new canvas node.
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return store.createEditor(workspaceId, filePath, position, undefined, { markdownPreview: true })
  }
  return store.createEditor(workspaceId, filePath, position)
}

/** Open a file as a tab inside a specific canvas node's mini-dock.
 *  Used when the user drops a file directly onto an existing canvas node.
 *  Non-editor types (images, PDF, SQLite, HTML) are also supported as tabs. */
export function openFileAsTabInNode(workspaceId: string, nodeId: string, filePath: string): string {
  const store = useAppStore.getState()
  const nodeDock = findNodeDockStore(nodeId)
  if (!nodeDock) return openFileAsPanel(workspaceId, filePath)

  const panelId = openFileAsPanel(workspaceId, filePath, undefined, { target: 'none' })
  if (panelId) nodeDock.getState().dockPanel(panelId, 'center')
  return panelId
}

/** Open a file as plain text on the canvas, grouped by extension. */
export function openFileAsTextGrouped(workspaceId: string, filePath: string, position?: Point): string {
  const store = useAppStore.getState()
  const ext = getFileExt(filePath)

  const existingEditor = revealExistingPanelForFile(workspaceId, filePath, 'editor')
  if (existingEditor) return existingEditor

  const target = findGroupNodeForExt(workspaceId, ext)
  if (target) {
    const panelId = store.createEditor(workspaceId, filePath, position, { target: 'none' })
    if (panelId) {
      if (addPanelToGroupNode(target, panelId)) {
        getOrCreateCanvasStoreForPanel(target.canvasPanelId).getState().focusNode(target.nodeId)
        return panelId
      }
      store.removePanelRecord(workspaceId, panelId)
    }
  }
  return store.createEditor(workspaceId, filePath, position)
}
