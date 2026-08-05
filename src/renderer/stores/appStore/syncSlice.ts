// =============================================================================
// App Store — cross-window sync slice (merge metadata from main broadcast).
// setupWorkspaceSync lives in index.ts so it can close over the created store
// directly (avoids a syncSlice -> index import edge).
// =============================================================================

import type { AppSet, AppGet, AppStoreActions } from './types'
import { rememberedGroupIds } from './helpers'

type SyncSliceActions = Pick<AppStoreActions, 'mergeWorkspaceInfos'>

export function createSyncSlice(set: AppSet, _get: AppGet): SyncSliceActions {
  return {
    mergeWorkspaceInfos(infos) {
      set((state) => {
        const existingMap = new Map(state.workspaces.map((ws) => [ws.id, ws]))

        // Update metadata for existing workspaces, add new ones
        const updatedIds = new Set<string>()
        for (const info of infos) {
          updatedIds.add(info.id)
          const existing = existingMap.get(info.id)
          if (existing) {
            // Merge metadata only — don't touch panels/canvas state
            if (
              existing.name !== info.name ||
              existing.color !== info.color ||
              existing.rootPath !== info.rootPath ||
              (existing.connection && existing.connection.kind !== 'local' ? existing.connection.runtimeId : undefined) !==
                (info.connection && info.connection.kind !== 'local' ? info.connection.runtimeId : undefined)
            ) {
            existingMap.set(info.id, {
              ...existing,
              name: info.name,
              color: info.color,
              rootPath: info.rootPath,
              connection: info.connection ?? existing.connection,
              // groupId is renderer-owned (main sends none) — keep the existing
              // assignment, falling back to the remembered one by rootPath.
              groupId: existing.groupId || rememberedGroupIds.get(info.rootPath),
              rootPathError: null,
              isRootPathPending: false,
            })
            }
          } else {
            // New workspace from another window — create empty local state. Re-apply
            // any remembered group assignment for this rootPath so a partial main
            // broadcast that churned this row during restore doesn't drop its group.
            existingMap.set(info.id, {
              id: info.id,
              name: info.name,
              color: info.color,
              rootPath: info.rootPath,
              connection: info.connection,
              groupId: rememberedGroupIds.get(info.rootPath),
              rootPathError: null,
              isRootPathPending: false,
              panels: {},
            })
          }
        }

        // Remove workspaces that no longer exist in main (deleted from another window)
        // But keep the currently selected workspace to avoid breaking the UI
        const workspaces = Array.from(existingMap.values()).filter(
          (ws) => updatedIds.has(ws.id) || ws.id === state.selectedWorkspaceId,
        )

        return { workspaces }
      })
    },
  }
}
