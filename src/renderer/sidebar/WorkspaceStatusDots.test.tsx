// =============================================================================
// WorkspaceStatusDots — at-a-glance agent-running/awaiting + git-dirty dots on
// a workspace row. Purely additive to ws.color; hidden entirely when quiet.
// =============================================================================
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { AgentPanelInfo } from '../hooks/useAgentPanelInfo'
import type { WorkspaceState } from '../../shared/types'

let gitStatusFiles: unknown[] = []
vi.mock('../stores/gitStatusStore', () => ({
  useGitStatusSnapshot: () => ({ statusFiles: gitStatusFiles }),
}))

const { WorkspaceStatusDots } = await import('./WorkspaceTab')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  gitStatusFiles = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

function ws(rootPath = '/repo'): WorkspaceState {
  return { id: 'w1', name: 'W', color: '', rootPath, panels: {} } as WorkspaceState
}

function agentInfo(state: AgentPanelInfo['state']): Record<string, AgentPanelInfo> {
  return { p1: { state, name: null, logo: null } }
}

function render(workspace: WorkspaceState, agentInfoByPanel: Record<string, AgentPanelInfo>) {
  act(() => {
    root.render(<WorkspaceStatusDots workspace={workspace} agentInfoByPanel={agentInfoByPanel} />)
  })
  return host
}

describe('WorkspaceStatusDots', () => {
  it('renders nothing when idle and clean', () => {
    const el = render(ws(), agentInfo('notRunning'))
    expect(el.children.length).toBe(0)
  })

  it('shows a pulsing dot when an agent is running', () => {
    const el = render(ws(), agentInfo('running'))
    expect(el.querySelector('.animate-pulse')).not.toBeNull()
    expect(el.querySelector('.cate-await-indicator')).toBeNull()
  })

  it('shows the static await dot when an agent is waiting for input', () => {
    const el = render(ws(), agentInfo('waitingForInput'))
    expect(el.querySelector('.cate-await-indicator')).not.toBeNull()
    expect(el.querySelector('.animate-pulse')).toBeNull()
  })

  it('running takes priority over waitingForInput when both are present', () => {
    const el = render(ws(), { a: { state: 'running', name: null, logo: null }, b: { state: 'waitingForInput', name: null, logo: null } })
    expect(el.querySelector('.animate-pulse')).not.toBeNull()
    expect(el.querySelector('.cate-await-indicator')).toBeNull()
  })

  it('shows the git-dirty dot when statusFiles is non-empty', () => {
    gitStatusFiles = [{ path: 'a.ts', status: 'M' }]
    const el = render(ws(), agentInfo('notRunning'))
    expect(el.querySelector('[title="Uncommitted changes"]')).not.toBeNull()
  })

  it('hides the git-dirty dot when the workspace has no rootPath', () => {
    gitStatusFiles = [{ path: 'a.ts', status: 'M' }]
    const el = render(ws(''), agentInfo('notRunning'))
    expect(el.children.length).toBe(0)
  })
})
