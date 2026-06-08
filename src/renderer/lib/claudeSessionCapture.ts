// =============================================================================
// Claude session capture — finds --resume UUIDs from the filesystem
// (Claude stores sessions at ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl)
// instead of sending Ctrl+C and watching PTY output.
// =============================================================================

import log from './logger'
import { terminalRegistry } from './terminal/terminalRegistry'

// Shared storage: populated by captureClaudeSessions(), read by buildSnapshot()
// in session.ts before it serializes the snapshot.
export const capturedResumeIds: Record<string, string> = {}

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

  log.info(`[claudeCapture] scanning filesystem for ${ptyIds.length} terminal(s)`)
  const result: Record<string, string> = {}

  await Promise.all(
    ptyIds.map(async (ptyId) => {
      const panelId = terminalRegistry.panelIdForPty(ptyId)
      if (!panelId) return

      const cwd = await window.electronAPI.terminalGetCwd(ptyId).catch(() => null)
      if (!cwd) return

      const sessionId = await window.electronAPI.claudeFindResumeId(cwd).catch(() => null)
      if (sessionId) {
        result[panelId] = sessionId
        log.info(`[claudeCapture] panel ${panelId}: found resume ${sessionId} (cwd: ${cwd})`)
      }
    }),
  )

  Object.assign(capturedResumeIds, result)
  window.electronAPI.claudeCaptureDone(result)
}
