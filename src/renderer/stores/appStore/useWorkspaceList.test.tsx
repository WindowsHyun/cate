// @vitest-environment jsdom
// =============================================================================
// Regression: moveWorkspaceToGroup() correctly updated workspace.groupId in
// the store, but useWorkspaceList()'s custom equality function didn't compare
// groupId — so React saw "nothing changed" and never re-rendered anything
// reading from this hook (the sidebar's grouped view). Clicking "Move to
// Group" silently produced zero visible change.
// =============================================================================

import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}))
vi.mock('../../lib/terminal/terminalRegistry', () => ({
  terminalRegistry: {
    setPendingRestore: vi.fn(),
    dispose: vi.fn(),
    disposeWorkspace: vi.fn(),
    getEntry: vi.fn(),
    has: vi.fn(() => false),
  },
}))

beforeEach(() => {
  const g = globalThis as unknown as { window?: { electronAPI?: unknown } }
  g.window = g.window ?? {}
  g.window.electronAPI = {
    workspaceCreate: vi.fn(async (input: { id?: string; name?: string; rootPath?: string }) => ({
      ok: true,
      workspace: { id: input.id ?? 'gen', name: input.name ?? 'Workspace', color: '', rootPath: input.rootPath ?? '' },
    })),
    workspaceUpdate: vi.fn(async () => ({ ok: true, workspace: {} })),
    workspaceRemove: vi.fn(async () => ({ ok: true })),
    recentProjectsAdd: vi.fn(),
    recentProjectsRemove: vi.fn(async () => undefined),
    sidebarSessionSet: vi.fn(async () => undefined),
  }
})

import { useAppStore, useWorkspaceList } from '../appStore'

function Probe({ onRender }: { onRender: (groupId: string | undefined) => void }) {
  const workspaces = useWorkspaceList()
  onRender(workspaces[0]?.groupId)
  return null
}

describe('useWorkspaceList reacts to groupId changes', () => {
  it('re-renders with the new groupId after moveWorkspaceToGroup', async () => {
    const wsId = useAppStore.getState().addWorkspace('W', '/repo', 'ws-1')
    const groupId = useAppStore.getState().addWorkspaceGroup('G')

    let host: HTMLDivElement
    let root: Root
    const seen: (string | undefined)[] = []

    host = document.createElement('div')
    root = createRoot(host)
    act(() => {
      root.render(<Probe onRender={(g) => seen.push(g)} />)
    })

    act(() => {
      useAppStore.getState().moveWorkspaceToGroup(wsId, groupId)
    })

    expect(seen[seen.length - 1]).toBe(groupId)

    act(() => { root.unmount() })
  })
})
