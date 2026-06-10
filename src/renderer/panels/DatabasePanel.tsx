// =============================================================================
// DatabasePanel — SQLite database viewer.
// Shows tables in a sidebar, rows in a grid, and a SQL query editor at bottom.
// =============================================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import type { PanelProps } from './types'
import { useAppStore } from '../stores/appStore'

interface TableInfo {
  name: string
  rowCount: number
  columns: { name: string; type: string }[]
}

interface QueryResult {
  columns: string[]
  rows: unknown[][]
  error?: string
}

const PAGE_SIZE = 200

interface DatabasePanelProps extends PanelProps {
  filePath?: string
}

export default function DatabasePanel({ panelId, workspaceId, filePath }: DatabasePanelProps) {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableResult, setTableResult] = useState<QueryResult | null>(null)
  const [page, setPage] = useState(0)
  const [sql, setSql] = useState('')
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [queryRunning, setQueryRunning] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load table list when filePath changes
  useEffect(() => {
    if (!filePath || !window.electronAPI) return
    setTables([])
    setLoadError(null)
    setSelectedTable(null)
    setTableResult(null)
    setQueryResult(null)
    window.electronAPI.sqliteOpen(filePath).then((res) => {
      if ('error' in res) {
        setLoadError(res.error)
      } else {
        setTables(res.tables)
        if (res.tables.length > 0) setSelectedTable(res.tables[0].name)
      }
    })
  }, [filePath])

  // Load table data when selected table or page changes
  useEffect(() => {
    if (!filePath || !selectedTable || !window.electronAPI) return
    const offset = page * PAGE_SIZE
    const query = `SELECT * FROM "${selectedTable.replace(/"/g, '""')}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`
    window.electronAPI.sqliteExec(filePath, query).then((res) => {
      if ('error' in res) {
        setTableResult({ columns: [], rows: [], error: res.error })
      } else {
        setTableResult(res)
      }
    })
  }, [filePath, selectedTable, page])

  const handleTableSelect = useCallback((name: string) => {
    setSelectedTable(name)
    setPage(0)
    setTableResult(null)
  }, [])

  const handleRunQuery = useCallback(async () => {
    if (!filePath || !sql.trim() || !window.electronAPI) return
    setQueryRunning(true)
    setQueryResult(null)
    const res = await window.electronAPI.sqliteExec(filePath, sql)
    setQueryRunning(false)
    if ('error' in res) {
      setQueryResult({ columns: [], rows: [], error: res.error })
    } else {
      setQueryResult(res)
    }
  }, [filePath, sql])

  const handleOpenFile = useCallback(async () => {
    if (!window.electronAPI) return
    const picked = await window.electronAPI.openFileDialog({
      title: 'Open SQLite Database',
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All Files', extensions: ['*'] }],
    })
    if (!picked) return
    const fileName = picked.split('/').pop() ?? picked
    useAppStore.getState().updatePanelFilePath(workspaceId, panelId, picked)
    useAppStore.getState().updatePanelTitle(workspaceId, panelId, fileName)
  }, [workspaceId, panelId])

  const selectedTableInfo = tables.find((t) => t.name === selectedTable)
  const totalRows = selectedTableInfo?.rowCount ?? 0
  const totalPages = Math.ceil(totalRows / PAGE_SIZE)

  // No file open
  if (!filePath) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--surface-1)]">
        <p className="text-sm text-[var(--text-secondary)]">No database open</p>
        <button
          onClick={handleOpenFile}
          className="px-3 py-1.5 rounded text-sm bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-4)] cursor-pointer"
        >
          Open Database…
        </button>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[var(--surface-1)] p-4">
        <p className="text-sm font-medium text-red-400">Failed to open database</p>
        <p className="text-xs text-[var(--text-secondary)] text-center max-w-xs">{loadError}</p>
        <button
          onClick={handleOpenFile}
          className="mt-2 px-3 py-1.5 rounded text-sm bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-4)] cursor-pointer"
        >
          Open Another…
        </button>
      </div>
    )
  }

  const displayResult = queryResult ?? tableResult

  return (
    <div className="w-full h-full flex flex-col bg-[var(--surface-1)] text-[var(--text-primary)] text-xs overflow-hidden">
      {/* Main split: sidebar + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Table sidebar */}
        <div className="w-44 shrink-0 border-r border-[var(--border-subtle)] flex flex-col overflow-hidden">
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
            Tables
          </div>
          <div className="flex-1 overflow-y-auto">
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => handleTableSelect(t.name)}
                className={`w-full text-left px-2 py-1.5 flex items-center justify-between gap-1 hover:bg-[var(--surface-3)] cursor-pointer ${
                  selectedTable === t.name ? 'bg-[var(--surface-3)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0">{t.rowCount.toLocaleString()}</span>
              </button>
            ))}
            {tables.length === 0 && (
              <p className="px-2 py-2 text-[var(--text-muted)]">No tables</p>
            )}
          </div>
        </div>

        {/* Content: data grid + SQL editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Data grid */}
          <div className="flex-1 min-h-0 overflow-auto">
            {displayResult && displayResult.error ? (
              <div className="p-3 text-red-400">{displayResult.error}</div>
            ) : displayResult && displayResult.columns.length > 0 ? (
              <table className="border-collapse w-max min-w-full">
                <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
                  <tr>
                    {displayResult.columns.map((col) => (
                      <th
                        key={col}
                        className="px-2 py-1 text-left font-medium text-[var(--text-secondary)] border-b border-r border-[var(--border-subtle)] whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayResult.rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-[var(--surface-2)]'}>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-2 py-0.5 border-b border-r border-[var(--border-subtle)] max-w-[240px] truncate whitespace-nowrap"
                          title={cell == null ? 'NULL' : String(cell)}
                        >
                          {cell == null ? (
                            <span className="text-[var(--text-muted)] italic">NULL</span>
                          ) : (
                            String(cell)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !queryResult ? (
              <div className="p-3 text-[var(--text-muted)]">
                {selectedTable ? 'Loading…' : 'Select a table'}
              </div>
            ) : (
              <div className="p-3 text-[var(--text-muted)]">No rows returned</div>
            )}
          </div>

          {/* Pagination (only for table view, not query results) */}
          {!queryResult && totalPages > 1 && (
            <div className="flex items-center gap-2 px-3 py-1 border-t border-[var(--border-subtle)] bg-[var(--surface-2)] shrink-0">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="px-2 py-0.5 rounded bg-[var(--surface-3)] disabled:opacity-40 hover:bg-[var(--surface-4)] cursor-pointer"
              >
                ←
              </button>
              <span className="text-[var(--text-secondary)]">
                Page {page + 1} / {totalPages} ({totalRows.toLocaleString()} rows)
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="px-2 py-0.5 rounded bg-[var(--surface-3)] disabled:opacity-40 hover:bg-[var(--surface-4)] cursor-pointer"
              >
                →
              </button>
            </div>
          )}

          {/* SQL editor */}
          <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-2)] flex flex-col" style={{ maxHeight: '160px' }}>
            <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--border-subtle)]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">SQL Query</span>
              <div className="flex items-center gap-1">
                {queryResult && (
                  <button
                    onClick={() => setQueryResult(null)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer px-1"
                    title="Clear query results"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={handleRunQuery}
                  disabled={queryRunning || !sql.trim()}
                  className="px-2 py-0.5 rounded text-[10px] bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-40 cursor-pointer"
                >
                  {queryRunning ? 'Running…' : 'Run ▶'}
                </button>
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleRunQuery()
                }
              }}
              placeholder="SELECT * FROM table_name LIMIT 100"
              className="flex-1 resize-none bg-transparent px-2 py-1 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
