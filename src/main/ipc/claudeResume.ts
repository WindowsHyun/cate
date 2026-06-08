import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { CLAUDE_FIND_RESUME_ID } from '../../shared/ipc-channels'
import log from '../logger'

function encodeClaudeProjectDir(cwdPath: string): string {
  return cwdPath.replace(/\//g, '-').replace(/\./g, '-')
}

async function findMostRecentSession(projectDir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(projectDir)
  } catch {
    return null
  }
  const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl') && !e.startsWith('.'))
  if (jsonlFiles.length === 0) return null

  const withStats = await Promise.all(
    jsonlFiles.map(async (f) => {
      try {
        const stat = await fs.stat(path.join(projectDir, f))
        return { name: f, mtime: stat.mtimeMs }
      } catch {
        return null
      }
    }),
  )
  const valid = withStats.filter(Boolean) as { name: string; mtime: number }[]
  if (valid.length === 0) return null
  valid.sort((a, b) => b.mtime - a.mtime)
  const sessionId = valid[0].name.replace(/\.jsonl$/, '')
  if (!/^[0-9a-f]{32,}$/i.test(sessionId.replace(/-/g, ''))) return null
  return sessionId
}

export function registerClaudeResumeHandlers(): void {
  ipcMain.handle(CLAUDE_FIND_RESUME_ID, async (_event, cwd: string): Promise<string | null> => {
    if (!cwd || typeof cwd !== 'string') return null
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
    try {
      // Walk from the given cwd upward, trying each ancestor as the project root.
      // Handles the case where the terminal CWD is a subdirectory of the actual
      // claude project root (e.g. user ran `cd src && claude`).
      let candidate: string | null = cwd
      while (candidate) {
        const encoded = encodeClaudeProjectDir(candidate)
        const projectDir = path.join(projectsRoot, encoded)
        const sessionId = await findMostRecentSession(projectDir)
        if (sessionId) {
          log.info('[claudeResume] found session %s for cwd %s (matched dir %s)', sessionId, cwd, candidate)
          return sessionId
        }
        const parent = path.dirname(candidate)
        if (parent === candidate) break // reached filesystem root
        candidate = parent
      }
      log.warn('[claudeResume] no session found for cwd %s', cwd)
      return null
    } catch (err) {
      log.warn('[claudeResume] scan failed for cwd %s: %s', cwd, err)
      return null
    }
  })
}
