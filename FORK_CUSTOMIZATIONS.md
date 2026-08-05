# Fork Customizations (WindowsHyun/cate)

This document records all custom features and changes made to this fork.
**Read this file before every upstream merge** to know what must be preserved.

---

## Custom Features

### 1. Workspace Groups
Sidebar workspaces can be grouped with color-coded labels (Porthos, Work, Project, etc.).

**Key files:**
- `src/renderer/stores/appStore.ts` — `workspaceGroups`, `moveWorkspaceToGroup`, `setWorkspaceGroups`, `seedRememberedGroups`, `rememberedGroupIds`, `persistGroupsToSidebar`
- `src/renderer/sidebar/WorkspaceGroupRow.tsx` — group row UI
- `src/renderer/sidebar/WorkspaceTab.tsx` — workspace tab with group color
- `src/renderer/sidebar/ProjectList.tsx` — `toggleExpanded`, `isExpanded`, `onToggleExpand` props on `WorkspaceTabProps`
- `src/shared/types.ts` — `WorkspaceGroup` type, `groups`/`workspaceGroupMap` on `SidebarSession` and `MultiWorkspaceSession`
- `src/renderer/lib/workspace/sessionLoad.ts` — forwards `groups`/`workspaceGroupMap` from `applySidebarSession` into returned `MultiWorkspaceSession`
- `src/renderer/lib/workspace/sessionStartup.ts` — applies groups + per-workspace groupIds after restore via `seedRememberedGroups` + `useAppStore.setState`
- `src/renderer/lib/workspace/sidebarSession.ts` — `deriveSidebarSession`/`applySidebarSession` handle groups

**Merge risk:** HIGH. Upstream does not have workspace groups. Any change to `appStore.ts`, `sessionLoad.ts`, `sessionStartup.ts`, `sidebarSession.ts`, `types.ts` can break group restore.

---

### 2. SQLite Viewer Panel (Database Panel)
Dedicated panel type `database` that renders SQLite files as browsable tables.

**Key files:**
- `src/main/sqlite.ts` — IPC handlers for SQLite queries
- `src/main/index.ts` — `registerSqliteHandlers()` call in `registerCriticalHandlers()`
- `src/renderer/panels/DatabasePanel.tsx` — panel component
- `src/renderer/panels/registry.ts` — `database` panel registered
- `src/shared/types.ts` — `'database'` added to `PanelType`, `PANEL_CANVAS_DROP_SIZES`
- `src/shared/panels.ts` — `database` in panel definitions

**Merge risk:** MEDIUM. Upstream has no `database` PanelType. Any change to `PanelType` union or `PANEL_CANVAS_DROP_SIZES` record requires adding `database` back.

---

### 3. Pin Nodes (Canvas Position Lock)
Canvas nodes can be pinned to prevent accidental drag/resize.

**Key files:**
- `src/renderer/canvas/CanvasNode.tsx` — pin toggle UI + locked drag behavior
- `src/renderer/canvas/useCanvasNodeDrag.ts` — respects `pinned` flag
- `src/renderer/stores/canvas/nodesSlice.ts` — `pinned` field on node state
- `src/shared/types.ts` — `pinned?: boolean` on canvas node type

**Merge risk:** MEDIUM. Upstream canvas node changes may overwrite pin logic.

---

### 4. Opacity Slider
Canvas nodes have an opacity control in the node header.

**Key files:**
- `src/renderer/canvas/useCanvasNodeStyle.ts` — applies opacity CSS
- `src/renderer/canvas/CanvasNode.tsx` — slider UI

**Merge risk:** LOW. Isolated to node styling.

---

### 5. Browser Panel Keep-Alive
Browser panels stay mounted when switched away (preserves scroll position, avoids reload).

**Key files:**
- `src/renderer/panels/BrowserPanel.tsx` — keep-mounted pattern + scroll restore
- `src/renderer/docking/DockTabStack.tsx` — visibility management
- `src/renderer/panels/browserUrlCache.ts` — URL cache for browser panels
- `src/renderer/settings/BrowserSettings.tsx` — keep-alive toggle setting

**Merge risk:** MEDIUM. Upstream DockTabStack changes may conflict.

---

### 6. Claude Session Resume
Allows resuming previous Claude Code (claude.ai/code) agent sessions.

**Key files:**
- `src/main/ipc/claudeResume.ts` — IPC handlers
- `src/main/index.ts` — `registerClaudeResumeHandlers()` call in `registerCriticalHandlers()`

**Merge risk:** LOW. Self-contained module.

---

### 7. Material Dark Theme
Custom Material Design dark color theme.

**Key files:**
- `src/shared/themes/materialDark.ts` — theme definition
- `src/shared/themes/index.ts` — theme registered
- `src/renderer/styles/globals.css` — global overrides

**Merge risk:** LOW. Isolated to theme files.

---

### 8. Material Icons (File Tree)
File explorer uses Material Design icons instead of default icons.

**Key files:**
- `src/renderer/sidebar/FileTreeNode.tsx` — `ICON_PROPS` constant, icon rendering
- `src/renderer/sidebar/FileExplorer.tsx` — icon integration

**Merge risk:** LOW.

---

### 9. Canvas Layouts (Saved Layouts)
Named canvas layouts that can be saved and restored.

**Key files:**
- `src/renderer/stores/canvas/arrangeSlice.ts` — layout save/restore logic
- `src/renderer/settings/CanvasSettings.tsx` — layout management UI

**Merge risk:** MEDIUM.

---

### 10. Korean UI / Translations
Korean language support throughout the app.

**Key files:**
- `src/renderer/hooks/useTranslation.ts` — translation hook
- Various component files — translated strings

**Merge risk:** LOW. Translation strings rarely conflict.

---

### 11. IPC Channels Added
Custom IPC channels added to `src/shared/ipc-channels.ts`:
```ts
export const PANEL_WINDOWS_LIST = 'panel:windowsList'
export const PANEL_WINDOW_SYNC_PTY = 'panel:windowSyncPty'
```

**Merge risk:** LOW, but easy to lose if `ipc-channels.ts` has conflicts.

---

### 12. Shared Panel Definition
`switcherColor?` optional field added to `SharedPanelDefinition` in `src/shared/panels.ts`.

---

### 13. Extension-Grouped File Opens
Files opened from the sidebar (double-click or context menu) group same-extension files as tabs in an existing canvas node instead of always spawning a new node. Files with no extension (Jenkinsfile, Makefile, Dockerfile, etc.) are grouped together using `''` as the group key.

**Key files:**
- `src/renderer/lib/fs/fileRouting.ts` — `openFileGrouped`, `openFileAsTextGrouped`, `openFileAsTabInNode`, `findGroupNodeForExt`
- `src/renderer/stores/canvasStore.ts` — `getAllCanvasStoreEntries()` export (reverse panel→store lookup)
- `src/renderer/sidebar/FileExplorer.tsx` — `handleFileOpen` uses `openFileGrouped` in canvas mode; `handleFileOpenNew` bypasses grouping
- `src/renderer/sidebar/FileTreeNode.tsx` — `onFileOpenNew` prop + "Open in New Canvas Node" context menu item

**Behavior:**
- Canvas mode: same extension → add as tab to existing node; first open → new node
- Right-click "Open in New Canvas Node" → always new canvas node (no grouping)
- Dock mode: unchanged (goes to center dock zone as before)
- Non-editor types (image, PDF, SQLite, HTML): always new node

**Merge risk:** LOW. Self-contained in `fileRouting.ts`; only minor additions to FileExplorer/FileTreeNode.

---

### 14. File Drop onto Canvas Node (Tab Insert)
Dragging a file from the file explorer onto an existing canvas node adds it as a tab in that node's mini-dock instead of creating a new floating canvas node.

**Key files:**
- `src/renderer/canvas/CanvasNode.tsx` — `onDragOver` + `onDrop` on root container; intercepts `application/cate-file` drops, calls `openFileAsTabInNode`
- `src/renderer/lib/fs/fileRouting.ts` — `openFileAsTabInNode(workspaceId, nodeId, filePath)`

**Behavior:**
- Drop on any part of a canvas node → add as tab (stops propagation to canvas)
- If node has no live mini-dock (unmounted/off-screen) → falls through to canvas handler (new node)
- Directory drops ignored

**Merge risk:** LOW. Drop handlers added to existing CanvasNode root div; no structural changes.

---

### 15. Directory Events in File Watcher
File explorer now updates in real-time when directories are created or deleted (previously only file `add`/`change`/`unlink` events were watched).

**Key files:**
- `src/main/ipc/filesystem.ts` — `createWatcher()` now also listens to `addDir` and `unlinkDir` chokidar events

**Merge risk:** LOW. Two-line addition to `createWatcher`.

---

### 16. Autosave Performance (Many Workspaces)
With 15+ open workspaces, the autosave cycle was blocking the render thread every 4s via synchronous `SerializeAddon.serialize()` calls for every terminal across every workspace. Three fixes applied:

1. **Drag-gated scheduling** — `scheduleSave()` now checks `useDragStore.getState().isDragging`; timers are not armed during active canvas drag. A save fires 1s after drag ends instead.
2. **Quick vs. full saves** — idle/change-triggered saves pass `quickSave=true` to `saveSession()`, skipping scrollback capture and CWD fetch for background (non-selected) workspaces. Periodic saves (every 30s) and flush-on-quit pass `quickSave=false` and capture everything.
3. **subscribeActive() only on workspace switch** — the appStore subscription now calls `subscribeActive()` only when `selectedWorkspaceId` changes, not on every panel mutation. `scheduleSave()` still fires on all changes.
4. **Timing tuned** — `IDLE_DELAY` 500ms → 1000ms, `MAX_WAIT` 4000ms → 8000ms.

**Key files:**
- `src/renderer/lib/workspace/sessionAutosave.ts` — drag check, quickSave propagation, subscribe selector, timing constants
- `src/renderer/lib/workspace/sessionSave.ts` — `saveSession(quickSave)` parameter, background workspace skip guards

**Merge risk:** LOW. Pure performance opt — no behavioral change for single-workspace usage. Background terminal scrollback may lag up to 30s (periodic save window).

---

### 17. File Watcher O(1) Targeted Refresh
FileExplorer was calling `loadTree(rootPath)` → `refreshExpandedChildren()` on every chokidar event, reading ALL expanded folders via IPC. During Claude Code execution (many file writes), this caused O(N expanded dirs) IPC calls every 150ms.

Fixes:
- Skip `update` events entirely (file content changes don't affect directory structure)
- For `create`/`delete`: read only the immediate parent directory of the changed entry — O(1) instead of O(N expanded)

**Key files:**
- `src/renderer/sidebar/FileExplorer.tsx` — `scheduleReload` callback now accepts `FsWatchEvent`, skips updates, does targeted parent-dir refresh

**Merge risk:** LOW. Behavioral change: expanded subdirectory contents update immediately on structural change (same as before), `update` events now ignored (was: triggered full tree reload unnecessarily).

---

### 18. Agent Streaming Delta rAF Batching
`appendAssistantDelta` called `set()` directly on every token (50-100/s during Claude streaming), causing the full AgentPanel to re-render on every token.

Batching via `requestAnimationFrame` coalesces all deltas within one frame (~16ms) into a single Zustand `setState` — reduces renders from 50-100/s to ≤60/s. `endAssistant` flushes pending deltas synchronously before finalizing so no tokens are lost.

**Key files:**
- `src/agent/renderer/agentStore.ts` — module-level `pendingTextDeltas`/`pendingThinkingDeltas` buffers, `flushStreamingDeltas()` via rAF, modified `appendAssistantDelta`/`appendAssistantThinking`/`endAssistant`

**Merge risk:** LOW. Purely mechanical batching — streaming output is identical, just applied in frames instead of per-token.

---

### 19. Claude --resume Project-Scoped Fix
`claude --resume <uuid>` in Claude Code 2.x is **project-scoped**: it searches `~/.claude/projects/<encoded-cwd>/` relative to the process CWD. When Cate restores a terminal in a different directory than where Claude was originally run (e.g., session stored in `-Users-nhn/` but terminal CWD is a sub-project), the session file exists but `claude` can't find it → "No conversation found".

Fix: also capture the project directory from `history.jsonl` at quit-time and store it alongside the session UUID. On restore, `replayTerminalLog` issues `cd "/original/project" && claude --resume <uuid>` instead of running from the terminal's CWD.

**Key files:**
- `src/main/ipc/claudeResume.ts` — `findResumeIdFromHistory` returns `{ sessionId, project }` instead of `string | null`; uses specificity scoring (exact > cwd-inside-project > project-inside-cwd, then path length, then timestamp) so workspace sessions win over broad home-dir matches
- `src/preload/index.ts` — `claudeFindResumeId` return type updated to match
- `src/shared/electron-api.d.ts` — same return type update
- `src/renderer/lib/claudeSessionCapture.ts` — exports `capturedResumeProjects: Record<string, string>` alongside `capturedResumeIds`
- `src/shared/types.ts` — `SessionSnapshot` + `ProjectSessionFile` gain `claudeResumeProjects?: Record<string, string>`
- `src/renderer/lib/workspace/sessionSerialize.ts` — `buildSessionFile` + `projectFilesToSnapshot` both pass through `claudeResumeProjects`
- `src/renderer/lib/workspace/sessionSave.ts` — snapshot includes `capturedResumeProjects`
- `src/renderer/lib/terminal/terminalRestoreData.ts` — entry gains `claudeResumeProject?: string`
- `src/renderer/lib/workspace/sessionRestore.ts` — `terminalRestoreData` seeded with `claudeResumeProject`; `replayTerminalLog` does `cd <project> && claude --resume <uuid>` when project is known

**Backward compat:** sessions saved before this fix have no `claudeResumeProjects` → falls back to `claude --resume <uuid>` without `cd` (same behavior as before).

**Merge risk:** LOW. Purely additive — new optional field + one extra `cd` in the restore command. Old session files unaffected.

---

### 20. Fit Panels Odd-Count Horizontal Layout Setting
"Fit Panels to Screen" (⌘5, `fitPanelsToViewport`) picks a uniform grid by minimizing empty cells + aspect deviation from 16:9. For an odd panel count, any multi-column split leaves an empty cell (heavily penalized), so it only ever chose a single column (vertical stack) or single row — never a "top row gets the extra panel" shape a landscape monitor user actually wants, since that shape is asymmetric and can't come out of a uniform-grid formula.

Fix: new setting `fitPanelsThreePanelLayout: 'vertical' | 'horizontal'` (default `'vertical'`, preserving existing behavior). When `'horizontal'` and an odd number of panels (≥3) are open, `fitPanelsToViewport()` takes a dedicated branch before the cols-selection loop and splits into 2 full-width rows: top row = `ceil(n/2)` equal-width panels, bottom row = `floor(n/2)` equal-width panels (3 → 2/1, 5 → 3/2, 7 → 4/3, ...).

**Key files:**
- `src/shared/types.ts` — `AppSettings.fitPanelsThreePanelLayout` + `DEFAULT_SETTINGS` entry
- `src/main/settingsFile.ts` — schema entry (`'string'`)
- `src/renderer/stores/canvas/arrangeSlice.ts` — `fitPanelsToViewport()` early-return branch for `n >= 3 && n % 2 === 1 && fitPanelsThreePanelLayout === 'horizontal'`
- `src/renderer/settings/CanvasSettings.tsx` — new `Select` row next to Auto Layout mode
- `src/renderer/i18n/strings.ts` — `canvas.fitPanelsThreePanelLayout*` keys (en/ko)

**Merge risk:** LOW. New optional setting, defaults to prior behavior, isolated branch in one function.

---

## Merge Checklist

Use this checklist every time you merge upstream changes:

### Before Merging
- [ ] Check upstream changelog for any `companion`/`runtime` renames or IPC refactors
- [ ] Note any upstream changes to `src/shared/types.ts`, `src/shared/ipc-channels.ts`, `src/main/index.ts`

### After Merging
- [ ] `npm run build` — fix all TypeScript errors before proceeding
- [ ] Check `src/shared/types.ts` — `PanelType` still includes `'database'`, `PANEL_CANVAS_DROP_SIZES` has `database` key
- [ ] Check `src/shared/ipc-channels.ts` — `PANEL_WINDOWS_LIST` and `PANEL_WINDOW_SYNC_PTY` still exported
- [ ] Check `src/shared/panels.ts` — `switcherColor?` still on `SharedPanelDefinition`
- [ ] Check `src/main/index.ts` `registerCriticalHandlers()` — `registerClaudeResumeHandlers()` and `registerSqliteHandlers()` still present, no duplicate handler registrations
- [ ] Check `src/renderer/lib/workspace/sessionLoad.ts` — `groups`/`workspaceGroupMap` forwarded from `applySidebarSession` into returned object
- [ ] Check `src/renderer/lib/workspace/sessionStartup.ts` — groups applied after workspace restore
- [ ] Check `src/renderer/stores/shortcutStore.ts` — module-level `useSettingsStore` calls wrapped in `queueMicrotask()`
- [ ] Check `src/main/workspaceStateStore.ts` — `MAX_RECENT_PROJECTS` is **50** (upstream default is 10; restoring 17 workspaces requires ≥17)
- [ ] Check `src/renderer/stores/canvasStore.ts` — `useVisibleNodeIds` uses `primitiveSetEqual` (NOT `primitiveArrayEqual`); `getAllCanvasStoreEntries()` exported (used by grouped file open)
- [ ] Check `src/renderer/lib/workspace/sessionSave.ts` — `deriveSidebarSession` call passes `updatedState.workspaceGroups` as 3rd arg; upstream omits it, silently dropping group name/color on every autosave
- [ ] Check `sessionSave.ts` snapshot includes `capturedResumeIds` **and** `capturedResumeProjects`; `sessionSerialize.ts` `buildSessionFile` and `projectFilesToSnapshot` both pass through `claudeResumeIds` **and** `claudeResumeProjects`; `terminalRestoreData.ts` entry has `claudeResumeProject?`; `sessionRestore.ts` seeds `claudeResumeProject` and `replayTerminalLog` does `cd <project> && claude --resume <uuid>`; `claudeResume.ts` `findResumeIdFromHistory` returns `{ sessionId, project }`; preload + `electron-api.d.ts` match that return type
- [ ] Check `src/renderer/lib/fs/fileRouting.ts` — `openFileGrouped`, `openFileAsTextGrouped`, `openFileAsTabInNode`, `findGroupNodeForExt` still present
- [ ] Check `src/renderer/canvas/CanvasNode.tsx` — root div has `onDragOver` + `onDrop` handlers for `application/cate-file` drops
- [ ] Check `src/main/ipc/filesystem.ts` `createWatcher()` — `addDir` and `unlinkDir` events wired alongside `add`/`change`/`unlink`
- [ ] Check `src/renderer/lib/workspace/sessionAutosave.ts` — `IDLE_DELAY=1000`, `MAX_WAIT=8000`; `scheduleSave()` checks `useDragStore.getState().isDragging`; appStore subscription only calls `subscribeActive()` when `selectedWorkspaceId` changes; periodic timer calls `runSave(false)`; flush save calls `saveSession(false)`
- [ ] Check `src/renderer/lib/workspace/sessionSave.ts` — `saveSession(quickSave = false)` parameter; scrollback capture and CWD fetch skip non-active workspaces when `quickSave=true`
- [ ] Check `src/renderer/sidebar/FileExplorer.tsx` — `scheduleReload` accepts `FsWatchEvent`; skips `event.type === 'update'`; refreshes only parent dir of changed entry (not full `loadTree`); imports `FsWatchEvent` from `fsWatchManager`
- [ ] Check `src/agent/renderer/agentStore.ts` — module-level `pendingTextDeltas`/`pendingThinkingDeltas` maps and `flushStreamingDeltas()` via rAF; `appendAssistantDelta`/`appendAssistantThinking` accumulate into buffers; `endAssistant` calls `flushStreamingDeltas()` before its `set()`
- [ ] Check `src/shared/types.ts` — `AppSettings.fitPanelsThreePanelLayout` and `DEFAULT_SETTINGS.fitPanelsThreePanelLayout` still present; `src/main/settingsFile.ts` `SETTINGS_SCHEMA` has matching `'string'` entry; `arrangeSlice.ts` `fitPanelsToViewport()` still has the `n >= 3 && n % 2 === 1` odd-count horizontal branch before the cols-selection loop

### Testing
- [ ] `CATE_SMOKE_TEST=1 ELECTRON_ENABLE_LOGGING=1 ./node_modules/.bin/electron .` — no errors, exits 0
- [ ] `./node_modules/.bin/electron .` — app opens, canvas visible
- [ ] Install packaged DMG — workspace groups visible in sidebar
- [ ] `npm run package:mac` — DMG builds successfully (requires `node scripts/build-runtime-tarball.mjs` first)

---

## Known Upstream Rename Patterns

### companion → runtime (done in upstream v1.3.1, commit 149cbb9)
The entire `companion` subsystem was renamed to `runtime`. If your fork has any file still using `companion`, update it:
- `CompanionConnection` → `RuntimeConnection`
- `CompanionPhase` → `RuntimePhase`
- `companionConnect` → `runtimeConnect`
- `LOCAL_COMPANION_ID` → `LOCAL_RUNTIME_ID`
- `dist-companion/` → `dist-runtime/`
- `companion/companionManager` → `runtime/runtimeManager`

---

## Bugs Fixed in This Fork (Not in Upstream)

| Bug | Fix | Commit |
|-----|-----|--------|
| App hangs on splash — duplicate IPC handler registrations | Removed `registerDialogHandlers()` + `registerCaptureHandlers()` from `registerCriticalHandlers()` | `e0a679e` |
| App hangs on splash — `useSettingsStore` TDZ crash | `queueMicrotask()` wrap in `shortcutStore.ts` module-level calls | `29553a9` |
| Workspace groups disappear on restart | Forward groups through `sessionLoad` → `sessionStartup` | `6567f04` |
| `releaseAllProjectLocks` not defined | Added missing import in `main/index.ts` | `7df5d2e` |
| Only 10 workspaces restored (groups assigned to missing workspaces lost) | `MAX_RECENT_PROJECTS` 10→50 in `workspaceStateStore.ts` | `8da6e84` |
| Canvas browser panel scroll resets on focus switch | `useVisibleNodeIds` → `primitiveSetEqual` in `canvasStore.ts` | `(scroll-fix)` |
| Workspace group definitions (name/color) lost on every restart | Pass `workspaceGroups` to `deriveSidebarSession` in `sessionSave.ts` | `(groups-save)` |
| `claude --resume` stops working after restart | Restore 4 missing pieces in sessionSave/Serialize/Restore split by upstream | `(claude-resume)` |
| `claude --resume` → "No conversation found" despite session file existing | `claude --resume` is project-scoped; capture project path from `history.jsonl` and `cd` to it before resuming (Feature 19) | `(claude-resume-project)` |

---

## userData & Session Data Notes

### Dev build vs packaged app
Dev build (`./node_modules/.bin/electron .`) uses **separate** userData path:
- Dev: `~/Library/Application Support/Cate/Dev/`
- Packaged DMG: `~/Library/Application Support/Cate/`

Workspaces/groups appear empty in dev build — this is **intentional** (set in `src/main/index.ts` line ~552).

### Manual data recovery
If `sidebar.json` or `recent-projects.json` gets corrupted/cleared by running an old build:

**`~/Library/Application Support/Cate/recent-projects.json`** format:
```json
{ "projects": ["/path/to/project1", "/path/to/project2", ...] }
```

**`~/Library/Application Support/Cate/sidebar.json`** format:
```json
{
  "session": {
    "order": ["/path/to/project1", ...],
    "selected": "/path/to/selected",
    "groups": [
      { "id": "uuid", "name": "GroupName", "color": "cyan", "collapsed": false }
    ],
    "workspaceGroupMap": {
      "/path/to/project": "group-uuid"
    }
  }
}
```
Available colors: `cyan`, `purple`, `red`, `blue`, `green`, `yellow`, `orange`, `pink`

**Important:** Always install + run the **new DMG** first. Never run an old DMG after upgrading — it will overwrite sidebar.json with empty groups on quit.

---

## Upstream Remote Setup

```bash
git remote add upstream https://github.com/0-AI-UG/cate
git fetch upstream
git merge upstream/main   # prefer merge over rebase (minimizes conflicts)
```
