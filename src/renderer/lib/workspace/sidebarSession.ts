import type { SessionSnapshot, SidebarSession, WorkspaceGroup } from '../../../shared/types'

// Persisted sidebar arrangement, keyed by workspace root paths (IDs are runtime
// UUIDs, useless across restarts). `deriveSidebarSession` snapshots the current
// arrangement for saving; `applySidebarSession` re-applies it to the freshly
// loaded snapshots on restore. Both are pure so they can be unit-tested without
// the store or IPC.

/** Snapshot the current sidebar order + active workspace as root paths. */
export function deriveSidebarSession(
  workspaces: ReadonlyArray<{ id: string; rootPath: string; groupId?: string }>,
  selectedId: string,
  groups?: WorkspaceGroup[],
): SidebarSession {
  const order = workspaces.filter((w) => w.rootPath).map((w) => w.rootPath)
  const selected = workspaces.find((w) => w.id === selectedId)?.rootPath ?? ''
  const workspaceGroupMap: Record<string, string> = {}
  for (const w of workspaces) {
    if (w.rootPath && w.groupId) workspaceGroupMap[w.rootPath] = w.groupId
  }
  return {
    order,
    selected,
    groups: groups && groups.length > 0 ? groups : undefined,
    workspaceGroupMap: Object.keys(workspaceGroupMap).length > 0 ? workspaceGroupMap : undefined,
  }
}

/**
 * Reorder freshly loaded snapshots to match a persisted arrangement and pick the
 * active index. Snapshots whose root path isn't in `order` (newly opened, or
 * null-rooted) are appended in their original order. A null/empty session, or a
 * `selected` that matches nothing, falls back to the input order with index 0.
 */
export function applySidebarSession(
  snapshots: SessionSnapshot[],
  sidebarSession: SidebarSession | null | undefined,
): { workspaces: SessionSnapshot[]; selectedWorkspaceIndex: number; groups: WorkspaceGroup[]; workspaceGroupMap: Record<string, string> } {
  // Be defensive about the persisted shape: this value comes straight from
  // sidebar.json (untyped JSON) and may be partial or corrupted (crash mid
  // write, a hand-edit, a future schema change). A bad shape must fall back to
  // defaults — never throw, since this runs inside session restore and a throw
  // would abort the whole restore, including the default-workspace fallback.
  const rawOrder = sidebarSession?.order
  const order = Array.isArray(rawOrder) ? rawOrder : []

  const rawGroups = sidebarSession?.groups
  const groups = Array.isArray(rawGroups) ? rawGroups.filter(
    (g) => g && typeof g === 'object' && typeof g.id === 'string' && typeof g.name === 'string'
  ) as WorkspaceGroup[] : []

  const rawMap = sidebarSession?.workspaceGroupMap
  const workspaceGroupMap = rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)
    ? rawMap as Record<string, string>
    : {}

  if (order.length === 0) {
    return { workspaces: snapshots, selectedWorkspaceIndex: 0, groups, workspaceGroupMap }
  }
  const rawSelected = sidebarSession?.selected
  const selected = typeof rawSelected === 'string' ? rawSelected : ''

  // Rank each root path by its first occurrence in `order` (dedupes duplicates).
  const rank = new Map<string, number>()
  order.forEach((rootPath, i) => {
    if (typeof rootPath === 'string' && !rank.has(rootPath)) rank.set(rootPath, i)
  })

  const known: SessionSnapshot[] = []
  const unknown: SessionSnapshot[] = []
  for (const snap of snapshots) {
    if (snap.rootPath && rank.has(snap.rootPath)) known.push(snap)
    else unknown.push(snap)
  }
  // Array.prototype.sort is stable, so equal-rank snapshots keep their order.
  known.sort((a, b) => rank.get(a.rootPath as string)! - rank.get(b.rootPath as string)!)

  const workspaces = [...known, ...unknown]

  let selectedWorkspaceIndex = 0
  if (selected) {
    const idx = workspaces.findIndex((s) => s.rootPath === selected)
    if (idx >= 0) selectedWorkspaceIndex = idx
  }

  return { workspaces, selectedWorkspaceIndex, groups, workspaceGroupMap }
}
