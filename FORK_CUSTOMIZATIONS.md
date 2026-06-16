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
- [ ] Check `src/renderer/stores/canvasStore.ts` — `useVisibleNodeIds` uses `primitiveSetEqual` (NOT `primitiveArrayEqual`); upstream may restore order-sensitive equality which causes webview reload on focus switch
- [ ] Check `src/renderer/lib/workspace/sessionSave.ts` — `deriveSidebarSession` call passes `updatedState.workspaceGroups` as 3rd arg; upstream omits it, silently dropping group name/color on every autosave

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
