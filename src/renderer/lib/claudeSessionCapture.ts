// =============================================================================
// Claude session capture — finds --resume UUIDs from the filesystem
// (Claude stores sessions at ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl)
// instead of sending Ctrl+C and watching PTY output.
// =============================================================================

import log from './logger'
import { terminalRegistry } from './terminal/terminalRegistry'

// Shared storage: populated by captureClaudeSessions(), read by sessionSave.
// project path is stored alongside so replayTerminalLog can cd before resuming.
export const capturedResumeIds: Record<string, string> = {}
export const capturedResumeProjects: Record<string, string> = {}

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
  const resultIds: Record<string, string> = {}
  const resultProjects: Record<string, string> = {}

  await Promise.all(
    ptyIds.map(async (ptyId) => {
      const panelId = terminalRegistry.panelIdForPty(ptyId)
      if (!panelId) return

      const cwd = await window.electronAPI.terminalGetCwd(ptyId).catch(() => null)
      if (!cwd) return

      const found = await window.electronAPI.claudeFindResumeId(cwd).catch(() => null)
      if (found) {
        resultIds[panelId] = found.sessionId
        resultProjects[panelId] = found.project
        log.info(`[claudeCapture] panel ${panelId}: found resume ${found.sessionId} (project: ${found.project})`)
      }
    }),
  )

  Object.assign(capturedResumeIds, resultIds)
  Object.assign(capturedResumeProjects, resultProjects)
  window.electronAPI.claudeCaptureDone(resultIds)
}
