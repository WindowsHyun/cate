// @vitest-environment jsdom
// Regression: the recursive <FileTreeNode> render for a folder's children must
// forward onFileOpenAsText/onFileOpenNew, or right-clicking any NON-root-level
// file silently falls back to the plain onFileOpen (e.g. "Open as Text" on a
// nested .html file opened it as a browser instead of an editor).
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { FileTreeNode as FileTreeNodeType } from '../../shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { FileTreeNode } = await import('./FileTreeNode')

function fileNode(path: string, name: string): FileTreeNodeType {
  return { name, path, isDirectory: false, isExpanded: false, children: [], fileExtension: name.split('.').pop() ?? '' }
}
function dirNode(path: string, name: string, children: FileTreeNodeType[]): FileTreeNodeType {
  return { name, path, isDirectory: true, isExpanded: true, children, fileExtension: '' }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    showContextMenu: vi.fn(async () => 'open-as-text'),
  }
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

describe('FileTreeNode recursion forwards open-as-text/open-new callbacks', () => {
  it('fires onFileOpenAsText for a file nested inside a folder (not just root-level files)', async () => {
    const childFile = fileNode('/repo/src/index.html', 'index.html')
    const folder = dirNode('/repo/src', 'src', [childFile])

    const onFileOpen = vi.fn()
    const onFileOpenAsText = vi.fn()
    const childrenCache = new Map([['/repo/src', [childFile]]])

    act(() => {
      root = createRoot(host)
      root.render(
        <FileTreeNode
          node={folder}
          depth={0}
          selectedPaths={new Set()}
          expandedPaths={new Set(['/repo/src'])}
          childrenCache={childrenCache}
          loadingPaths={new Set()}
          onSelect={() => {}}
          onFileOpen={onFileOpen}
          onFileOpenAsText={onFileOpenAsText}
          onToggleExpand={() => {}}
          onExpand={() => {}}
          rootPath="/repo"
        />,
      )
    })

    const row = host.querySelector('[data-filepath="/repo/src/index.html"]')
    expect(row).toBeTruthy()

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onFileOpenAsText).toHaveBeenCalledWith(['/repo/src/index.html'])
    expect(onFileOpen).not.toHaveBeenCalled()
  })
})
