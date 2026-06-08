import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { CLAUDE_FIND_RESUME_ID } from '../../shared/ipc-channels'
import log from '../logger'

interface HistoryEntry {
  project?: string
  sessionId?: string
  timestamp?: number
}

/** Read ~/.claude/history.jsonl and find the most recent sessionId for a CWD. */
async function findResumeIdFromHistory(cwd: string): Promise<string | null> {
  const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl')
  let content: string
  try {
    content = await fs.readFile(historyPath, 'utf-8')
  } catch {
    return null
  }

  let best: { timestamp: number; sessionId: string } | null = null

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let entry: HistoryEntry
    try {
      entry = JSON.parse(line) as HistoryEntry
    } catch {
      continue
    }
    const { project, sessionId, timestamp } = entry
    if (!project || !sessionId || typeof timestamp !== 'number') continue

    // Match when the terminal CWD is at or below the recorded project path,
    // or when the project path is at or below the terminal CWD.
    const match =
      cwd === project ||
      cwd.startsWith(project + '/') ||
      project.startsWith(cwd + '/')

    if (match && (!best || timestamp > best.timestamp)) {
      best = { timestamp, sessionId }
    }
  }

  return best?.sessionId ?? null
}

export function registerClaudeResumeHandlers(): void {
  ipcMain.handle(CLAUDE_FIND_RESUME_ID, async (_event, cwd: string): Promise<string | null> => {
    if (!cwd || typeof cwd !== 'string') return null
    try {
      const sessionId = await findResumeIdFromHistory(cwd)
      if (sessionId) {
        log.info('[claudeResume] found session %s for cwd %s (via history.jsonl)', sessionId, cwd)
        return sessionId
      }
      log.warn('[claudeResume] no session found for cwd %s', cwd)
      return null
    } catch (err) {
      log.warn('[claudeResume] scan failed for cwd %s: %s', cwd, err)
      return null
    }
  })
}
