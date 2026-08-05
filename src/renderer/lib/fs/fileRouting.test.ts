// @vitest-environment jsdom
// Opening the same file twice must reuse the existing panel/tab, not spawn a
// duplicate. revealOnce's own dock/canvas mechanics are covered by
// panelReveal.test.ts — here we only verify the dedup decision.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from '../../stores/appStore'

const revealed: string[] = []
vi.mock('../workspace/panelReveal', () => ({
  revealOnce: (_workspaceId: string, panelId: string) => {
    revealed.push(panelId)
    return true
  },
}))

const { openFileGrouped, openFileAsPanel, openFileAsTextGrouped, openFileAsText } = await import('./fileRouting')

beforeEach(() => {
  revealed.length = 0
  useAppStore.setState({
    workspaces: [{ id: 'ws-1', name: 'WS', color: '', rootPath: '/repo', panels: {} }],
    selectedWorkspaceId: 'ws-1',
  } as never)
})

describe('duplicate-file dedup', () => {
  it('openFileGrouped reuses the existing editor panel for the same file', () => {
    const first = openFileGrouped('ws-1', '/repo/a.ts')
    const second = openFileGrouped('ws-1', '/repo/a.ts')
    expect(second).toBe(first)
    expect(revealed).toEqual([first])
    const panels = useAppStore.getState().workspaces[0].panels
    expect(Object.values(panels).filter((p) => p.filePath === '/repo/a.ts')).toHaveLength(1)
  })

  it('openFileGrouped still creates a new node for a different file', () => {
    const first = openFileGrouped('ws-1', '/repo/a.ts')
    const second = openFileGrouped('ws-1', '/repo/b.ts')
    expect(second).not.toBe(first)
    expect(revealed).toEqual([])
  })

  it('openFileAsPanel reuses an existing document panel for the same PDF', () => {
    const first = openFileAsPanel('ws-1', '/repo/doc.pdf')
    const second = openFileAsPanel('ws-1', '/repo/doc.pdf')
    expect(second).toBe(first)
    expect(revealed).toEqual([first])
  })

  it('openFileAsTextGrouped reuses the existing editor panel for the same file', () => {
    const first = openFileAsTextGrouped('ws-1', '/repo/a.ts')
    const second = openFileAsTextGrouped('ws-1', '/repo/a.ts')
    expect(second).toBe(first)
    expect(revealed).toEqual([first])
  })

  it('openFileGrouped reuses the existing browser panel for the same HTML file', () => {
    const first = openFileGrouped('ws-1', '/repo/index.html')
    const second = openFileGrouped('ws-1', '/repo/index.html')
    expect(second).toBe(first)
    expect(revealed).toEqual([first])
    const panels = useAppStore.getState().workspaces[0].panels
    expect(Object.values(panels).filter((p) => p.type === 'browser')).toHaveLength(1)
  })

  it('openFileAsText opens an HTML file as an editor, not a browser', () => {
    const id = openFileAsText('ws-1', '/repo/index.html')
    const panel = useAppStore.getState().workspaces[0].panels[id]
    expect(panel.type).toBe('editor')
  })
})
