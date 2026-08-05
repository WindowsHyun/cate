import { describe, it, expect } from 'vitest'
import type { SessionSnapshot, SidebarSession, WorkspaceGroup } from '../../../shared/types'
import { deriveSidebarSession, applySidebarSession, dedupeSnapshotsByRoot } from './sidebarSession'

// Minimal snapshot — only rootPath matters to the ordering logic.
function snap(rootPath: string | null): SessionSnapshot {
  return {
    workspaceName: rootPath ?? 'untitled',
    rootPath,
    viewportOffset: { x: 0, y: 0 },
    zoomLevel: 1,
    nodes: [],
  } as SessionSnapshot
}

const ws = (id: string, rootPath: string) => ({ id, rootPath })

describe('deriveSidebarSession', () => {
  it('builds order from workspaces with a rootPath, preserving array order', () => {
    const res = deriveSidebarSession([ws('a', '/p/a'), ws('b', '/p/b')], 'a')
    expect(res.order).toEqual(['/p/a', '/p/b'])
  })

  it('excludes workspaces with an empty rootPath (ephemeral rows)', () => {
    const res = deriveSidebarSession([ws('a', '/p/a'), ws('b', ''), ws('c', '/p/c')], 'a')
    expect(res.order).toEqual(['/p/a', '/p/c'])
  })

  it('does not persist duplicate roots from legacy runtime state', () => {
    const res = deriveSidebarSession([ws('a', '/p/a'), ws('dup', '/p/a'), ws('b', '/p/b')], 'a')
    expect(res.order).toEqual(['/p/a', '/p/b'])
  })

  it('sets selected to the root path of the selected workspace', () => {
    const res = deriveSidebarSession([ws('a', '/p/a'), ws('b', '/p/b')], 'b')
    expect(res.selected).toBe('/p/b')
  })

  it('selected is empty when the selected id is not found', () => {
    const res = deriveSidebarSession([ws('a', '/p/a')], 'zzz')
    expect(res.selected).toBe('')
  })

  it('selected is empty when the selected workspace has no rootPath', () => {
    const res = deriveSidebarSession([ws('a', '')], 'a')
    expect(res.selected).toBe('')
  })

  it('includes groups when provided', () => {
    const groups: WorkspaceGroup[] = [{ id: 'g1', name: 'Dev', color: 'blue', collapsed: false }]
    const res = deriveSidebarSession([ws('a', '/p/a')], 'a', groups)
    expect(res.groups).toEqual(groups)
  })

  it('omits groups field when groups is empty', () => {
    const res = deriveSidebarSession([ws('a', '/p/a')], 'a', [])
    expect(res.groups).toBeUndefined()
  })

  it('builds workspaceGroupMap from workspace groupIds', () => {
    const workspaces = [
      { id: 'a', rootPath: '/p/a', groupId: 'g1' },
      { id: 'b', rootPath: '/p/b', groupId: 'g2' },
      { id: 'c', rootPath: '/p/c' },
    ]
    const res = deriveSidebarSession(workspaces, 'a')
    expect(res.workspaceGroupMap).toEqual({ '/p/a': 'g1', '/p/b': 'g2' })
  })

  it('omits workspaceGroupMap when no workspace has a groupId', () => {
    const res = deriveSidebarSession([ws('a', '/p/a'), ws('b', '/p/b')], 'a')
    expect(res.workspaceGroupMap).toBeUndefined()
  })
})

describe('dedupeSnapshotsByRoot', () => {
  it('keeps the first snapshot for each root and preserves rootless snapshots', () => {
    const first = snap('/p/a')
    const duplicate = { ...snap('/p/a'), workspaceName: 'duplicate' }
    const rootlessA = snap(null)
    const rootlessB = snap(null)

    expect(dedupeSnapshotsByRoot([first, rootlessA, duplicate, rootlessB, snap('/p/b')])).toEqual([
      first,
      rootlessA,
      rootlessB,
      snap('/p/b'),
    ])
  })
})

describe('applySidebarSession', () => {
  it('returns snapshots unchanged with index 0 when session is null', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, null)
    expect(res.workspaces).toEqual(snaps)
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  it('returns snapshots unchanged with index 0 when order is empty', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: [], selected: '/p/b' })
    expect(res.workspaces).toEqual(snaps)
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  it('reorders snapshots to match the persisted order', () => {
    const snaps = [snap('/p/a'), snap('/p/b'), snap('/p/c')]
    const res = applySidebarSession(snaps, { order: ['/p/c', '/p/a', '/p/b'], selected: '' })
    expect(res.workspaces.map((s) => s.rootPath)).toEqual(['/p/c', '/p/a', '/p/b'])
  })

  it('appends snapshots whose root path is not in order, in original order', () => {
    const snaps = [snap('/p/a'), snap('/p/new'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: ['/p/b', '/p/a'], selected: '' })
    expect(res.workspaces.map((s) => s.rootPath)).toEqual(['/p/b', '/p/a', '/p/new'])
  })

  it('treats a null-rootPath snapshot as unknown and appends it', () => {
    const snaps = [snap('/p/a'), snap(null), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: ['/p/b', '/p/a'], selected: '' })
    expect(res.workspaces.map((s) => s.rootPath)).toEqual(['/p/b', '/p/a', null])
  })

  it('resolves selectedWorkspaceIndex against the reordered list', () => {
    const snaps = [snap('/p/a'), snap('/p/b'), snap('/p/c')]
    const res = applySidebarSession(snaps, { order: ['/p/c', '/p/a', '/p/b'], selected: '/p/a' })
    expect(res.selectedWorkspaceIndex).toBe(1)
  })

  it('falls back to index 0 when selected is empty', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: ['/p/b', '/p/a'], selected: '' })
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  it('falls back to index 0 when selected no longer matches any snapshot', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: ['/p/b', '/p/a'], selected: '/p/gone' })
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  it('dedupes duplicate order entries by first occurrence', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: ['/p/b', '/p/b', '/p/a'], selected: '' })
    expect(res.workspaces.map((s) => s.rootPath)).toEqual(['/p/b', '/p/a'])
  })

  // Defensive: the value comes from electron-store (untyped JSON) and could be
  // partial/corrupted. A bad shape must fall back to defaults, never throw —
  // a throw here would abort the whole session restore.
  it('falls back to defaults when order is missing', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { selected: '/p/a' } as unknown as SidebarSession)
    expect(res.workspaces).toEqual(snaps)
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  it('falls back to defaults when order is null', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: null, selected: '' } as unknown as SidebarSession)
    expect(res.workspaces).toEqual(snaps)
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  it('ignores a non-string selected without throwing', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const res = applySidebarSession(snaps, { order: ['/p/b', '/p/a'], selected: 123 } as unknown as SidebarSession)
    expect(res.workspaces.map((s) => s.rootPath)).toEqual(['/p/b', '/p/a'])
    expect(res.selectedWorkspaceIndex).toBe(0)
  })

  // Groups and workspaceGroupMap — these cover the e6142e6 / 191fa84 fixes where
  // group assignments silently vanished on restart because (a) sidebarStore.normalize
  // dropped the fields and (b) applySidebarSession never returned them.
  it('returns groups from the sidebar session', () => {
    const groups: WorkspaceGroup[] = [{ id: 'g1', name: 'Dev', color: 'blue', collapsed: false }]
    const snaps = [snap('/p/a')]
    const res = applySidebarSession(snaps, { order: ['/p/a'], selected: '/p/a', groups })
    expect(res.groups).toEqual(groups)
  })

  it('returns workspaceGroupMap from the sidebar session', () => {
    const snaps = [snap('/p/a'), snap('/p/b')]
    const workspaceGroupMap = { '/p/a': 'g1', '/p/b': 'g2' }
    const res = applySidebarSession(snaps, { order: ['/p/a', '/p/b'], selected: '', workspaceGroupMap })
    expect(res.workspaceGroupMap).toEqual(workspaceGroupMap)
  })

  it('filters out malformed group entries', () => {
    const groups = [
      { id: 'g1', name: 'Good', color: 'red', collapsed: false },
      { id: 42 } as unknown as WorkspaceGroup,
      null as unknown as WorkspaceGroup,
      { name: 'no-id' } as unknown as WorkspaceGroup,
    ]
    const snaps = [snap('/p/a')]
    const res = applySidebarSession(snaps, { order: ['/p/a'], selected: '', groups })
    expect(res.groups).toEqual([{ id: 'g1', name: 'Good', color: 'red', collapsed: false }])
  })

  it('returns empty groups and map when sidebar session has none', () => {
    const snaps = [snap('/p/a')]
    const res = applySidebarSession(snaps, { order: ['/p/a'], selected: '' })
    expect(res.groups).toEqual([])
    expect(res.workspaceGroupMap).toEqual({})
  })

  it('returns empty workspaceGroupMap when the field is an array (malformed)', () => {
    const snaps = [snap('/p/a')]
    const res = applySidebarSession(snaps, {
      order: ['/p/a'], selected: '',
      workspaceGroupMap: [] as unknown as Record<string, string>,
    })
    expect(res.workspaceGroupMap).toEqual({})
  })
})
