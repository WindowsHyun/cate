// SQLite viewer IPC handlers
// Uses better-sqlite3 (synchronous) — all operations run in main process.
// Only SELECT queries are allowed to prevent accidental data modification.

import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { SQLITE_OPEN, SQLITE_EXEC } from '../shared/ipc-channels'

export function registerSqliteHandlers(): void {
  ipcMain.handle(SQLITE_OPEN, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) return { error: 'Invalid file path' }
    try {
      const db = new Database(filePath, { readonly: true, fileMustExist: true })
      const tableRows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
      const tables = tableRows.map(({ name }) => {
        const colRows = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as {
          name: string; type: string
        }[]
        let rowCount = 0
        try {
          const cnt = db.prepare(`SELECT COUNT(*) as c FROM "${name.replace(/"/g, '""')}"`).get() as { c: number }
          rowCount = cnt.c
        } catch { /* ignore */ }
        return { name, rowCount, columns: colRows.map((c) => ({ name: c.name, type: c.type })) }
      })
      db.close()
      return { tables }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(SQLITE_EXEC, (_event, filePath: unknown, sql: unknown) => {
    if (typeof filePath !== 'string' || !filePath) return { error: 'Invalid file path' }
    if (typeof sql !== 'string' || !sql.trim()) return { error: 'Empty query' }
    // Allow only SELECT statements for safety
    const trimmed = sql.trim().toUpperCase()
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA') && !trimmed.startsWith('EXPLAIN') && !trimmed.startsWith('WITH')) {
      return { error: 'Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed' }
    }
    try {
      const db = new Database(filePath, { readonly: true, fileMustExist: true })
      const stmt = db.prepare(sql)
      const rawRows = stmt.all() as Record<string, unknown>[]
      db.close()
      if (rawRows.length === 0) return { columns: [], rows: [] }
      const columns = Object.keys(rawRows[0])
      const rows = rawRows.map((r) => columns.map((c) => r[c]))
      return { columns, rows }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
