// =============================================================================
// Claude session capture — captures --resume UUIDs from running claude sessions
// before the app quits, so they can be replayed on next launch.
//
// Flow: main sends CLAUDE_CAPTURE_START with ptyIds of claude-running terminals
// → we send Ctrl+C to each, watch for "claude --resume <uuid>" in the output,
// collect the panelId→uuid map, then send CLAUDE_CAPTURE_DONE back to main.
// Main then proceeds with the normal session flush.
// =============================================================================

import log from './logger'
import { terminalRegistry } from './terminal/terminalRegistry'

// Shared storage: populated by captureClaudeSessions(), read by buildSnapshot()
// in session.ts before it serializes the snapshot.
export const capturedResumeIds: Record<string, string> = {}

const CLAUDE_RESUME_RE = /claude --resume ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const CAPTURE_TIMEOUT_MS = 3500

export function initClaudeSessionCapture(): void {
  if (typeof window === 'undefined' || !window.electronAPI) return

  window.electronAPI.onClaudeCaptureStart((ptyIds: string[]) => {
    void captureClaudeSessions(ptyIds)
  })
}

async function captureClaudeSessions(ptyIds: string[]): Promise<void> {
  if (ptyIds.length === 0) {
    window.electronAPI.claudeCaptureDone({})
    return
  }

  // Map ptyId -> panelId up front so we can key results by panelId
  const ptyToPanelId = new Map<string, string>()
  for (const ptyId of ptyIds) {
    const panelId = terminalRegistry.panelIdForPty(ptyId)
    if (panelId) ptyToPanelId.set(ptyId, panelId)
  }

  const remaining = new Set(ptyIds)
  const result: Record<string, string> = {}

  return new Promise<void>((resolve) => {
    const finish = () => {
      unsub()
      clearTimeout(timer)
      // Persist for session.ts to read during buildSnapshot
      Object.assign(capturedResumeIds, result)
      window.electronAPI.claudeCaptureDone(result)
      resolve()
    }

    const unsub = window.electronAPI.onTerminalData((terminalId: string, data: string) => {
      if (!remaining.has(terminalId)) return
      const match = CLAUDE_RESUME_RE.exec(data)
      if (match) {
        const uuid = match[1]
        const panelId = ptyToPanelId.get(terminalId)
        if (panelId) {
          result[panelId] = uuid
          log.info(`[claudeCapture] captured resume UUID for panel ${panelId}: ${uuid}`)
        }
        remaining.delete(terminalId)
        if (remaining.size === 0) finish()
      }
    })

    // Send Ctrl+C twice to each claude-running terminal (first may just cancel
    // the current task; second exits claude and shows --resume UUID).
    log.info(`[claudeCapture] starting capture for ${ptyIds.length} terminal(s)`)
    for (const ptyId of ptyIds) {
      try {
        window.electronAPI.terminalWrite(ptyId, '\x03')
      } catch (err) {
        log.warn(`[claudeCapture] failed to write first Ctrl+C to pty ${ptyId}:`, err)
        remaining.delete(ptyId)
      }
    }
    // Second Ctrl+C after 300ms — exits claude even if it was mid-task
    setTimeout(() => {
      for (const ptyId of [...remaining]) {
        window.electronAPI.terminalWrite(ptyId, '\x03').catch(() => {})
      }
    }, 300)

    if (remaining.size === 0) {
      finish()
      return
    }

    // Timeout — send what we have so quit isn't blocked
    const timer = setTimeout(() => {
      log.warn(`[claudeCapture] timed out waiting for ${remaining.size} terminal(s)`)
      finish()
    }, CAPTURE_TIMEOUT_MS)
  })
}
