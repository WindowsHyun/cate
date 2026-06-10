// Verifies that browser panels stay mounted (same DOM node) when switching tabs
// in a DockTabStack so the webview doesn't reload.
//
// Core assertion: the wrapper div for a browser panel must be the SAME DOM element
// before and after a tab switch — React must update its props, not unmount+remount.

import React, { useRef, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { DockTabStack as DockTabStackType, PanelState } from '../../shared/types'

// ---------------------------------------------------------------------------
// Module mocks — keep each as a minimal stub to avoid import side-effects
// ---------------------------------------------------------------------------

vi.mock('../stores/DockStoreContext', () => ({
  useDockStoreApi: () => ({}),
}))

vi.mock('../drag', () => ({
  registerDropZone: () => () => {},
  useDragStore: (sel: (s: unknown) => unknown) => sel({ isDragging: false, target: null, source: null }),
}))

const BROWSER_PANEL: PanelState = { id: 'bp1', type: 'browser', title: 'Browser' } as PanelState
const TERMINAL_PANEL: PanelState = { id: 'tp1', type: 'terminal', title: 'Terminal' } as PanelState

vi.mock('../stores/appStore', () => {
  const state = {
    selectedWorkspaceId: 'ws1',
    workspaces: [{ id: 'ws1', panels: { bp1: BROWSER_PANEL, tp1: TERMINAL_PANEL } }],
  }
  const useAppStore = (sel: (s: typeof state) => unknown) => sel(state)
  useAppStore.getState = () => state
  return { useAppStore }
})

vi.mock('./DockTabBar', () => ({
  DockTabBar: () => <div data-testid="tab-bar" />,
}))

vi.mock('./DockTabContextMenu', () => ({
  DockTabContextMenu: () => null,
  SPLIT_MENU_ITEMS: [],
}))

vi.mock('./useDockTabActions', () => ({
  useDockTabActions: () => ({
    setActiveTab: vi.fn(),
    handleTabClose: vi.fn(),
    beginRename: vi.fn(),
    commitRename: vi.fn(),
    addTabOfType: vi.fn(),
    splitWithType: vi.fn(),
    handleTabBarContextMenu: vi.fn(),
    renamingPanelId: null,
    renameValue: '',
    setRenameValue: vi.fn(),
  }),
  useAcceptsPanelType: () => () => true,
}))

vi.mock('../lib/activePanel', () => ({ setActivePanel: vi.fn() }))

vi.mock('./useDockTabDrag', () => ({
  useDockTabDrag: () => ({ handleTabMouseDown: vi.fn() }),
}))

vi.mock('../../shared/panels', () => ({
  PANEL_DEFINITIONS: {
    browser: { label: 'Browser', defaultSize: { width: 600, height: 400 } },
    terminal: { label: 'Terminal', defaultSize: { width: 600, height: 400 } },
    editor: { label: 'Editor', defaultSize: { width: 600, height: 400 } },
    canvas: { label: 'Canvas', defaultSize: { width: 600, height: 400 } },
    agent: { label: 'Agent', defaultSize: { width: 600, height: 400 } },
    document: { label: 'Document', defaultSize: { width: 600, height: 400 } },
  },
}))

// ---------------------------------------------------------------------------
// Import subject AFTER mocks are set up
// ---------------------------------------------------------------------------

const { default: DockTabStack } = await import('./DockTabStack')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStack(panelIds: string[], activeIndex: number): DockTabStackType {
  return { type: 'tabs', id: 'stack1', panelIds, activeIndex }
}

// Tracks the DOM element of the wrapper div for each panel. A BrowserPanel's
// wrapper div is the `key=panelId` div rendered by the keep-alive map.
const domRefs: Record<string, Element | null> = {}

function TestWrapper({ panel }: { panel: 'browser' | 'terminal' }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    domRefs[panel] = el.current
  })
  return <div ref={el} data-panel={panel} style={{ height: '100%' }} />
}

function renderPanel(panelId: string) {
  if (panelId === 'bp1') return <TestWrapper panel="browser" />
  if (panelId === 'tp1') return <TestWrapper panel="terminal" />
  return null
}

function getPanelTitle(panelId: string) {
  return panelId === 'bp1' ? 'Browser' : 'Terminal'
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  domRefs.browser = undefined as unknown as null
  domRefs.terminal = undefined as unknown as null
})

describe('DockTabStack browser keep-alive', () => {
  it('browser panel DOM element survives switching to terminal tab and back', async () => {
    const panels = ['bp1', 'tp1']

    // --- Step 1: browser is active ---
    act(() => {
      root.render(
        <DockTabStack
          stack={makeStack(panels, 0)}
          zone="center"
          renderPanel={renderPanel}
          getPanelTitle={getPanelTitle}
        />,
      )
    })

    const browserDomAfterMount = domRefs.browser
    expect(browserDomAfterMount).not.toBeNull()

    // --- Step 2: switch to terminal ---
    act(() => {
      root.render(
        <DockTabStack
          stack={makeStack(panels, 1)}
          zone="center"
          renderPanel={renderPanel}
          getPanelTitle={getPanelTitle}
        />,
      )
    })

    // Browser wrapper must be the SAME DOM element (not remounted)
    expect(domRefs.browser).toBe(browserDomAfterMount)

    // Browser wrapper must be hidden
    const browserWrapper = host.querySelector('[data-panel="browser"]')?.parentElement
    expect(browserWrapper?.style.visibility).toBe('hidden')

    // Terminal must be visible
    const terminalWrapper = host.querySelector('[data-panel="terminal"]')?.parentElement
    expect(terminalWrapper?.style.visibility).toBe('visible')

    // --- Step 3: switch back to browser ---
    act(() => {
      root.render(
        <DockTabStack
          stack={makeStack(panels, 0)}
          zone="center"
          renderPanel={renderPanel}
          getPanelTitle={getPanelTitle}
        />,
      )
    })

    // Still the same DOM element — no remount
    expect(domRefs.browser).toBe(browserDomAfterMount)

    // Browser wrapper now visible again
    const browserWrapperFinal = host.querySelector('[data-panel="browser"]')?.parentElement
    expect(browserWrapperFinal?.style.visibility).toBe('visible')
  })

  it('terminal panel is unmounted when switching away (normal behaviour for non-browser)', async () => {
    const panels = ['bp1', 'tp1']

    // Start with terminal active
    act(() => {
      root.render(
        <DockTabStack
          stack={makeStack(panels, 1)}
          zone="center"
          renderPanel={renderPanel}
          getPanelTitle={getPanelTitle}
        />,
      )
    })

    expect(host.querySelector('[data-panel="terminal"]')).not.toBeNull()

    // Switch to browser
    act(() => {
      root.render(
        <DockTabStack
          stack={makeStack(panels, 0)}
          zone="center"
          renderPanel={renderPanel}
          getPanelTitle={getPanelTitle}
        />,
      )
    })

    // Terminal should be gone from DOM (not kept alive)
    expect(host.querySelector('[data-panel="terminal"]')).toBeNull()
  })
})
