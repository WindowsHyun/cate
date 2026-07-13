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

/** Read ~/.claude/history.jsonl and find the most recent sessionId + project path for a CWD. */
async function findResumeIdFromHistory(cwd: string): Promise<{ sessionId: string; project: string } | null> {
  const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl')
  let content: string
  try {
    content = await fs.readFile(historyPath, 'utf-8')
  } catch {
    return null
  }

  let best: { timestamp: number; sessionId: string; project: string; score: number } | null = null

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

    // Score by specificity: exact match > terminal is inside project > project inside cwd.
    // Prefer the LONGEST (most specific) matching project path so a home-dir session
    // doesn't shadow a workspace-specific session for every path under ~.
    let score: number
    if (cwd === project) {
      score = 3
    } else if (cwd.startsWith(project + '/')) {
      // terminal is inside the project — score by how specific (longer = better)
      score = 2 + project.length / 10000
    } else if (project.startsWith(cwd + '/')) {
      score = 1 + project.length / 10000
    } else {
      continue
    }

    if (!best || score > best.score || (score === best.score && timestamp > best.timestamp)) {
      best = { timestamp, sessionId, project, score }
    }
  }

  return best ? { sessionId: best.sessionId, project: best.project } : null
}

export function registerClaudeResumeHandlers(): void {
  ipcMain.handle(CLAUDE_FIND_RESUME_ID, async (_event, cwd: string): Promise<{ sessionId: string; project: string } | null> => {
    if (!cwd || typeof cwd !== 'string') return null
    try {
      const result = await findResumeIdFromHistory(cwd)
      if (result) {
        log.info('[claudeResume] found session %s for cwd %s (project: %s)', result.sessionId, cwd, result.project)
        return result
      }
      log.warn('[claudeResume] no session found for cwd %s', cwd)
      return null
    } catch (err) {
      log.warn('[claudeResume] scan failed for cwd %s: %s', cwd, err)
      return null
    }
  })
}
