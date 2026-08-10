// @vitest-environment jsdom
// =============================================================================
// Regression: addWorkspace() used to silently no-op once 10 workspaces existed
// (returning the current selection with zero feedback) — "New Workspace" just
// stopped doing anything for anyone with more than 10 real projects. Session
// restore was never subject to this cap, so a normal user easily ends up with
// far more than 10 workspaces and then hits a dead button. There's no
// technical reason for the cap (restore already proves loading many
// workspaces works fine), so addWorkspace() must keep working past 10.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

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
  }
})

import { useAppStore } from '../appStore'

describe('addWorkspace beyond 10 existing workspaces', () => {
  it('still creates a new workspace and selects it', () => {
    for (let i = 0; i < 12; i++) {
      useAppStore.getState().addWorkspace(`WS-${i}`, undefined, `ws-${i}`)
    }
    expect(useAppStore.getState().workspaces).toHaveLength(12)

    const before = useAppStore.getState().selectedWorkspaceId
    const newId = useAppStore.getState().addWorkspace()
    expect(useAppStore.getState().workspaces).toHaveLength(13)
    expect(newId).not.toBe(before)
    expect(useAppStore.getState().workspaces.some((w) => w.id === newId)).toBe(true)
  })
})
