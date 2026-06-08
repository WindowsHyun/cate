import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { CLAUDE_FIND_RESUME_ID } from '../../shared/ipc-channels'
import log from '../logger'

function encodeClaudeProjectDir(cwdPath: string): string {
  return cwdPath.replace(/\//g, '-').replace(/\./g, '-')
}

export function registerClaudeResumeHandlers(): void {
  ipcMain.handle(CLAUDE_FIND_RESUME_ID, async (_event, cwd: string): Promise<string | null> => {
    if (!cwd || typeof cwd !== 'string') return null
    try {
      const encoded = encodeClaudeProjectDir(cwd)
      const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded)
      let entries: string[]
      try {
        entries = await fs.readdir(projectDir)
      } catch {
        return null
      }
      const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl') && !e.startsWith('.'))
      if (jsonlFiles.length === 0) return null

      // Find most recently modified .jsonl
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
      // Basic UUID validation (claude session IDs are UUIDs)
      if (!/^[0-9a-f-]{32,}$/i.test(sessionId.replace(/-/g, ''))) return null
      log.info('[claudeResume] found session %s for cwd %s', sessionId, cwd)
      return sessionId
    } catch (err) {
      log.warn('[claudeResume] scan failed for cwd %s: %s', cwd, err)
      return null
    }
  })
}
