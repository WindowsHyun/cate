import log from './logger'
import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen, webContents, session, nativeTheme, protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { SHELL_SHOW_IN_FOLDER, WEBVIEW_SCREENSHOT, BROWSER_SET_PROXY, NATIVE_FILE_DRAG, CAPTURE_PAGE, DIALOG_OPEN_FOLDER, DIALOG_OPEN_FILE, DIALOG_OPEN_IMAGE, DIALOG_SAVE_FILE, DIALOG_CONFIRM_UNSAVED, DIALOG_CONFIRM_CLOSE_TERMINAL, DIALOG_CONFIRM_CLOSE_CANVAS, DIALOG_CONFIRM_IMPORT, DIALOG_CONFIRM_RELOAD_WORKSPACE, DIALOG_TERMINAL_LINK_OPEN, CANVAS_READ_BACKGROUND_IMAGE, APP_OPEN_PATH } from '../shared/ipc-channels'
import {
  WINDOW_SET_TITLE,
  WINDOW_MINIMIZE, WINDOW_TOGGLE_MAXIMIZE, WINDOW_CLOSE, WINDOW_IS_MAXIMIZED, WINDOW_MAXIMIZE_STATE,
  PANEL_TRANSFER, PANEL_RECEIVE, PANEL_TRANSFER_ACK,
  PANEL_WINDOWS_LIST, PANEL_WINDOW_DOCK_BACK, PANEL_WINDOW_SYNC_PTY, PANEL_WINDOW_SYNC_META,
  DRAG_START, DRAG_DETACH, DRAG_END,
  WINDOW_FULLSCREEN_STATE,
  DOCK_WINDOW_INIT, DOCK_WINDOW_SYNC_STATE, DOCK_WINDOWS_LIST, DOCK_WINDOW_RESTORE,
  DOCK_WINDOW_FLUSH_SYNC, DOCK_WINDOW_FLUSH_SYNC_DONE,
  CROSS_WINDOW_DRAG_START, CROSS_WINDOW_DRAG_UPDATE, CROSS_WINDOW_DRAG_DROP, CROSS_WINDOW_DRAG_CANCEL, CROSS_WINDOW_DRAG_RESOLVE,
  SESSION_FLUSH_SAVE,
  SESSION_FLUSH_SAVE_DONE,
  CLAUDE_CAPTURE_START,
  CLAUDE_CAPTURE_DONE,
} from '../shared/ipc-channels'
import { registerHandlers as registerTerminalHandlers, flushAllLoggers, killAllTerminals } from './ipc/terminal'
import { registerSqliteHandlers } from './sqlite'
import { registerClaudeResumeHandlers } from './ipc/claudeResume'
import { runtimes, forwardFileGrant, forwardClearFileGrantsForWindow, forwardClearScopedWriteAllowancesForWindow } from './runtime/runtimeManager'
import { registerRuntimeHandlers } from './ipc/runtime'
import { registerHandlers as registerFilesystemHandlers, stopWatchersForWindow } from './ipc/filesystem'
import { registerHandlers as registerGitHandlers } from './ipc/git'
import { registerHandlers as registerSearchHandlers, stopSearchesForWindow } from './ipc/search'
import { registerHandlers as registerShellHandlers, unregisterTerminalsForWindow, getRunningTerminals, getClaudeTerminalIds } from './ipc/shell'
import { registerHandlers as registerGitMonitorHandlers, stopMonitorsForWindow } from './ipc/git-monitor'
import { registerHandlers as registerStoreHandlers, loadSettingsSyncFromDisk, readBootSnapshot, writeBootSnapshot, getSettingSync, setSettingsFromMain } from './store'
import { flushPendingWritesSync as flushSettingsPendingWritesSync } from './settingsFile'
import { flushWorkspaceStateSync } from './workspaceStateStore'
import { registerUIStateHandlers, flushUIStateSync } from './uiStateStore'
import { importCanvasBackgroundImage } from './canvasBackgroundStore'
import { registerProjectStateHandlers, saveProjectStateSync } from './projectWorkspaceStore'
import { registerFileIconProtocol } from './fileIconProtocol'
import { registerHandlers as registerMenuHandlers } from './ipc/menu'
import { registerHandlers as registerNotificationHandlers } from './ipc/notifications'
import { registerAgentHandlers } from '../agent/main/ipcAgent'
import { registerSkillHandlers } from '../skills/main/ipcSkills'
import { registerAuthHandlers } from '../agent/main/ipcAuth'
import { authManager } from '../agent/main/authManager'
import { AgentManager } from '../agent/main/agentManager'

// Shared singletons for pi agent + auth.
const agentManager = new AgentManager(authManager)
import { registerWorkspaceHandlers } from './workspaceManager'
import { addAllowedRoot } from './ipc/pathValidation'
import { buildApplicationMenu, setNewMainWindowFn } from './menu'
import { initShellEnv, getShellEnv } from './shellEnv'
import { currentExclusionSet } from './ipc/filesystem'
import { initAutoUpdater } from './auto-updater'
import { initSentry, captureMainException, flushSentry } from './sentry'
import { initAnalytics, devSimulateUpdateFrom, hasRunBefore } from './analytics'
import { disableTrustScoping } from './featureFlags'
import { startPerfMonitor, getLatestSnapshot } from './perf/perfMonitor'
import { PERF_GET } from '../shared/ipc-channels'
import { TELEMETRY_NOTICE_VERSION } from '../shared/types'
import { installWebContentsSecurity } from './webSecurity'
import { installProxyAuthHandler } from './browserProxy'
import { installThemeSkill } from './installThemeSkill'

import { createWindow } from './windows/windowFactory'
import { IS_E2E } from './windows/reveal'
import { registerDialogHandlers } from './ipc/dialogs'
import { registerCaptureHandlers } from './ipc/capture'
import { registerWindowControlHandlers } from './ipc/windowControls'
import { registerPanelWindowHandlers } from './ipc/panelWindows'
import { registerDockWindowHandlers } from './ipc/dockWindows'
import { registerWindowPanelHandlers } from './ipc/windowPanels'
import { registerDragHandlers } from './ipc/dragHandlers'
import { setMainWindowReady, flushPendingOpenPaths, registerOpenFileHandler } from './lifecycle/openPath'
import { fireStartupTelemetry, registerTelemetryNoticeHandler } from './lifecycle/telemetry'
import { registerLifecycleHandlers } from './lifecycle/shutdown'

// NOTE: runSmokeAssertions only ever runs when CATE_SMOKE_TEST=1. The 1200 ms
// wait below is part of the smoke-only branch in mainWin.once('ready-to-show')
// and never executes on normal launches. Do not re-introduce it on the hot path.
async function runSmokeAssertions(win: BrowserWindow): Promise<void> {
  const result = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          hasElectronAPI: typeof window.electronAPI === 'object',
          hasFullscreenCheck: typeof window.electronAPI?.isMainWindowFullscreen === 'function',
        })
      }, 1200)
    })
  `, true) as { hasElectronAPI?: boolean; hasFullscreenCheck?: boolean }

  if (!result?.hasElectronAPI || !result?.hasFullscreenCheck) {
    throw new Error('Smoke test failed: preload bridge did not initialize correctly')
  }
}

// =============================================================================
// Register all IPC handlers ONCE (not per-window)
// =============================================================================

/**
 * Critical-path IPC handlers — registered synchronously before the first
 * BrowserWindow is created. These are everything the renderer might call
 * during settings load, session restore, and the first paint.
 *
 * Terminal + shell handlers are in the critical set because terminal:create
 * can fire as soon as the session restore reaches a terminal node, which can
 * happen before `ready-to-show`. Pushing them to the deferred set caused
 * "no handler registered" errors in practice.
 */
function registerCriticalHandlers(): void {
  registerStoreHandlers()
  registerUIStateHandlers()
  registerProjectStateHandlers()
  registerWorkspaceHandlers()
  registerFilesystemHandlers()
  registerTerminalHandlers()
  registerShellHandlers()
  registerMenuHandlers()
  registerWindowAndDialogHandlers()
  registerClaudeResumeHandlers()
  registerSqliteHandlers()
  // Resource profiler — no-op unless CATE_PERF=1.
  startPerfMonitor()
  ipcMain.handle(PERF_GET, () => getLatestSnapshot())
}

/**
 * Background IPC handlers — registered after the first paint inside
 * mainWin.once('ready-to-show'). Nothing on the critical render path
 * should depend on these.
 */
function registerDeferredHandlers(): void {
  registerGitHandlers()
  registerSearchHandlers()
  registerGitMonitorHandlers()
  registerNotificationHandlers()
  registerAuthHandlers(authManager)
  registerAgentHandlers(authManager, agentManager)
  registerSkillHandlers()
  registerRuntimeHandlers()
}

/**
 * Window, dialog, panel-transfer, drag, and ad-hoc IPC handlers. Split out so
 * registerCriticalHandlers can include them without duplicating the bodies.
 */
function registerWindowAndDialogHandlers(): void {
  // Shell: Reveal in Finder
  ipcMain.handle(SHELL_SHOW_IN_FOLDER, async (_event, filePath: string) => {
    // A remote (cate-companion://) path has no representation on this machine —
    // there is nothing local to reveal. Return a structured result instead of
    // throwing so the renderer can quietly ignore/disable the action.
    if (!isLocalLocator(filePath)) {
      return { ok: false, reason: 'remote' }
    }
    try {
      shell.showItemInFolder(validatePath(filePath))
      return { ok: true }
    } catch (error) {
      log.error('[SHELL_SHOW_IN_FOLDER]', error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  })

  // Dialog handlers
  ipcMain.handle(DIALOG_OPEN_FILE, async (event, opts: { title?: string; filters?: { name: string; extensions: string[] }[] } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: opts.title ?? 'Open File',
      properties: ['openFile'],
      filters: opts.filters,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(DIALOG_OPEN_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Project Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Pick an image to use as the canvas wallpaper. The picked file is COPIED into
  // managed app data (see ./canvasBackgroundStore) and the managed path is
  // returned for storage in settings — so the wallpaper survives the source
  // file moving/being deleted and stays self-contained. The renderer reads the
  // bytes via CANVAS_READ_BACKGROUND_IMAGE; no path grant is needed because that
  // reader runs in main (full fs access) rather than through the sandboxed fs IPC.
  ipcMain.handle(DIALOG_OPEN_IMAGE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose Canvas Background Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importCanvasBackgroundImage(result.filePaths[0])
  })

  // Read a canvas-wallpaper image as a data URL. Used both right after the user
  // picks one and on every launch to restore the saved path. Guarded by
  // extension + size so a hand-edited settings.json can't turn this into an
  // arbitrary file-to-data-URL exfiltration primitive.
  ipcMain.handle(CANVAS_READ_BACKGROUND_IMAGE, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || filePath === '') return null
    const MIME_BY_EXT: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.avif': 'image/avif',
    }
    const ext = path.extname(filePath).toLowerCase()
    const mime = MIME_BY_EXT[ext]
    if (!mime) return null
    try {
      const stat = await fs.promises.stat(filePath)
      const MAX_BYTES = 40 * 1024 * 1024 // 40 MB ceiling — keeps a data URL sane.
      if (!stat.isFile() || stat.size > MAX_BYTES) return null
      const buf = await fs.promises.readFile(filePath)
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch (err) {
      log.warn('[CANVAS_READ_BACKGROUND_IMAGE] Failed to read %s: %O', filePath, err)
      return null
    }
  })

  // Native Save-As dialog for untitled editor buffers.
  ipcMain.handle(DIALOG_SAVE_FILE, async (event, payload: { defaultName?: string; defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(win!, {
      title: 'Save File',
      defaultPath: payload?.defaultPath || payload?.defaultName || 'Untitled.txt',
    })
    if (result.canceled || !result.filePath) return null
    // The picked location is almost always outside the workspace allowed
    // roots (Desktop, Documents, …). Grant the calling window persistent
    // read+write access to the exact file so the initial fsWriteFile AND
    // every subsequent reload / Cmd+S on this editor succeed for the
    // lifetime of the window. The grant is dropped on window close.
    // Return the canonical safe path (realpath-of-parent + basename) so the
    // renderer stores the same string the grant set keys on — otherwise a
    // symlinked parent would yield a stored alias that later fails the
    // lexical validatePath check before realpath has a chance to run.
    if (win) {
      try {
        const safePath = await grantFileAccess(win.id, result.filePath)
        // Mirror the grant into the owning companion (the LOCAL daemon owns this
        // host-absolute path) so the initial write + later reloads validate there.
        forwardFileGrant(safePath, win.id)
        // Persist the approval so future windows (and future app launches)
        // can read+write this file via createWindow's grantsReady pass.
        // Critically there is NO renderer-facing IPC to add paths here —
        // only paths the user just confirmed in a native dialog land in
        // the store.
        try {
          await recordPersistentGrant(safePath)
        } catch (err) {
          log.warn('[DIALOG_SAVE_FILE] Failed to persist grant:', err)
        }
        // Grant the path to every currently-open window too. Without this,
        // a panel transferred to a window that existed BEFORE the Save-As
        // would lose access (createWindow's grantsReady only runs at the
        // owning window's creation — older sibling windows never see the
        // newly approved path otherwise).
        for (const other of BrowserWindow.getAllWindows()) {
          if (other.id === win.id || other.isDestroyed()) continue
          try {
            await grantFileAccess(other.id, safePath)
            forwardFileGrant(safePath, other.id)
          } catch (err) {
            log.warn('[DIALOG_SAVE_FILE] Failed to grant to window %d: %s', other.id, err)
          }
        }
        return safePath
      } catch (err) {
        log.warn('[DIALOG_SAVE_FILE] Failed to grant file access:', err)
      }
    }
    return result.filePath
  })

  // Native unsaved-changes confirmation. Returns 'save' | 'discard' | 'cancel'.
  ipcMain.handle(
    DIALOG_CONFIRM_UNSAVED,
    async (event, payload: { fileName?: string; multiple?: boolean; filePath?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const name = payload?.fileName ?? 'this file'
      const message = payload?.multiple
        ? `Do you want to save the changes you made to ${payload?.fileName ?? 'these files'}?`
        : `Do you want to save the changes you made to ${name}?`
      // For a single dirty file, show the on-disk location so the user knows
      // exactly which file the "Save" button is going to overwrite. Untitled
      // buffers (no filePath) fall back to a hint that a Save-As picker will
      // appear after confirming.
      const baseDetail = "Your changes will be lost if you don't save them."
      const detail = payload?.multiple
        ? baseDetail
        : payload?.filePath
          ? `${payload.filePath}\n\n${baseDetail}`
          : `This file has not been saved yet. Save will prompt for a location.\n\n${baseDetail}`
      const result = await dialog.showMessageBox(win!, {
        type: 'warning',
        message,
        detail,
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel'
    },
  )

  // Confirm closing a terminal that's running a foreground process (dev server,
  // editor, agent, …). Returns 'close' | 'cancel'.
  ipcMain.handle(
    DIALOG_CONFIRM_CLOSE_TERMINAL,
    async (event, payload: { count?: number; processName?: string | null }) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const count = payload?.count ?? 1
      const name = payload?.processName?.trim()
      const message =
        count > 1
          ? `Close ${count} terminals that are still running?`
          : name
            ? `“${name}” is still running. Close this terminal?`
            : 'This terminal is still running. Close it?'
      const detail =
        count > 1
          ? 'The processes running in these terminals will be terminated.'
          : 'The process running in this terminal will be terminated.'
      const result = await dialog.showMessageBox(win!, {
        type: 'warning',
        message,
        detail,
        buttons: ['Close', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0 ? 'close' : 'cancel'
    },
  )

  // Confirm close of a canvas panel. When the workspace has other canvases and
  // the closing canvas contains panels, the user is offered three choices:
  // move the panels to another canvas, delete them, or cancel. When it's the
  // last canvas (or empty) a simple close/cancel prompt is shown.
  ipcMain.handle(DIALOG_CONFIRM_CLOSE_CANVAS, async (event, payload: { panelCount: number; isLast: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { panelCount, isLast } = payload ?? { panelCount: 0, isLast: true }

    // Simple close prompt: last canvas, or an empty canvas on a multi-canvas workspace.
    if (isLast || panelCount === 0) {
      const result = await dialog.showMessageBox(win!, {
        type: 'warning',
        message: 'Close this canvas?',
        detail: panelCount > 0
          ? `Closing it will also close its ${panelCount} open ${panelCount === 1 ? 'panel' : 'panels'}.`
          : isLast
            ? 'This is the only canvas in the workspace.'
            : 'This canvas has no open panels.',
        buttons: ['Close', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      return result.response === 0 ? 'close' : 'cancel'
    }

    // Multi-canvas workspace with contained panels: offer move / delete / cancel.
    const result = await dialog.showMessageBox(win!, {
      type: 'warning',
      message: 'Close this canvas?',
      detail: `This canvas contains ${panelCount} open ${panelCount === 1 ? 'panel' : 'panels'}. What would you like to do with them?`,
      buttons: ['Move to Another Canvas', 'Delete All Panels', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    return result.response === 0 ? 'move' : result.response === 1 ? 'delete' : 'cancel'
  })

  // Ask whether to copy or move external files/folders dropped onto the file
  // explorer into a workspace directory.
  ipcMain.handle(DIALOG_CONFIRM_IMPORT, async (event, payload: { count: number; destName: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const count = payload?.count ?? 0
    const destName = payload?.destName ?? 'this folder'
    const result = await dialog.showMessageBox(win!, {
      type: 'question',
      message: `Add ${count} ${count === 1 ? 'item' : 'items'} to "${destName}"?`,
      detail: 'Copy keeps the originals where they are. Move removes them from their current location.',
      buttons: ['Copy', 'Move', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    return result.response === 0 ? 'copy' : result.response === 1 ? 'move' : 'cancel'
  })

  // Confirm reloading the canvas after the workspace.json file changed on disk
  // (edited externally while Cate was running).
  ipcMain.handle(DIALOG_CONFIRM_RELOAD_WORKSPACE, async (event, payload: { name?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const name = payload?.name?.trim()
    const result = await dialog.showMessageBox(win!, {
      type: 'question',
      message: 'Reload workspace from disk?',
      detail: `The workspace file${name ? ` for "${name}"` : ''} changed on disk. Reload to apply it? This rebuilds the canvas and restarts terminals; the current in-app layout will be discarded.`,
      buttons: ['Reload', 'Keep Current'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0 ? 'reload' : 'cancel'
  })

  // Ask where to open a Cmd/Ctrl+clicked terminal link the first time (while the
  // terminalLinkOpenTarget setting is 'ask'). The chosen target is remembered by
  // the renderer and can be changed later in Settings → Browser.
  ipcMain.handle(DIALOG_TERMINAL_LINK_OPEN, async (event, payload: { url: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const url = payload?.url ?? ''
    const result = await dialog.showMessageBox(win!, {
      type: 'question',
      message: 'Open link',
      detail: `${url}\n\nYou can change this later in Settings → Browser.`,
      buttons: ['On Canvas', 'In System Browser', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    return result.response === 0 ? 'canvas' : result.response === 1 ? 'external' : 'cancel'
  })

  // Capture page screenshot for panel previews
  ipcMain.handle(CAPTURE_PAGE, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return null
      const image = await win.webContents.capturePage()
      return image.toDataURL()
    } catch (error) {
      log.error('[CAPTURE_PAGE]', error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  })

  // Capture a webview's visible content, save to Desktop, return dataUrl + path
  ipcMain.handle(WEBVIEW_SCREENSHOT, async (event, webContentsId: number) => {
    try {
      // Validate the webContentsId belongs to a webview guest of the calling window
      const callerWin = BrowserWindow.fromWebContents(event.sender)
      const wc = webContents.fromId(webContentsId)
      if (!wc || wc.isDestroyed()) return null
      // Ensure the target webContents belongs to the caller's window
      const targetWin = BrowserWindow.fromWebContents(wc)
      if (!callerWin || !targetWin || targetWin.id !== callerWin.id) {
        // For webview guests, the host window should match the caller
        const hostWc = wc.hostWebContents
        if (!hostWc || hostWc.id !== event.sender.id) {
          log.warn(`[webview:screenshot] Denied: webContentsId ${webContentsId} does not belong to calling window`)
          return null
        }
      }
      const image = await wc.capturePage()
      if (image.isEmpty()) return null

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const fileName = `screenshot-${timestamp}.png`
      const filePath = path.join(app.getPath('desktop'), fileName)
      await fs.promises.writeFile(filePath, image.toPNG())

      return { filePath, dataUrl: image.toDataURL() }
    } catch (error) {
      log.error(`[${WEBVIEW_SCREENSHOT}]`, error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  })

  // Configure a browser panel's per-partition proxy (issue #241). Awaited by the
  // renderer before it mounts the <webview> so the first request is proxied.
  ipcMain.handle(BROWSER_SET_PROXY, async (_event, partition: string, proxyUrl?: string) => {
    try {
      await configureBrowserProxy(partition, proxyUrl)
    } catch (error) {
      log.error(`[${BROWSER_SET_PROXY}]`, error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  })

  // Native file drag from renderer (for screenshot thumbnails etc.)
  ipcMain.handle(NATIVE_FILE_DRAG, async (event, filePath: string) => {
    // A remote path has no local file to export into a native OS drag — no-op
    // rather than mis-resolving the locator against the local filesystem.
    if (!isLocalLocator(filePath)) {
      return { ok: false, reason: 'remote' }
    }
    try {
      const validPath = validatePath(filePath)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      // Create a small drag icon from the file
      const iconSize = 64
      const iconImage = nativeImage.createFromPath(validPath)
      const icon = iconImage.isEmpty() ? nativeImage.createEmpty() : iconImage.resize({ width: iconSize })
      event.sender.startDrag({ file: validPath, icon })
    } catch (error) {
      log.error('[NATIVE_FILE_DRAG]', error)
      throw error instanceof Error ? error : new Error(String(error))
    }
  })

  // Id of the most recently started cross-window drag. Declared up here (above
  // DRAG_DETACH, which references it) but owned by the cross-window section
  // below. Survives the live-state null-out so RESOLVE can look up the claim
  // record by id even when DROP cleared crossWindowDragState before the
  // resolver was armed. Only one drag is in flight at a time (single cursor).
  let lastCrossWindowDragId: string | null = null

  // Renderer-driven title sync — used so each native macOS tab shows the
  // active workspace name instead of the generic app title.
  ipcMain.handle(WINDOW_SET_TITLE, async (event, title: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (typeof title === 'string' && title.length > 0) {
      win.setTitle(title)
    }
  })

  // Custom window controls (frameless Windows/Linux chrome). Per-window: resolve
  // the calling window from the IPC sender so a panel/dock window controls itself.
  ipcMain.handle(WINDOW_MINIMIZE, (event) => {
    windowFromEvent(event)?.minimize()
  })
  ipcMain.handle(WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(WINDOW_CLOSE, (event) => {
    windowFromEvent(event)?.close()
  })
  ipcMain.on(WINDOW_IS_MAXIMIZED, (event) => {
    event.returnValue = windowFromEvent(event)?.isMaximized() ?? false
  })

  // Panel transfer protocol
  ipcMain.handle(PANEL_TRANSFER, async (event, snapshot: PanelTransferSnapshot, targetWindowId?: number, workspaceId?: string) => {
    // Begin terminal buffering if this is a terminal transfer
    if (snapshot.terminalPtyId) {
      beginTerminalTransfer(snapshot.terminalPtyId, targetWindowId ?? -1)
    }

    if (targetWindowId) {
      // Transfer to existing window
      sendToWindow(targetWindowId, PANEL_RECEIVE, snapshot)
      // Track panel metadata for the target window (keep its existing workspace
      // id unless the caller supplied one)
      setPanelWindowMeta(targetWindowId, snapshot.panel, workspaceId)
    } else {
      // Refuse creating a new panel window while any Cate window is in
      // macOS native fullscreen — the new window would land in a separate
      // Space and appear as an empty black page. Caller should fall back to
      // keeping the panel in the source window.
      if (anyWindowFullscreen()) return null
      // Create a new panel window and send the transfer there. Pass the source
      // workspaceId so the window is registered to it at creation — otherwise it
      // is persisted to no workspace and lost on the next restart. The caller
      // SHOULD supply one, but guard against a falsy value: fall back to the
      // sender window's workspace, then the active main window's.
      const senderId = BrowserWindow.fromWebContents(event.sender)?.id
      const resolvedWorkspaceId =
        workspaceId ||
        (senderId != null ? getWindowWorkspaceId(senderId) : undefined) ||
        (() => {
          const main = getActiveMainWindow()
          return main ? getWindowWorkspaceId(main.id) : undefined
        })()
      if (!resolvedWorkspaceId) {
        log.warn('PANEL_TRANSFER: creating panel window with no workspace id — it may be lost on restart', { panelId: snapshot.panel.id })
      }
      const newWin = createWindow({
        type: 'panel',
        panelType: snapshot.panel.type,
        panelId: snapshot.panel.id,
        workspaceId: resolvedWorkspaceId,
      })

      // Track panel metadata
      setPanelWindowMeta(newWin.id, snapshot.panel, resolvedWorkspaceId)

      // Position at saved geometry if available
      if (snapshot.geometry) {
        newWin.setBounds({
          x: Math.round(snapshot.geometry.origin.x),
          y: Math.round(snapshot.geometry.origin.y),
          width: Math.round(snapshot.geometry.size.width),
          height: Math.round(snapshot.geometry.size.height),
        })
      }

      // Update target for terminal buffering
      if (snapshot.terminalPtyId) {
        beginTerminalTransfer(snapshot.terminalPtyId, newWin.id)
      }

      // Wait for the window to be ready, then send the snapshot
      newWin.webContents.once('did-finish-load', () => {
        sendToWindow(newWin.id, PANEL_RECEIVE, snapshot)
      })

      return newWin.id
    }
  })

  ipcMain.handle(PANEL_TRANSFER_ACK, async (_event, ptyId?: string) => {
    if (ptyId) {
      acknowledgeTerminalTransfer(ptyId)
    }
  })

  // List all active panel windows with their metadata and bounds
  ipcMain.handle(PANEL_WINDOWS_LIST, async () => {
    return listPanelWindows()
  })

  // Renderer reports a panel window's terminal ptyId so we can persist it for replay on next launch
  ipcMain.handle(PANEL_WINDOW_SYNC_PTY, async (event, ptyId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setPanelWindowTerminalPtyId(win.id, ptyId)
  })

  // Renderer pushes an updated PanelState — used after Save-As inside a
  // detached panel window so the windowRegistry meta (the source for
  // session persistence + the panel-window list) reflects the new
  // filePath/title/clean state instead of the at-transfer-time snapshot.
  ipcMain.handle(PANEL_WINDOW_SYNC_META, async (event, payload: { panel: PanelState; workspaceId?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || !payload?.panel) return
    setPanelWindowMeta(win.id, payload.panel, payload.workspaceId)
  })

  // Double-click panel window title bar → re-integrate the panel into the main
  // window, then close the panel window. The panel's record was already removed
  // from the main workspace at detach time, so the renderer sends a full
  // snapshot (live panel + canvas/terminal state) the main window uses to
  // reconstruct it. We also arm the terminal-ownership transfer HOME — exactly
  // like a cross-window drop — so the live PTY (and any canvas child PTYs)
  // follow the panel back instead of dying with the window.
  ipcMain.handle(PANEL_WINDOW_DOCK_BACK, async (event, snapshot?: PanelTransferSnapshot) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const mainWin = getActiveMainWindow()

    // Arm terminal transfer back to the main window so reconnectTerminal's
    // panelTransferAck on the receiving side finds a pending transfer (ack is a
    // no-op without a prior begin).
    if (mainWin && snapshot) {
      if (snapshot.terminalPtyId) {
        handleCrossWindowDropTerminalTransfer(snapshot.terminalPtyId, mainWin.id)
      }
      for (const t of Object.values(snapshot.canvasState?.childTerminals ?? {})) {
        if (t.ptyId) handleCrossWindowDropTerminalTransfer(t.ptyId, mainWin.id)
      }
    }

    // Tell the main window to re-add the panel (App.tsx re-integrates it). Send
    // ONLY to the main window so a second panel window doesn't try to claim it.
    if (mainWin) {
      sendToWindow(mainWin.id, PANEL_WINDOW_DOCK_BACK, { panelWindowId: win.id, snapshot })
    } else {
      // No main window to dock into — fall back to broadcasting the id so any
      // listener can react (and at minimum the window still closes below).
      broadcastToAll(PANEL_WINDOW_DOCK_BACK, { panelWindowId: win.id, snapshot })
    }

    // Close the panel window once the snapshot is on its way home.
    win.close()
  })

  // Cross-window drag-and-drop
  ipcMain.handle(DRAG_START, async (event, snapshot: PanelTransferSnapshot) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const tempFile = writeDragTempFile(snapshot)
    const icon = createDragGhostImage()

    win.webContents.startDrag({
      file: tempFile,
      icon,
    })
  })

  ipcMain.handle(DRAG_DETACH, async (_event, snapshot: PanelTransferSnapshot, workspaceId?: string) => {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)

    // Decide whether to detach and where to place the new window. `decideDetach`
    // refuses when any Cate window is in macOS native fullscreen (the new window
    // would land in a separate Space and appear black). Caller treats a null
    // return as "detach rejected — put the panel back where it came from".
    const decision = decideDetach({
      anyWindowFullscreen: anyWindowFullscreen(),
      cursor,
      grabOffset: { x: 12, y: 12 },
      size: {
        width: snapshot.geometry?.size?.width ?? 700,
        height: snapshot.geometry?.size?.height ?? 500,
      },
      displayBounds: display.workArea,
    })
    if (decision.kind === 'refuse') return null

    // Begin terminal buffering if applicable. For a canvas, each child terminal
    // is its own PTY that must transfer too — buffer them all so no output is
    // lost between detach and the new window reconnecting.
    if (snapshot.terminalPtyId) {
      beginTerminalTransfer(snapshot.terminalPtyId, -1)
    }
    for (const t of Object.values(snapshot.canvasState?.childTerminals ?? {})) {
      // Only LIVE transfer entries (ptyId) have a running PTY to buffer; restore
      // entries (replayPtyId) spawn fresh in the new window, so skip them.
      if (t.ptyId) beginTerminalTransfer(t.ptyId, -1)
    }

    const newWin = createWindow({
      type: 'dock',
      panelType: snapshot.panel.type,
      panelId: snapshot.panel.id,
      workspaceId,
    })

    // Update terminal transfer target now that we have the window ID
    if (snapshot.terminalPtyId) {
      beginTerminalTransfer(snapshot.terminalPtyId, newWin.id)
    }
    for (const t of Object.values(snapshot.canvasState?.childTerminals ?? {})) {
      if (t.ptyId) beginTerminalTransfer(t.ptyId, newWin.id)
    }

    newWin.setBounds({
      x: decision.position.x,
      y: decision.position.y,
      width: decision.size.width,
      height: decision.size.height,
    })

    // Build initial dock state: single center zone with one tab stack
    const initPayload: DockWindowInitPayload = {
      panels: { [snapshot.panel.id]: snapshot.panel },
      dockState: buildSinglePanelDockState(snapshot.panel.id),
      workspaceId: workspaceId ?? '',
      rootPath: snapshot.rootPath,
    }

    // Send the init payload + transfer snapshot once the window is ready
    newWin.webContents.once('did-finish-load', () => {
      sendToWindow(newWin.id, DOCK_WINDOW_INIT, initPayload)
      sendToWindow(newWin.id, PANEL_RECEIVE, snapshot)
      // Force show + focus — on macOS in fullscreen, the new window may not
      // auto-show because the OS thinks it belongs to a different Space.
      // (revealWindow skips the focus and stays inactive under e2e.)
      revealWindow(newWin, { focus: true })
    })

    cleanupDragTempFile()
    // End only the just-finished cross-window drag (if any) in other windows —
    // a window tracking a DIFFERENT active drag must not be force-ended here.
    // (DRAG_DETACH is the fallback when no window claimed the cross-window drop,
    // so the relevant remote drag is the last-started one.)
    broadcastToAll(DRAG_END, lastCrossWindowDragId ?? undefined)

    return newWin.id
  })

  // Synchronous fullscreen getter — renderers hit this on every drag
  // mousemove to decide whether to enter dock-drag / cross-window mode.
  // sendSync is fine at ~60 Hz and guarantees no stale state.
  ipcMain.on(WINDOW_FULLSCREEN_STATE, (event) => {
    event.returnValue = anyWindowFullscreen()
  })

  ipcMain.on(DRAG_END, () => {
    cleanupDragTempFile()
    broadcastToAll(DRAG_END)
  })

  // Dock window state sync (renderer -> main for session persistence)
  ipcMain.handle(DOCK_WINDOW_SYNC_STATE, async (event, state: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setDockWindowState(win.id, state as { dockState: any; panels: Record<string, PanelState>; workspaceId: string; terminalPtyIds?: Record<string, string>; canvasStates?: Record<string, CanvasLayoutSnapshot> })
  })

  // List all dock windows with state and bounds
  ipcMain.handle(DOCK_WINDOWS_LIST, async () => {
    return listDockWindows()
  })

  // Session restore of a detached dock window — rebuilds the FULL window (every
  // top-level tab + their terminal-replay / canvas-children hydration) from its
  // persisted snapshot, rather than synthesizing a single tab via DRAG_DETACH.
  // PTYs are dead on restore (terminals replay scrollback), so no terminal
  // buffering is needed and bounds come straight from the snapshot.
  ipcMain.handle(DOCK_WINDOW_RESTORE, async (
    _event,
    payload: DetachedDockWindowSnapshot & { initPayload: DockWindowInitPayload },
  ) => {
    const { initPayload, bounds, workspaceId } = payload
    const topLevelIds = collectTopLevelPanelIds(initPayload.dockState)
    const firstId = topLevelIds[0]
    if (!firstId) return null
    const firstPanel = initPayload.panels[firstId]
    if (!firstPanel) return null

    const newWin = createWindow({
      type: 'dock',
      panelType: firstPanel.type,
      panelId: firstPanel.id,
      workspaceId: workspaceId || undefined,
    })

    if (bounds) newWin.setBounds(bounds)

    newWin.webContents.once('did-finish-load', () => {
      sendToWindow(newWin.id, DOCK_WINDOW_INIT, initPayload)
      revealWindow(newWin, { focus: false })
    })

    return newWin.id
  })

  // Cross-window drag coordination — `crossWindowDragState` is the pure state
  // (managed via dragLogic functions); `pollTimer` is the Electron-effect that
  // shadows it. They're cleared together.
  let crossWindowDragState: CrossWindowDragState | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  // Used by CROSS_WINDOW_DRAG_RESOLVE to detect if a target window claimed the
  // drop before the claim-wait timer fires.
  let crossWindowDropClaimedResolve: (() => void) | null = null

  // Claim outcomes keyed by dragId — survive the live-state teardown so a late
  // RESOLVE (one arriving after DROP already cleared crossWindowDragState
  // because no resolver was pending) still reads claimed=true rather than
  // inferring false from a nulled pointer. Pruned to the claim-wait window.
  let crossWindowClaims: Map<string, ClaimRecord> = new Map()

  const stopPollTimer = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  ipcMain.handle(CROSS_WINDOW_DRAG_START, async (event, snapshot: PanelTransferSnapshot, _screenPos: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    // Refuse any cross-window drag while any Cate window is in macOS
    // native fullscreen — the drag ghost would land in a different Space
    // (black window). Lock the drag to the source window entirely.
    if (anyWindowFullscreen()) return

    const cursor = screen.getCursorScreenPoint()
    crossWindowDragState = startCrossWindowDrag({
      dragId: crypto.randomUUID(),
      sourceWindowId: win.id,
      snapshot,
      cursor,
    })
    lastCrossWindowDragId = crossWindowDragState.dragId

    // Create the native drag ghost window — size to match the source panel
    // (canvas-space size; clamped inside createDragGhostWindow).
    createDragGhostWindow(
      snapshot.panel.type,
      snapshot.panel.title,
      snapshot.geometry?.size?.width ?? 320,
      snapshot.geometry?.size?.height ?? 200,
    )

    // Poll cursor position: move ghost, broadcast to all windows EXCEPT source
    pollTimer = setInterval(() => {
      if (!crossWindowDragState) return
      const pos = screen.getCursorScreenPoint()
      crossWindowDragState = updateCrossWindowCursor(crossWindowDragState, pos)
      moveDragGhostWindow(pos.x, pos.y)

      // Hide the native ghost when the cursor is over any Cate window — the
      // in-renderer DragOverlay handles the visual there. Show it again when
      // the cursor leaves all Cate windows (e.g. on the desktop between
      // windows) so the user still has a drag affordance.
      if (dragGhostWin && !dragGhostWin.isDestroyed()) {
        const overCateWindow = isCursorInsideAnyAppWindow(
          pos,
          BrowserWindow.getAllWindows() as unknown as GhostHostWindow[],
        )
        if (overCateWindow) {
          if (dragGhostWin.isVisible()) dragGhostWin.hide()
        } else {
          if (!dragGhostWin.isVisible()) dragGhostWin.showInactive()
        }
      }

      broadcastToAllExcept(crossWindowDragState.sourceWindowId, CROSS_WINDOW_DRAG_UPDATE, pos, crossWindowDragState.snapshot, crossWindowDragState.dragId)
    }, CROSS_WINDOW_POLL_MS)
  })

  ipcMain.handle(CROSS_WINDOW_DRAG_DROP, async (event, _panelId: string) => {
    if (crossWindowDragState) {
      stopPollTimer()
      // Mark the state as claimed (pure transition). The resolver below reads
      // `claimed` to decide whether to tell the source to remove its node.
      crossWindowDragState = claimCrossWindowDrop(crossWindowDragState, Date.now())
      // Record the claim keyed by dragId so a RESOLVE that arrives AFTER this
      // DROP clears the live state (the no-resolver branch below) still sees
      // claimed=true — preventing a duplicate detach. Pruned on every write.
      const now = Date.now()
      crossWindowClaims = pruneClaims(crossWindowClaims, now, CROSS_WINDOW_CLAIM_WAIT_MS)
      crossWindowClaims = recordClaim(crossWindowClaims, crossWindowDragState!.dragId, true, now)
      // Arm terminal-ownership transfer to the target (receiver) window — the
      // receiver's reconnectTerminal will panelTransferAck after wiring its
      // listeners, and ack is a no-op without a prior begin.
      const targetWin = BrowserWindow.fromWebContents(event.sender)
      if (targetWin) {
        if (crossWindowDragState!.snapshot.terminalPtyId) {
          handleCrossWindowDropTerminalTransfer(
            crossWindowDragState!.snapshot.terminalPtyId,
            targetWin.id,
          )
        }
        // A canvas carries its child terminals — arm each live PTY for the
        // receiver. (Cross-window drag is always a live transfer, so every entry
        // has a ptyId; the guard satisfies the now-optional type.)
        for (const t of Object.values(crossWindowDragState!.snapshot.canvasState?.childTerminals ?? {})) {
          if (t.ptyId) handleCrossWindowDropTerminalTransfer(t.ptyId, targetWin.id)
        }
      }
      // Notify source window to remove the panel (carry the dragId so an
      // unrelated active drag in that window isn't force-ended).
      sendToWindow(crossWindowDragState!.sourceWindowId, DRAG_END, crossWindowDragState!.dragId)
    }
    destroyDragGhostWindow()

    // Fire the pending resolver (if any). It will read `claimed=true` from
    // the state above and resolve `{ claimed: true }` to the source window.
    // The resolver is also responsible for nullifying `crossWindowDragState`.
    if (crossWindowDropClaimedResolve) {
      crossWindowDropClaimedResolve()
    } else {
      // No resolve in flight — clear the LIVE state directly. The claim is
      // preserved in crossWindowClaims (recorded above, keyed by dragId), so a
      // RESOLVE arriving after this still reads claimed=true rather than
      // inferring false from the nulled pointer (which would duplicate the
      // panel via a fallback detach).
      crossWindowDragState = cancelCrossWindowDrag(crossWindowDragState)
    }
  })

  ipcMain.handle(CROSS_WINDOW_DRAG_CANCEL, async () => {
    if (!crossWindowDragState) return
    stopPollTimer()
    const dragId = crossWindowDragState.dragId
    crossWindowDragState = cancelCrossWindowDrag(crossWindowDragState)
    destroyDragGhostWindow()
    broadcastToAll(DRAG_END, dragId)
  })

  // Resolve cross-window drag on mouseup from source window.
  // Broadcasts DRAG_END, waits briefly for a target window to claim via
  // CROSS_WINDOW_DRAG_DROP, then returns whether the drop was claimed. If not,
  // source falls back to DRAG_DETACH.
  ipcMain.handle(CROSS_WINDOW_DRAG_RESOLVE, async () => {
    // The live state may already be gone if a DROP landed (and cleared it)
    // before this RESOLVE arrived. In that case the claim outcome lives in the
    // dragId-keyed record, NOT in the (nulled) pointer — read it there so a
    // just-completed claim isn't misread as unclaimed (which would duplicate
    // the panel via a fallback detach).
    if (!crossWindowDragState) {
      const dragId = lastCrossWindowDragId
      const claimed = dragId
        ? lookupClaim(crossWindowClaims, dragId, Date.now(), CROSS_WINDOW_CLAIM_WAIT_MS)
        : false
      return { claimed }
    }

    const sourceId = crossWindowDragState.sourceWindowId
    const dragId = crossWindowDragState.dragId

    // Stop polling but keep the state alive so DROP can still claim it within
    // the short wait window below.
    stopPollTimer()
    const stateAtResolve = { ...crossWindowDragState, resolvedAt: Date.now() }
    crossWindowDragState = stateAtResolve

    destroyDragGhostWindow()

    // Broadcast DRAG_END to non-source windows so target windows check their
    // drop targets. The dragId lets each window force-end only ITS OWN remote
    // drag (a window with an unrelated active drag ignores this).
    broadcastToAllExcept(sourceId, DRAG_END, dragId)

    // Wait briefly for a target window to call CROSS_WINDOW_DRAG_DROP.
    return new Promise<{ claimed: boolean }>((resolve) => {
      const finish = (now: number): void => {
        crossWindowDropClaimedResolve = null
        // Decide from the live state if present, else fall back to the claim
        // record (covers a DROP that cleared the pointer between arming and
        // firing the resolver).
        const liveDecision = resolveCrossWindowDrag(crossWindowDragState)
        const claimed =
          liveDecision.claimed ||
          lookupClaim(crossWindowClaims, dragId, now, CROSS_WINDOW_CLAIM_WAIT_MS)
        crossWindowDragState = cancelCrossWindowDrag(crossWindowDragState)
        resolve({ claimed })
      }

      const timeout = setTimeout(() => finish(Date.now()), CROSS_WINDOW_CLAIM_WAIT_MS)

      crossWindowDropClaimedResolve = () => {
        clearTimeout(timeout)
        finish(Date.now())
      }
    })
  })
}

// =============================================================================
// App lifecycle / bootstrap
// =============================================================================

// Set app name before menu and window creation
app.setName('Cate')

// Windows: the toast notification system keys off the AppUserModelID, and it
// must match the install shortcut's ID (electron-builder uses `appId`) for the
// notification 'click' event to fire reliably. No-op on macOS/Linux.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.cate.app')
}

// In dev mode, use a separate userData directory so dev and production don't collide
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), 'Dev'))
}

// First-start simulation (`npm run dev:firststart`). Point userData at a
// dedicated dir that's wiped on every launch, so the app boots exactly like a
// brand-new install: telemetry notice + onboarding tour, empty session, no
// recent projects or saved window geometry. Dev-only; never in a packaged app.
if (!app.isPackaged && process.env.CATE_FRESH_USERDATA === '1') {
  const fs = require('fs') as typeof import('fs')
  const dir = path.join(app.getPath('userData'), 'FirstStart')
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* noop */ }
  fs.mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
  log.info('[firststart] fresh userData (wiped on each launch): %s', dir)
}

// Dev-only: simulate launching right after an update at a given level
// (major / minor / patch). Uses its own wiped userData dir, then seeds the
// analytics state so `checkAndReportUpdate` sees a version bump from a synthetic
// previous version. The grandfather block below marks it as an existing
// (already-onboarded) user, so the onboarding tour stays hidden — but the
// telemetry notice still appears, because the simulated profile hasn't
// acknowledged the current TELEMETRY_NOTICE_VERSION (exactly like a real user
// updating into this release). On major/minor bumps the post-update feedback
// dialog appears alongside it; a patch bump shows the notice only. See dev:update:*.
if (!app.isPackaged && (process.env.CATE_SIMULATE_UPDATE === 'major' || process.env.CATE_SIMULATE_UPDATE === 'minor' || process.env.CATE_SIMULATE_UPDATE === 'patch')) {
  const level = process.env.CATE_SIMULATE_UPDATE
  const fs = require('fs') as typeof import('fs')
  const dir = path.join(app.getPath('userData'), `SimUpdate-${level}`)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* noop */ }
  fs.mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
  const from = devSimulateUpdateFrom(level)
  log.info('[sim-update] %s: simulating update %s → %s (userData: %s)', level, from, app.getVersion(), dir)
}

// In E2E mode, use a fresh tmpdir per launch so Playwright runs are isolated
// from each other and from local dev state. The harness sets CATE_E2E=1.
if (process.env.CATE_E2E === '1') {
  // The e2e window is never shown, so Chromium throttles it. Per-window
  // backgroundThrottling:false isn't enough on Windows: its native occlusion
  // detection marks a never-mapped window as occluded and freezes the
  // compositor — and with it the rAF loop that applies node-drag transforms —
  // so every drag spec times out on the Windows runner while no-op specs pass.
  // These switches (no-ops on macOS/Linux, where the symptom doesn't occur)
  // disable that occlusion freeze and renderer/timer backgrounding. Must run
  // before app-ready, which this module-level block does.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')

  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  // CATE_E2E_USERDATA lets persistence tests reuse the same dir across launches.
  const tmp =
    process.env.CATE_E2E_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'cate-e2e-'))
  app.setPath('userData', tmp)
  // Keep the e2e app out of the macOS dock / app-switcher so launching it never
  // foregrounds the shared Electron bundle (and a running `npm run dev`).
  app.dock?.hide()
}

// Register the macOS open-file handler at top level: the event can fire before
// app-ready, so we must be listening early to queue paths into pendingOpenPaths.
registerOpenFileHandler()

// Build application menu
buildApplicationMenu()

log.info('Cate v%s starting (electron %s, node %s, platform %s)', app.getVersion(), process.versions.electron, process.versions.node, process.platform)

// Load persisted settings synchronously so window-creation code paths can read
// them before the async electron-store finishes initializing.
loadSettingsSyncFromDisk()

// Scope the onboarding tour to genuine first installs. Anyone who has launched
// Cate before is marked past it, so an update never replays the tour. The
// telemetry notice (WelcomeDialog) intentionally has NO such clause — every
// user whose acknowledged notice version is below TELEMETRY_NOTICE_VERSION
// sees it once, updaters included.
if (hasRunBefore()) {
  if (!getSettingSync('onboardingCompleted')) {
    void setSettingsFromMain({ onboardingCompleted: true })
  }
}

// Under Playwright the profile is a fresh tmpdir, which would otherwise trigger
// the telemetry notice + onboarding takeover and cover the canvas the specs
// drive. Mark both as already handled so e2e starts on a clean canvas. Runs
// before the renderer queries settings, so the dialogs never flash.
if (IS_E2E) {
  void setSettingsFromMain({ telemetryNoticeAcknowledgedVersion: TELEMETRY_NOTICE_VERSION, onboardingCompleted: true })
}

// Initialize Sentry as early as possible — before any IPC handlers or windows.
// Always on in packaged builds; no-op in dev unless SENTRY_DSN is set.
initSentry()
initAnalytics()

// Telemetry-notice acknowledgement from the renderer (WelcomeDialog).
registerTelemetryNoticeHandler()

// Provide the menu module a way to spawn additional main windows without
// importing this file (which would create a circular dependency).
setNewMainWindowFn(() => createWindow({ type: 'main' }))

// ---------------------------------------------------------------------------
// Crash / signal teardown. Local terminals run in the runtime daemon
// subprocess: when this main process dies its stdin closes, and the daemon's
// `process.stdin.on('close')` handler (src/runtime/index.ts) group-kills its
// ptys and exits — so dev servers/watchers don't survive as zombies. No
// in-process PTY cleanup is needed here anymore.
// ---------------------------------------------------------------------------

// Global error handlers — Sentry (when configured) captures the error before
// process exit.
process.on('uncaughtException', (err) => {
  log.error('uncaughtException: %O', err)
  captureMainException(err)
  flushSentry().finally(() => process.exit(1))
})
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection: %O', reason)
  captureMainException(reason)
})

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, exiting')
  process.exit(0)
})

process.on('SIGINT', () => {
  log.info('Received SIGINT, exiting')
  process.exit(0)
})

// maticon:// must be registered as privileged BEFORE app.whenReady() so the
// renderer can use it as an image src without CSP/security violations.
protocol.registerSchemesAsPrivileged([
  { scheme: 'maticon', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
])

app.whenReady().then(async () => {
  // Phase 0 perf marker — log a high-resolution timestamp at app.whenReady
  // so cold-launch traces can be reconstructed from main + renderer logs.
  log.info('[perf] app.whenReady t=%dms', Math.round(performance.now()))
  log.info('App ready, resolving shell environment...')
  registerFileIconProtocol()

  // Resolve the user's real shell environment before registering handlers.
  // This ensures MCP servers, `which` lookups, etc. see the full PATH.
  await initShellEnv()
  log.info('Shell environment resolved')

  // Bring the local workspace online: provision + launch the host-target runtime
  // tarball as a local daemon, the same path remote hosts use. Done after the shell
  // env so the daemon inherits the full PATH for git/terminals. This registers a
  // DeferredRuntime SYNCHRONOUSLY (resolve(LOCAL) works immediately) and connects
  // the daemon in the background, so first-run tarball provisioning never blocks
  // the window paint — early IPC ops queue behind the deferred's `ready`.
  runtimes.ensureLocalRuntime({
    root: app.getPath('home'),
    exclusions: [...currentExclusionSet()],
    env: getShellEnv(),
    idleSuspend: getSettingSync('autoSuspendIdleTerminals'),
  })

  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: app.getName(),
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: `© ${new Date().getFullYear()} Cate`,
    })
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const origin = details.url
    if (origin.startsWith('file://') || (process.env.ELECTRON_RENDERER_URL && origin.startsWith(process.env.ELECTRON_RENDERER_URL))) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            `default-src 'self'; script-src 'self'${process.env.ELECTRON_RENDERER_URL ? " 'unsafe-inline' 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: file: maticon:; connect-src 'self' https: ws: wss: sentry-ipc:; font-src 'self' data:; base-uri 'self'`,
          ],
        },
      })
    } else {
      callback({})
    }
  })

  installWebContentsSecurity()
  installProxyAuthHandler()
  registerCriticalHandlers()
  log.info('Critical IPC handlers registered')

  // Install the cate-theme authoring skill into ~/.claude/skills (copy-if-missing).
  void installThemeSkill()

  const mainWin = createWindow({ type: 'main' })
  log.info('Main window created (id=%d)', mainWin.id)

  if (disableTrustScoping()) {
    addAllowedRoot(app.getPath('home'))
    log.warn('[security] Trust scoping disabled via dev-only flag; home directory restored to allowed roots')
  }

  // Check for a crash report from the previous session — shows an opt-in
  // dialog if one exists. Deferred until after the window is ready so the
  // dialog has a parent window and doesn't block startup.
  mainWin.once('ready-to-show', () => {
    setMainWindowReady(true)
    flushPendingOpenPaths()
    // Register deferred IPC handlers and start the auto-updater now that the
    // first paint has landed. Anything not on the cold-launch critical path
    // belongs here.
    registerDeferredHandlers()
    log.info('Deferred IPC handlers registered')
    initAutoUpdater()
    // Detect a version change since last launch and emit an app_updated event
    // before app_start, so the upgrade path lands in analytics in order.
    fireStartupTelemetry(mainWin)
    if (process.env.CATE_SMOKE_TEST === '1') {
      runSmokeAssertions(mainWin)
        .then(() => app.exit(0))
        .catch((err) => {
          log.error('[smoke] %O', err)
          app.exit(1)
        })
    }
  })
})

app.on('window-all-closed', () => {
  log.info('All windows closed, quitting')
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindowReady = false
    const win = createWindow({ type: 'main' })
    win.once('ready-to-show', () => {
      mainWindowReady = true
      flushPendingOpenPaths()
    })
  }
})

// ---------------------------------------------------------------------------
// Quit coordination — the renderer needs live PTYs to capture terminal CWD
// and scrollback, so we defer PTY teardown until the renderer confirms the
// session save is complete. Flow:
//   1. before-quit: flush loggers, send SESSION_FLUSH_SAVE to renderer, defer quit
//   2. renderer saves session (async — needs live PTYs for CWD/scrollback)
//   3. renderer sends SESSION_FLUSH_SAVE_DONE
//   4. main process re-triggers app.quit()
//   5. before-quit fires again (sessionFlushed = true, falls through)
//   6. will-quit: sync fallback save, kill PTYs, _exit(0)
// ---------------------------------------------------------------------------

let sessionFlushed = false
// Set once the user has confirmed (or there was nothing to confirm) that it's OK
// to quit while terminals are still running a foreground process. Gates the
// flush/quit sequence below so the confirmation only runs on the first pass.
let quitConfirmed = false
const FLUSH_TIMEOUT_MS = 1500
// Bound the pre-quit dock-window sync so an unresponsive detached window can't
// stall quit. Kept short relative to FLUSH_TIMEOUT_MS — it runs BEFORE the main
// renderer's session flush, so dock sync + session save share the quit budget.
const DOCK_FLUSH_TIMEOUT_MS = 600

app.on('before-quit', (event) => {
  if (sessionFlushed) {
    // Second pass — renderer already saved, let quit proceed to will-quit
    log.info('before-quit: session already flushed, proceeding')
    return
  }

  // First gate: warn before tearing down terminals that are still running a
  // foreground process (dev server, editor, agent, …). Mirrors the per-terminal
  // close confirmation. Deferred async, so we prevent the quit and re-trigger it
  // once the user confirms.
  //
  // Note: updates install on a NORMAL quit (electron-updater autoInstallOnAppQuit),
  // so there's no special update case here — the user is quitting deliberately and
  // the normal terminal-confirmation applies. will-quit handles the install hook.
  if (!quitConfirmed) {
    const running = getRunningTerminals()
    if (running.length > 0) {
      event.preventDefault()
      const allWindows = BrowserWindow.getAllWindows()
      const focusWin =
        allWindows.find((w) => !w.isDestroyed() && getWindowType(w.id) === 'main') ??
        allWindows.find((w) => !w.isDestroyed())
      const count = running.length
      const name = count === 1 ? running[0].processName?.trim() : undefined
      const message =
        count > 1
          ? `${count} terminals are still running. Quit anyway?`
          : name
            ? `“${name}” is still running. Quit anyway?`
            : 'A terminal is still running. Quit anyway?'
      void dialog
        .showMessageBox(focusWin!, {
          type: 'warning',
          message,
          detail:
            count > 1
              ? 'The processes running in these terminals will be terminated.'
              : 'The process running in this terminal will be terminated.',
          buttons: ['Quit', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        .then((result) => {
          if (result.response === 0) {
            quitConfirmed = true
            app.quit() // re-trigger quit; this gate now passes
          }
          // Cancel: leave the app running.
        })
      return
    }
    // Nothing running — skip the confirmation on the re-triggered pass too.
    quitConfirmed = true
  }

  log.info('Before quit, flushing loggers and requesting session save')
  flushAllLoggers()
  const allWindows = BrowserWindow.getAllWindows()
  const mainWin = allWindows.find((w) => !w.isDestroyed() && getWindowType(w.id) === 'main')

  if (!mainWin) {
    // No renderer to save — proceed immediately
    sessionFlushed = true
    return
  }

  // Prevent quit until the renderer confirms session save
  event.preventDefault()

  const proceed = () => {
    sessionFlushed = true
    app.quit()
  }

  // Listen for renderer ACK
  ipcMain.once(SESSION_FLUSH_SAVE_DONE, () => {
    log.info('Session flush save confirmed by renderer')
    proceed()
  })

  // Safety timeout — don't hang forever if the renderer is unresponsive
  setTimeout(() => {
    if (!sessionFlushed) {
      log.warn('Session flush timed out after %dms, proceeding with quit', FLUSH_TIMEOUT_MS)
      proceed()
    }
  }, FLUSH_TIMEOUT_MS)

  // FINAL, AWAITED sync from every dock window FIRST, so the main renderer's
  // session flush (which reads listDockWindows() / main's cached dock state)
  // sees the freshest dock layout + terminal/canvas state instead of stale data
  // from the last 5s tick. Bounded by DOCK_FLUSH_TIMEOUT_MS so an unresponsive
  // dock window can't delay quit. Runs before SESSION_FLUSH_SAVE either way.
  const dockWindowIds = listDockWindowIds()
  flushDockWindowsBeforeQuit({
    windowIds: dockWindowIds,
    requestSync: (id) => sendToWindow(id, DOCK_WINDOW_FLUSH_SYNC),
    subscribeAck: (handler) => {
      const listener = (e: Electron.IpcMainEvent) => {
        const win = BrowserWindow.fromWebContents(e.sender)
        if (win) handler(win.id)
      }
      ipcMain.on(DOCK_WINDOW_FLUSH_SYNC_DONE, listener)
      return () => ipcMain.removeListener(DOCK_WINDOW_FLUSH_SYNC_DONE, listener)
    },
    timeoutMs: DOCK_FLUSH_TIMEOUT_MS,
  })
    .catch(() => {})
    .finally(() => {
      if (sessionFlushed) return
      const claudeIds = getClaudeTerminalIds()
      if (claudeIds.length === 0) {
        mainWin.webContents.send(SESSION_FLUSH_SAVE)
        return
      }
      // Send Ctrl+C to claude-running terminals and wait for --resume UUIDs
      // before the normal session flush so session.json captures them.
      const CLAUDE_CAPTURE_TIMEOUT_MS = 4000
      const captureDone = () => {
        if (sessionFlushed) return
        mainWin.webContents.send(SESSION_FLUSH_SAVE)
      }
      const captureTimer = setTimeout(captureDone, CLAUDE_CAPTURE_TIMEOUT_MS)
      ipcMain.once(CLAUDE_CAPTURE_DONE, () => {
        clearTimeout(captureTimer)
        captureDone()
      })
      mainWin.webContents.send(CLAUDE_CAPTURE_START, claudeIds)
    })
})

app.on('will-quit', () => {
  // Last-resort synchronous save from cached session data.
  // The renderer flush above should have completed, but this ensures
  // we write something if it didn't.
  log.info('will-quit: sync project state save fallback')
  saveProjectStateSync()
  // Flush any pending debounced settings.json write so a just-changed setting
  // survives the quit (the async writer wouldn't fire before process exit).
  flushSettingsPendingWritesSync()
  // Same for the workspace-state files (recent projects, sidebar, remote
  // workspaces, layouts) — flush their debounced writes before the process exits.
  flushWorkspaceStateSync()
  // And the ui-state.json file (minimap placement).
  flushUIStateSync()
  // Drop per-project locks so a co-running instance can take over immediately
  // (a crash skips this; the next instance reclaims the stale lock by pid).
  releaseAllProjectLocks()
  // Kill all PTYs now — AFTER session save so the renderer had access to live
  // PTY data (CWD, scrollback) during the flush triggered in before-quit.
  // Must happen while the JS environment is still alive. If we let them die
  // during Environment::CleanupHandles, node-pty's ThreadSafeFunction exit
  // callback throws into a torn-down context and SIGABRTs the process.
  killAllTerminals()
  // Tear down any remote/WSL companion connections (kills their daemons /
  // closes SSH). Fire-and-forget — quit must not block on a remote socket.
  void runtimes.disposeAll()
  // An update has been downloaded and is queued to install on quit. DO NOT
  // reallyExit — electron-updater's install-on-quit hook runs on the 'quit'
  // event (which fires AFTER will-quit), so reallyExit (libc exit()) would kill
  // the process first and the update would never apply. Let the natural quit
  // path run; the installer takes over the process shortly.
  if (isUpdatePendingInstall()) {
    log.info('will-quit: update staged, yielding to electron-updater install-on-quit')
    return
  }
  // Force immediate exit to bypass node::FreeEnvironment → CleanupHandles →
  // uv_run, which drains pending ThreadSafeFunction callbacks and can SIGABRT
  // after node-pty teardown. process.reallyExit is Node's binding to libc
  // exit() — it skips the 'exit' event and the cleanup path app.exit/process.exit
  // would run. All important cleanup (session save, logger flush, watcher
  // disposal, process group kills) is already done above.
  ;(process as unknown as { reallyExit(code: number): never }).reallyExit(0)
})
